## 12. Attack Vectors — How an Attacker Could Steal Data

This section maps the realistic attack paths from most to least feasible, with the specific technical mechanism for each.

### 12.1 Device Compromise (Highest Risk)

**Attack:** Malware, keylogger, or a malicious browser extension runs on the user's device and captures the master password as it is typed, before Argon2id processes it.

**What the attacker gets:** The master password in plaintext. They can then derive the encryption key offline using the `kdfSalt` (retrieved from the API — unauthenticated endpoint leaks nothing, but kdfSalt is delivered on login, so attacker also needs login credentials or the DB dump).

**Full exploitation chain:**
1. Keylogger captures `masterPassword` and `authPassword` at login
2. Attacker logs in with stolen `authPassword` → receives `kdfSalt` + `accessToken`
3. Downloads all vault entries (encrypted blobs)
4. Computes `AES-256-GCM key = Argon2id(masterPassword, kdfSalt)` offline
5. Decrypts all vault entries

**Why this bypasses all server-side controls:** The server correctly validates the login. All security properties hold. The compromise is entirely on the client side.

**Mitigation:** Outside the scope of application-level controls. Device hygiene, EDR, OS-level protections. WebAuthn hardware keys help because the hardware authenticator cannot be cloned even if the device is compromised (the private key never leaves the hardware token), but the master password itself is still captured by the keylogger.

### 12.2 Weak or Breached Master Password

**Attack:** The user chose a dictionary word, common phrase, or password that appears in a breach corpus (HaveIBeenPwned). After a DB breach, the attacker runs an offline dictionary attack against `User.passwordHash` (Argon2id). On success, they replay the cracked password as the master password.

**Timeline:** A 6-word common phrase at the top of a 10M-entry wordlist → cracked in minutes even with Argon2id. A genuinely random 12-character password → not feasible (see Section 11.1).

**Mitigation in this system:** The full `validateMasterPassword()` pipeline runs client-side at registration and at every vault re-unlock prompt (Section 3.3.3): zxcvbn score = 4 required, dictionary words and keyboard patterns rejected, HaveIBeenPwned k-anonymity check against the breach corpus. Registration and unlock are hard-blocked until all conditions pass. This closes the entire class of dictionary and pattern attacks. The residual risk is a personally guessable password that passes algorithmic validation (e.g. unusual capitalisation of a private phrase) — this cannot be detected programmatically.

### 12.3 AiTM Phishing (Adversary-in-The-Middle — Session Relay)

**Attack:** This is distinct from classical MITM (network interception). In an AiTM attack, the attacker runs a reverse proxy (commonly Evilginx2, Modlishka) between the user and the real server. The phishing site at `adyton-login.attacker.com` forwards all requests to the real `vault.example.com` in real time.

**Exploitation with TOTP:**
1. User visits phishing URL (received via email/SMS)
2. Phishing proxy forwards login form to real server
3. User enters email + password + TOTP code
4. Proxy relays to real server → receives real session tokens
5. Attacker's proxy captures the access token + refresh token cookie in real time
6. Attacker uses the session before TOTP code expires (30-second window)

**Why TOTP does NOT protect against AiTM:** TOTP proves possession of the secret, not the origin of the connection. The attacker relays the code immediately to the real server — both the user and the attacker authenticate "successfully."

**Exploitation with WebAuthn:**
1. Phishing proxy forwards WebAuthn authentication options (challenge) to user
2. User's authenticator computes assertion using the challenge and the **browser's current origin** (`https://adyton-login.attacker.com`)
3. The assertion is cryptographically bound to the phishing origin
4. Proxy forwards the assertion to the real server (`vault.example.com`)
5. Real server's WebAuthn validation checks `rpId` — the origin in the assertion does not match `vault.example.com`
6. **Assertion rejected.** Authentication fails. Attacker gets nothing.

**WebAuthn is cryptographically immune to AiTM.** This is the strongest argument for WebAuthn as the primary second factor. TOTP provides a meaningfully lower security level against a sophisticated attacker who can deploy a phishing proxy.

**Mitigation in this system:** WebAuthn enforced as primary 2FA. TOTP retained as fallback (users who cannot use WebAuthn accept the AiTM residual risk). Security-conscious users should exclusively use WebAuthn and disable TOTP.

### 12.4 XSS During Active Vault Session

**Attack:** An XSS payload is injected into a page rendered by the Nuxt frontend (via a malicious vault entry label, URL, or note that is rendered without escaping).

**What the attacker can do during active session:**
1. Call `fetch('/api/vault')` with the existing session cookies/headers → server returns encrypted blobs
2. **Critically:** Access the Pinia store in memory: `window.__pinia['crypto'].cryptoKey` is a `CryptoKey` object
3. `CryptoKey` with `extractable: false` cannot be exported, but the attacker's script can call `crypto.subtle.decrypt(...)` using the existing key handle — the key is an opaque reference the script can use
4. Decrypt all vault entries in-browser → read plaintext passwords and `.env` secrets

**Why this is critical:** The XSS does not need to exfiltrate the key itself. The `CryptoKey` handle is sufficient to decrypt, and the decrypted plaintext can be exfiltrated via `fetch()` to the attacker's server.

