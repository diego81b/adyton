# PwdSecure (Adyton) — Technical Analysis

Zero-knowledge self-hosted password manager + `.env` / production secrets vault.

Analisi completa frammentata per ambito. Documento originale monolitico: [`../ANALYSIS.original.md`](../ANALYSIS.original.md) (5094 righe).

## Indice

### Overview
- [00 — Executive Summary & System Architecture](./00-overview.md) (sez. 1 + 2)

### Security
- [Security Architecture](./security/architecture.md) (sez. 3) — crypto, Argon2id, AES-GCM, JWT, rate limit, fail2ban
- [Security Guarantees & Assurance Level](./security/guarantees.md) (sez. 11)
- [Attack Vectors](./security/attack-vectors.md) (sez. 12) — device compromise, AiTM, XSS, server compromise, supply chain
- [Penetration Testing Plan](./security/pentest.md) (sez. 13)

### Backend
- [NestJS 10 + Fastify](./backend/nestjs.md) (sez. 4)
- [Database — MikroORM 6 + PostgreSQL 16](./backend/database.md) (sez. 5)

### Frontend
- [Nuxt 4 + NuxtUI 4 + Pinia](./frontend/nuxt.md) (sez. 6)
- [Design System — brand palette & tokens](./frontend/design-system.md) (added 2026-06-12)
- [UX Design — Mobile First](./frontend/ux-mobile.md) (sez. 14)
- [PWA vs Desktop App (Tauri)](./frontend/pwa-vs-tauri.md) (sez. 15)

### Extension & Shared
- [Browser Extension (Manifest V3)](./extension.md) (sez. 7)
- [Shared Package — crypto + types](./shared.md) (sez. 8)

### Infrastructure
- [Docker / Coolify / Cloudflare / Backup](./infrastructure.md) (sez. 9)

### Roadmap
- [Implementation Phases 1–9](./roadmap/phases.md) (sez. 10)
- [Phone-as-Key / Device-as-Key — Future Roadmap](./roadmap/device-as-key.md) (sez. 16) — WebAuthn PRF, Secure Enclave, QR+ECDH relay, Shamir

## Stack riassunto

| Layer       | Tech                                                |
|-------------|-----------------------------------------------------|
| Backend     | NestJS 10 (Fastify), MikroORM 6                     |
| DB / Cache  | PostgreSQL 16, Redis 7                              |
| Auth        | JWT RS256 (15 min access, 7 d refresh httpOnly)     |
| Frontend    | Nuxt 4, NuxtUI 4, Tailwind, Pinia                   |
| Extension   | Manifest V3 (Chrome + Firefox)                      |
| Crypto      | Argon2id (m=65536,t=3,p=1) → AES-256-GCM client-side|
| Dev         | Docker Compose (api, web, db, redis, nginx)         |
| Prod        | Hetzner VPS + Coolify + Cloudflare + Let's Encrypt  |

## Entry types

`LOGIN`, `SECURE_NOTE`, `CREDIT_CARD`, `IDENTITY`, `ENV_FILE`, `SECRET`
