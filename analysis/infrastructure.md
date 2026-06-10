## 9. Infrastructure and DevOps

### 9.1 Docker Compose (Development)

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: adyton
      POSTGRES_USER: adyton
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-devpassword}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U adyton"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --save "" --appendonly no --maxmemory 128mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile.dev
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
      redis: { condition: service_healthy }
    environment:
      DATABASE_URL: postgres://adyton:${POSTGRES_PASSWORD:-devpassword}@db:5432/adyton
      REDIS_URL: redis://redis:6379
      JWT_PRIVATE_KEY_PATH: /run/secrets/jwt_private_key
      JWT_PUBLIC_KEY_PATH: /run/secrets/jwt_public_key
      NODE_ENV: development
    volumes:
      - ./apps/api:/app/apps/api
      - ./packages:/app/packages
      - /app/node_modules
    ports:
      - "3001:3001"
    secrets:
      - jwt_private_key
      - jwt_public_key

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile.dev
    restart: unless-stopped
    environment:
      NUXT_PUBLIC_API_BASE_URL: http://localhost/api
      NODE_ENV: development
    volumes:
      - ./apps/web:/app/apps/web
      - ./packages:/app/packages
      - /app/node_modules
    ports:
      - "3000:3000"

secrets:
  jwt_private_key:
    file: ./secrets/jwt_private.pem
  jwt_public_key:
    file: ./secrets/jwt_public.pem

volumes:
  postgres_data:
```

### 9.2 Development: Accessing Services Locally

In development, no reverse proxy is needed. Services are directly accessible on localhost:

| Service | URL |
|---------|-----|
| Nuxt frontend | `http://localhost:3000` |
| NestJS API | `http://localhost:3001` |
| PostgreSQL | `localhost:5432` (direct connection for DB tools) |

The Nuxt app calls the API directly at `http://localhost:3001`. Set `NUXT_PUBLIC_API_BASE_URL=http://localhost:3001` in the dev environment. No `/api` path prefix needed in dev — prefix is added by the production routing (Traefik).

### 9.3 Production: Hetzner VPS + Coolify + Cloudflare

**Architecture:**

```
User browser
    │
    ▼
Cloudflare (DNS proxy — orange cloud)
  · DDoS L3/L4/L7 absorption
  · WAF basic rules (free tier)
  · Bot Fight Mode
  · SSL termination (Flexible disabled — Full Strict mode)
    │
    ▼ Only Cloudflare IP ranges pass through (UFW rule)
Hetzner VPS — Ubuntu 24.04
  · UFW: port 80/443 only from Cloudflare IPs
  · fail2ban: reads Traefik logs
    │
    ▼
Coolify (Traefik built-in reverse proxy)
  · Routes by domain + path prefix
  · TLS: Cloudflare Origin Certificate (Section 9.6)
  · Real IP forwarding: CF-Connecting-IP → X-Real-IP
    │
    ├─▶ api container  (NestJS:3001) — path /api/*
    └─▶ web container  (Nuxt:3000)  — path /*
         │
         └── [internal Docker network — not reachable from outside]
               ├─▶ db    (PostgreSQL:5432)
               └─▶ redis (Redis:6379)
```