**Mitigations:**
- CSP `script-src 'self'` blocks inline scripts and external scripts (primary defense)
- Vue's template compiler HTML-escapes all interpolated values by default (`{{ label }}` → `&amp;lt;script&amp;gt;` not executed)
- Vault entry content is never rendered as `v-html` — this must be a firm coding policy
- Nuxt's built-in XSS protection via Vue's virtual DOM
- Content script isolation: the browser extension runs in an isolated world, preventing web page JS from accessing extension context

**Residual risk:** If a CSP bypass exists (browser bug, misconfigured `unsafe-eval` not present but something equivalent), or if a developer introduces `v-html` for a vault field (a coding mistake), XSS becomes a full vault dump vulnerability.

### 12.5 Server Compromise (Code Execution on VPS)

**Attack:** Attacker exploits a vulnerability (unpatched OS, Docker escape, vulnerable npm dependency) to achieve code execution on the VPS.

**What the attacker gets from the VPS:**
- Full PostgreSQL database: all encrypted vault blobs, Argon2id hashes of auth passwords, TOTP secrets (server-encrypted)
- JWT private key (used for signing access tokens): attacker can forge access tokens indefinitely
- Server-side AES-256 key used to encrypt TOTP secrets: TOTP secrets decryptable
- Redis data: rate limit counters (non-sensitive)

**What the attacker cannot get:**
- Vault plaintext: encrypted with a key derived from the master password, which is never on the server
- Master password: never transmitted or stored

**Attack continuation after VPS compromise:**
1. Forge JWT access tokens using stolen private key
2. Call `GET /vault` → returns encrypted blobs
3. Cannot decrypt them without master password + kdfSalt combination run through Argon2id
4. Can passively wait for the legitimate user to log in and intercept the Argon2id derivation (not feasible remotely; requires implanting malicious code into the NestJS application)

**If attacker modifies server code:** A backdoored server could exfiltrate `kdfSalt` during login and wait for the user to authenticate, then initiate a known-plaintext attack or serve a modified frontend that sends the master password to an attacker endpoint.

**Mitigation:** This attack requires active server compromise, not just passive DB access. Defense: minimal attack surface (no unnecessary services exposed), Docker containers with non-root users, regular security updates, fail2ban, firewall (UFW), immutable infrastructure (redeploy from git rather than patching running containers).

### 12.6 Supply Chain Attack

**Attack:** A malicious npm package is introduced into the dependency tree, specifically targeting `packages/shared` (the crypto module). If the attacker can modify `argon2-browser`, they can exfiltrate the master password before it is hashed. If they modify the `SubtleCrypto` wrapper, they can exfiltrate the raw key bytes before `importKey` is called.

**Why this is particularly dangerous for a password manager:** The crypto package is the single most sensitive component. A backdoor here bypasses all server-side and transport-level security.

**Mitigations:**
- `pnpm-lock.yaml` with content-addressed hashes: any modification to a package changes its hash and fails installation
- `pnpm audit` in CI pipeline: catches known CVEs
- Minimal dependency count in `packages/shared`: only `argon2-browser` is a third-party crypto dependency; all AES-GCM/ECDH operations use the native Web Crypto API
- `npm pack` + manual review of `argon2-browser` on version bumps
- Subresource Integrity (SRI) for any CDN-loaded resources (none in this architecture — all bundled)

### 12.7 Classical MITM (Network Interception)

**Attack:** Attacker intercepts network traffic between client and server on the same network segment (ARP spoofing on LAN, rogue access point, compromised router).

**Against HTTPS + HSTS:** The attacker sees TLS-encrypted bytes. Without the server's private key (stored on the VPS, not accessible) or a valid certificate for the domain, they cannot decrypt the traffic. TLS 1.3's forward secrecy (ECDHE key exchange) means even recording the traffic and later compromising the server's TLS private key does not decrypt past sessions.

**SSL stripping (first visit only):** If the browser has never visited the site and HSTS is not yet cached, an attacker can respond to the initial HTTP request with a plain HTTP page and intercept credentials. After one successful HTTPS visit, HSTS in the browser prevents this for 2 years (the configured max-age).

**Certificate spoofing:** An attacker who can issue a certificate for the domain (compromised CA, CA with improper issuance practices) can present a fake but browser-trusted certificate and intercept HTTPS. Let's Encrypt certificates appear in Certificate Transparency logs, so fraudulent certificates are detectable. The `expect-ct` header (now deprecated, merged into CT enforcement) and monitoring of CT logs for unauthorized certificates is the recommended control.

**Summary of MITM risk:**

| MITM variant | Risk level | Mitigation |
|---|---|---|
| Classical network interception (active session) | Negligible | TLS 1.3 + HSTS blocks this completely |
| SSL stripping (first visit, no HSTS cached) | Low-Medium | HSTS preload list eliminates first-visit window |
| AiTM phishing (session relay via proxy) | **High with TOTP** / Negligible with WebAuthn | Use WebAuthn as primary 2FA |
| Compromised CA / certificate spoofing | Low | Let's Encrypt + CT logs + OCSP stapling |
| Corporate SSL inspection proxy | Medium | Inform users; WebAuthn domain-binding still protects |

The key distinction: classical MITM (network-level interception) is well-mitigated by TLS + HSTS. The dangerous residual risk is **AiTM phishing** (a proxy-based attack, not a wire-level attack), which bypasses TLS entirely because the victim willingly connects to the attacker's server. WebAuthn is the specific control that addresses this.

---