**docker-compose.yml (Coolify deployment — no nginx, no certbot):**

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: adyton
      POSTGRES_USER: adyton
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - internal
    mem_limit: 512m
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U adyton"]
      interval: 15s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --save "" --requirepass ${REDIS_PASSWORD} --maxmemory 64mb
    networks:
      - internal
    mem_limit: 128m

  api:
    image: ${API_IMAGE}   # built via CI and pushed to registry, or build: context in Coolify UI
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
      redis: { condition: service_healthy }
    environment:
      DATABASE_URL: postgres://adyton:${POSTGRES_PASSWORD}@db:5432/adyton
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      NODE_ENV: production
      JWT_PRIVATE_KEY: ${JWT_PRIVATE_KEY}   # set in Coolify env var UI (PEM, multiline)
      JWT_PUBLIC_KEY: ${JWT_PUBLIC_KEY}
      ENABLE_POW: "true"
    networks:
      - internal
      - coolify          # Traefik-accessible network managed by Coolify
    mem_limit: 512m
    labels:
      - "traefik.enable=true"
      # Route /api/* to NestJS
      - "traefik.http.routers.adyton-api.rule=Host(`${DOMAIN}`) && PathPrefix(`/api`)"
      - "traefik.http.routers.adyton-api.entrypoints=https"
      - "traefik.http.routers.adyton-api.tls=true"
      - "traefik.http.services.adyton-api.loadbalancer.server.port=3001"
      # Strip /api prefix before forwarding to NestJS
      - "traefik.http.middlewares.strip-api.stripprefix.prefixes=/api"
      # Real IP from Cloudflare: CF-Connecting-IP → X-Real-IP
      - "traefik.http.middlewares.cf-realip.headers.customrequestheaders.X-Real-IP=CF-Connecting-IP"
      # Security headers (Cloudflare adds HSTS; Traefik adds the rest)
      - "traefik.http.middlewares.sec-headers.headers.contentTypeNosniff=true"
      - "traefik.http.middlewares.sec-headers.headers.frameDeny=true"
      - "traefik.http.middlewares.sec-headers.headers.referrerPolicy=no-referrer"
      # Basic Traefik rate limit (coarse — app-level @fastify/rate-limit handles per-endpoint)
      - "traefik.http.middlewares.api-rl.ratelimit.average=120"
      - "traefik.http.middlewares.api-rl.ratelimit.burst=50"
      - "traefik.http.middlewares.api-rl.ratelimit.period=1m"
      - "traefik.http.middlewares.api-rl.ratelimit.sourcecriterion.requestheadername=CF-Connecting-IP"
      - "traefik.http.routers.adyton-api.middlewares=strip-api,cf-realip,sec-headers,api-rl"

  web:
    image: ${WEB_IMAGE}
    restart: unless-stopped
    environment:
      NUXT_PUBLIC_API_BASE_URL: https://${DOMAIN}/api
      NODE_ENV: production
    networks:
      - coolify
    mem_limit: 256m
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.adyton-web.rule=Host(`${DOMAIN}`)"
      - "traefik.http.routers.adyton-web.entrypoints=https"
      - "traefik.http.routers.adyton-web.tls=true"
      - "traefik.http.services.adyton-web.loadbalancer.server.port=3000"
      - "traefik.http.routers.adyton-web.middlewares=sec-headers"

networks:
  internal:
    driver: bridge
    internal: true    # db + redis not reachable from any external network
  coolify:
    external: true
    name: coolify     # Coolify creates this network automatically on install

volumes:
  postgres_data:
```

**Coolify deployment sequence:**

1. Install Coolify on Hetzner VPS: `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`
2. Open Coolify UI (`http://<vps-ip>:8000`), complete setup wizard
3. Add new project → "Docker Compose" application → paste/link the `docker-compose.yml`
4. Set environment variables in Coolify UI (never committed to git):
   - `POSTGRES_PASSWORD`, `REDIS_PASSWORD` — generate with `openssl rand -hex 32`
   - `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` — paste PEM content (multiline supported)
   - `DOMAIN` — e.g. `vault.yourdomain.com`
   - `API_IMAGE`, `WEB_IMAGE` — your container registry images
5. Set domain in Coolify UI → Coolify configures Traefik routing automatically
6. Configure TLS (see Section 9.6 — Cloudflare Origin Certificate recommended)
7. Deploy → Coolify pulls images, starts containers, Traefik routes traffic
8. Run migrations: Coolify UI → "Execute command" → `node dist/cli.js migration:run`

**RS256 keypair generation (run once, save output to Coolify env vars):**

```bash
openssl genrsa -out jwt_private.pem 4096
openssl rsa -in jwt_private.pem -pubout -out jwt_public.pem
# Paste contents of jwt_private.pem → JWT_PRIVATE_KEY in Coolify UI
# Paste contents of jwt_public.pem → JWT_PUBLIC_KEY in Coolify UI
# Delete local .pem files after copying
```

---

**Attivare Cloudflare proxy (se il dominio è già registrato su Cloudflare)**

Il dominio è già su Cloudflare Registrar → DNS gestito da Cloudflare → basta abilitare il proxy. Nessun costo aggiuntivo: è incluso nel piano free.

**Passi esatti (una-tantum, ~5 minuti):**

1. Apri [dash.cloudflare.com](https://dash.cloudflare.com) → seleziona il dominio
2. **DNS → Records** → trova il record `A` che punta all'IP del VPS Hetzner
3. Clicca l'icona **nuvoletta grigia** nella colonna "Proxy status" → diventa **arancione**
4. Salva — DDoS protection e Bot Fight Mode attivi immediatamente

5. **SSL/TLS → Overview** → seleziona **Full (Strict)**
   - Coolify gestisce già Let's Encrypt automaticamente → Full (Strict) funziona senza configurazione aggiuntiva
   - *Non usare "Flexible"* — con Flexible il traffico Cloudflare → VPS viaggia in HTTP non cifrato

6. **Security → Bots** → **Bot Fight Mode → ON**

7. **Security → WAF** → **Managed Rules → ON** (regole OWASP base, gratuito)

8. **Security → WAF → Rate Limiting Rules → Create rule:**
   - URI path: `/api/auth/login`
   - Caratteristica: IP
   - Soglia: 5 richieste in 60 secondi
   - Azione: Block
   - Questa regola blocca il brute-force sul login **prima** che il traffico raggiunga il VPS

9. **SSL/TLS → Edge Certificates** → **Always Use HTTPS → ON**

Dopo questi passi, il tuo VPS è protetto da Cloudflare. Il passo successivo (opzionale ma consigliato) è aggiungere la regola UFW per accettare 80/443 solo dagli IP Cloudflare — vedere Section 9.6.

```
Prima (DNS only):   Browser → VPS Hetzner direttamente
Dopo (proxied):     Browser → Cloudflare → VPS Hetzner
                              ↑
                    DDoS assorbito qui, WAF applicato qui,
                    IP reale del VPS nascosto
```

---

### 9.4 Backup Strategy

A dedicated backup container runs `pg_dump` on a cron schedule:

```bash
# scripts/backup.sh (installed as cron entry: 0 2 * * * /backup.sh)
#!/bin/sh
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump -h db -U adyton adyton | gzip > /backups/adyton_${DATE}.sql.gz

# Retention: keep 7 daily, 4 weekly
find /backups -name "*.sql.gz" -mtime +7 -not -name "*_Monday_*" -delete
find /backups -name "*_Monday_*" -mtime +28 -delete
```

For off-site replication, `rclone` syncs the `/backups` volume to Backblaze B2 after each dump completes. Restore procedure:

```bash
gunzip -c backup.sql.gz | docker compose exec -T db psql -U adyton adyton
```

### 9.5 Secrets Management

With Coolify, secrets are stored in the Coolify UI (encrypted at rest in Coolify's own database) and injected as environment variables at container startup. No `.env.prod` file exists on the VPS filesystem — nothing to accidentally expose or commit.

`.env.example` documents every required variable and is committed to the repo:

```bash
# .env.example — all values are placeholders, never real secrets
POSTGRES_PASSWORD=CHANGE_ME_32_BYTES_HEX
REDIS_PASSWORD=CHANGE_ME_32_BYTES_HEX
JWT_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\nCHANGE_ME\n-----END RSA PRIVATE KEY-----
JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\nCHANGE_ME\n-----END PUBLIC KEY-----
DOMAIN=vault.yourdomain.com
API_IMAGE=ghcr.io/yourorg/adyton-api:latest
WEB_IMAGE=ghcr.io/yourorg/adyton-web:latest
ENABLE_POW=true
```

The NestJS `ConfigService` reads JWT keys from environment variables directly (not file paths) — Coolify passes PEM content as a multiline env var. The PostgreSQL user used at runtime has no DDL permissions; migrations run as a one-off command via Coolify's "Execute command" UI before first start.

---

### 9.6 Cloudflare + Traefik Security Configuration

#### TLS: Cloudflare Origin Certificate (recommended)

With Cloudflare proxying traffic, Let's Encrypt is not needed — Cloudflare handles the certificate that browsers see. The connection between Cloudflare and the origin (Hetzner VPS) uses a **Cloudflare Origin Certificate**: a certificate Cloudflare issues that is valid for 15 years and trusted only by Cloudflare (not publicly trusted, which is fine because no browser ever connects directly to the VPS).

```
Browser ←→ Cloudflare: Cloudflare's public certificate (trusted by all browsers)
Cloudflare ←→ Hetzner VPS: Cloudflare Origin Certificate (trusted only by CF)
```

**Setup:**
1. In Cloudflare dashboard → SSL/TLS → Origin Server → Create Certificate → 15 years
2. Copy "Origin Certificate" (PEM) and "Private Key"
3. Add both to Coolify as environment variables: `CF_ORIGIN_CERT`, `CF_ORIGIN_KEY`
4. In Coolify Traefik config, reference these as the TLS certificate for your domain
5. Cloudflare SSL mode → **Full (Strict)** — Cloudflare verifies the origin cert

**Cloudflare SSL mode — do not use Flexible:**

| Mode | Cloudflare → Origin | Security |
|------|---------------------|----------|
| Flexible | HTTP (unencrypted!) | ❌ Traffic on VPS is plaintext |
| Full | HTTPS (any cert) | ⚠️ Self-signed accepted — MITM possible on same host |
| **Full (Strict)** | **HTTPS + valid cert** | ✅ Only Origin Certificate or Let's Encrypt accepted |

#### Cloudflare Security Settings (free tier)

Configure these in Cloudflare dashboard → Security:

| Setting | Value | Effect |
|---------|-------|--------|
| **Bot Fight Mode** | ON | Blocks known bot fingerprints — no cost, catches a large fraction of scraping/scanning bots |
| **Security Level** | Medium | Blocks IPs with bad reputation from accessing the site |
| **Browser Integrity Check** | ON | Rejects headless browsers and unusual User-Agents |
| **Challenge Passage** | 30 min | Challenged users don't get re-challenged for 30 min |
| **WAF** | Managed Rules ON (free tier) | Basic OWASP rules, SQL injection, XSS patterns |
| **Rate Limiting** | 1 rule (free tier) | Add a rule: `/api/auth/login` → 5 req/min per IP → Block |

Cloudflare's rate limiting rule on `/api/auth/login` is the first gate — it fires before the request even reaches Hetzner. The application's own progressive delay (Section 3.10.4) is the second gate for requests that pass Cloudflare.

#### UFW: Lock Origin to Cloudflare IPs Only

With Cloudflare proxying, the VPS only needs to accept traffic from Cloudflare IP ranges. Direct access to the VPS IP bypasses Cloudflare DDoS protection. Lock it down:

```bash
# Run on Hetzner VPS after Coolify install
# First: deny all on 80/443
ufw deny 80
ufw deny 443

# Allow only Cloudflare IPv4 ranges
for ip in \
  173.245.48.0/20 \
  103.21.244.0/22 \
  103.22.200.0/22 \
  103.31.4.0/22 \
  141.101.64.0/18 \
  108.162.192.0/18 \
  190.93.240.0/20 \
  188.114.96.0/20 \
  197.234.240.0/22 \
  198.41.128.0/17 \
  162.158.0.0/15 \
  104.16.0.0/13 \
  104.24.0.0/14 \
  172.64.0.0/13 \
  131.0.72.0/22; do
    ufw allow from $ip to any port 80
    ufw allow from $ip to any port 443
done

# Keep Coolify UI accessible (restrict to your own IP in production)
ufw allow from YOUR_IP to any port 8000

ufw reload
```

Result: an attacker who discovers the Hetzner VPS IP cannot connect to it on 80/443 — requests are dropped at the firewall. Only Cloudflare's infrastructure can reach the VPS. All DDoS must go through Cloudflare first.

**Update Cloudflare IP list periodically:** Cloudflare publishes current IP ranges at `https://www.cloudflare.com/ips-v4`. A cron script can refresh the UFW rules monthly.

#### Real IP Propagation

With Cloudflare proxying, the IP reaching Traefik is always a Cloudflare data center IP, not the user's IP. Cloudflare adds the real client IP in the `CF-Connecting-IP` header. The Traefik label in Section 9.3 already maps this:

```yaml
- "traefik.http.middlewares.cf-realip.headers.customrequestheaders.X-Real-IP=CF-Connecting-IP"
- "traefik.http.middlewares.api-rl.ratelimit.sourcecriterion.requestheadername=CF-Connecting-IP"
```

NestJS has `trustProxy: true` in Fastify options (already in plan) — it reads `X-Real-IP` as the client IP for rate limiting, fail2ban log entries, audit logs, and trusted device IP tracking.

**Without this**, rate limiting and fail2ban would see only Cloudflare IPs — blocking a Cloudflare IP would block all users worldwide, not just the attacker.

---

### 9.7 Coolify — Configurazione Applicazioni

#### Come Coolify si inserisce nell'architettura

Coolify è installato sul VPS Hetzner e gestisce tutto quello che sta tra il sistema operativo e le applicazioni:

```
Sistema operativo (Ubuntu 24.04)
    └── Docker (installato da Coolify)
        └── Coolify daemon
            ├── Traefik (reverse proxy — gestito automaticamente da Coolify)
            ├── Coolify UI  (porta 8000 — accessibile solo dal tuo IP)
            └── I tuoi servizi (avviati e gestiti da Coolify)
                ├── PostgreSQL
                ├── Redis
                ├── API (NestJS)
                └── Web (Nuxt)
```

Coolify fa tre cose fondamentali:
1. **Avvia e monitora** i container Docker (riavvia se crashano)
2. **Configura Traefik automaticamente** quando assegni un dominio a un'applicazione — non devi scrivere label Traefik a mano
3. **Gestisce i segreti** — env var cifrate, non in file .env sul disco

---

#### Struttura raccomandata in Coolify: Risorse separate

Coolify distingue tra **Applications** (il tuo codice) e **Services** (database, Redis — servizi predefiniti con backup e monitoraggio inclusi).

Struttura raccomandata:

```
Coolify → Project: "Adyton"
  └── Environment: "production"
      ├── Service: PostgreSQL     ← gestito da Coolify (backup UI, log, restart)
      ├── Service: Redis          ← gestito da Coolify
      ├── Application: API        ← NestJS, deploy da Docker image
      └── Application: Web        ← Nuxt, deploy da Docker image
```

Alternativa: deploy come **Docker Compose singolo** (tutto in un file). Più semplice ma aggiornare l'API riavvia anche db e Redis. Per questo motivo i servizi separati sono preferiti.

---

#### Passo 1 — Creare il progetto

1. Apri Coolify UI → `http://<IP-VPS>:8000` (accessibile solo dal tuo IP, vedi UFW)
2. **Projects → New Project** → Nome: `Adyton`
3. All'interno del progetto → **New Environment** → `production`

---

#### Passo 2 — Aggiungere PostgreSQL

1. Nel progetto Adyton → **+ New Resource → Database → PostgreSQL**
2. Versione: `16`
3. Nome servizio: `adyton-db`
4. Coolify genera automaticamente una password sicura e la mostra una sola volta — salvala
5. Il **connection string** che Coolify mostra è quello da usare in `DATABASE_URL`:
   ```
   postgresql://adyton:<password>@adyton-db:5432/adyton
   ```
   Il hostname `adyton-db` è il nome del container — tutti i servizi nello stesso progetto si raggiungono per nome
6. **Backup** → abilita backup automatico (Coolify fa `pg_dump` schedulato)
7. Deploy

---

#### Passo 3 — Aggiungere Redis

1. **+ New Resource → Database → Redis**
2. Versione: `7`
3. Nome: `adyton-redis`
4. Coolify imposta `requirepass` automaticamente — salva la password
5. Connection string: `redis://:password@adyton-redis:6379`
6. Deploy

---

#### Passo 4 — Aggiungere l'applicazione API (NestJS)

1. **+ New Resource → Application → Docker Image**
2. Docker image: `ghcr.io/tuouser/adyton-api:latest` (o il tuo registry)
3. Nome: `adyton-api`
4. **Domains** → aggiungi `vault.tuodominio.com` — path prefix `/api`
   - Coolify configura Traefik automaticamente: routing, TLS, strip del prefisso `/api`
5. **Environment Variables** → aggiungi tutti i segreti:

   | Chiave | Valore |
   |--------|--------|
   | `DATABASE_URL` | `postgresql://adyton:<pwd>@adyton-db:5432/adyton` |
   | `REDIS_URL` | `redis://:password@adyton-redis:6379` |
   | `JWT_PRIVATE_KEY` | contenuto PEM della chiave privata (multilinea supportata) |
   | `JWT_PUBLIC_KEY` | contenuto PEM della chiave pubblica |
   | `NODE_ENV` | `production` |
   | `ENABLE_POW` | `true` |

   Le env var sono **cifrate at rest** in Coolify — non appaiono in `docker inspect` e non sono nel filesystem del VPS.

6. **Ports** → porta esposta: `3001` (Coolify la usa per il routing Traefik)
7. **Health Check** → `GET /health` → atteso `200`
8. **Restart policy** → `unless-stopped`
9. Deploy

**Eseguire le migration dopo il primo deploy:**
Coolify UI → seleziona `adyton-api` → **Execute Command**:
```bash
node dist/cli.js migration:run
```

---

#### Passo 5 — Aggiungere l'applicazione Web (Nuxt)

1. **+ New Resource → Application → Docker Image**
2. Docker image: `ghcr.io/tuouser/adyton-web:latest`
3. Nome: `adyton-web`
4. **Domains** → `vault.tuodominio.com` (root, senza path prefix)
   - La regola in Traefik ha priorità più bassa di `/api` — Coolify gestisce l'ordine automaticamente
5. **Environment Variables**:

   | Chiave | Valore |
   |--------|--------|
   | `NUXT_PUBLIC_API_BASE_URL` | `https://vault.tuodominio.com/api` |
   | `NODE_ENV` | `production` |

6. **Ports** → `3000`
7. Deploy

---

#### Come Coolify configura Traefik (automaticamente)

Quando assegni un dominio a un'applicazione nel UI, Coolify:
1. Aggiunge le label Traefik al container
2. Traefik rileva le label in tempo reale (non richiede restart)
3. Crea un router con la regola `Host() && PathPrefix()` corretta
4. Richiede un certificato Let's Encrypt automaticamente (se non usi Origin Certificate CF)
5. Configura il redirect HTTP→HTTPS

Non devi scrivere label Traefik manualmente nella maggior parte dei casi. Le label mostrate in Section 9.3 sono utili solo se usi il deploy Docker Compose — con risorse separate Coolify le genera dal UI.

---

#### Deploy automatici (CI/CD)

Coolify supporta deploy automatici quando la Docker image viene aggiornata:

1. In ogni Application → **Deployments → Webhook**
2. Coolify genera un URL webhook
3. Aggiungi questo webhook alla pipeline CI (GitHub Actions, GitLab CI):
   ```yaml
   # .github/workflows/deploy.yml (frammento)
   - name: Trigger Coolify deploy
     run: |
       curl -X POST "${{ secrets.COOLIFY_WEBHOOK_API }}"
       curl -X POST "${{ secrets.COOLIFY_WEBHOOK_WEB }}"
   ```
4. Quando la CI builda e pusha una nuova immagine → Coolify riceve il webhook → pull nuova immagine → rolling restart

Il rolling restart di Coolify mantiene il vecchio container attivo finché il nuovo è healthy — zero downtime.

---

#### Rete interna: come i servizi si parlano

Coolify mette tutti i servizi dello stesso progetto/environment in una rete Docker interna. Non serve esporre porte tra i container:

```
adyton-api → si connette a → adyton-db:5432   (PostgreSQL)
adyton-api → si connette a → adyton-redis:6379 (Redis)
adyton-web → NON si connette direttamente all'API
             → il browser fa richieste a https://vault.tuodominio.com/api
             → Cloudflare → Traefik → adyton-api
```

Il frontend Nuxt non parla mai direttamente con NestJS server-side in produzione (SSR è disabilitato sulle pagine vault). Tutta la comunicazione passa via HTTPS dal browser.

---

#### Riepilogo visivo dell'architettura Coolify

```
Coolify UI (porta 8000, solo tuo IP)
    │
    ├── gestisce ──▶ Traefik
    │                   │
    │                   ├── vault.tuodominio.com/api  ──▶ adyton-api:3001
    │                   └── vault.tuodominio.com       ──▶ adyton-web:3000
    │
    ├── gestisce ──▶ adyton-db     (PostgreSQL:5432)  ─┐
    ├── gestisce ──▶ adyton-redis  (Redis:6379)        ├── rete interna
    ├── gestisce ──▶ adyton-api    (NestJS:3001)       ┤  (non esposta)
    └── gestisce ──▶ adyton-web    (Nuxt:3000)        ─┘
```

---

### 9.8 Reset del database (staging)

> **ATTENZIONE — operazione distruttiva.** Cancella in modo permanente TUTTI i dati
> di staging (utenti, voci del vault, sessioni, codici 2FA). Nessun undo.
> Non eseguire mai su produzione. Verificare di essere sulla risorsa DB di **staging**.

Su staging il database è una risorsa PostgreSQL gestita da Coolify (non definita in
`docker-compose.staging.yml`). Le migrazioni vengono ri-applicate automaticamente al
boot dell'API (`RUN_MIGRATIONS=true`), quindi il reset consiste solo nel droppare lo
schema e far ripartire l'API.

**Procedura (da Coolify dashboard):**

1. Apri la risorsa **PostgreSQL** di staging → tab **Terminal** (Execute Command).
2. Esegui (le variabili `$POSTGRES_USER`/`$POSTGRES_DB` sono già nell'env del container):

   ```bash
   psql -U $POSTGRES_USER -d $POSTGRES_DB -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO $POSTGRES_USER; GRANT ALL ON SCHEMA public TO public;"
   ```

3. Vai sull'applicazione **api** → **Restart** (o Redeploy). Al boot le migrazioni
   ricreano lo schema da zero.

**L'ordine conta:** droppa lo schema *prima*, riavvia l'API *dopo*. Se l'API gira
durante il drop genererà errori finché non viene riavviata.

---

