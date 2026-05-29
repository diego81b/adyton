# Adyton — Development Roadmap

> Living tracker. Static design lives in `analysis/`. Update this file as work lands.

**Last updated:** 2026-05-27
**Current milestone:** V1 — Phase 1 complete

## Status legend
- [x] done    [~] in progress    [ ] todo    [!] blocked    [-] deferred

## V1 (Phases 1–5)

### Phase 1 — Monorepo Scaffold + Docker (Infra)
- [x] pnpm workspace + tsconfig project references
- [x] Docker Compose split: base + dev overlay + prod overlay stub; 4 services (db, redis, api, web), healthchecks
- [x] Dev port plan: web `:30000`, api `:30001` (no reverse proxy in dev — Phase 8 adds Traefik in prod)
- [x] `run.bat` wrapper for the common compose invocations
- [x] RS256 keygen scripts (POSIX + PowerShell)
- [x] Husky pre-commit (typecheck + lint + tests)
- [x] Test harness wired in all 3 workspaces (Jest+supertest for api, Vitest for web + shared) with coverage thresholds (api ≥80%, shared ≥95%, web stores ≥70%)
- [x] README.md bootstrap steps

**Status:** done | **Owner:** Infra | **Started:** 2026-05-27 | **Closed:** 2026-05-27
**Test coverage:** harness-only phase; each ambito picks it up from here.

### Phase 2 — NestJS Auth (Backend)
- [ ] NestJS + Fastify bootstrap, helmet/CORS/cookie
- [ ] User / RefreshToken / TrustedDevice / WebAuthnCredential entities
- [ ] Auth endpoints (register/login/refresh/logout/me)
- [ ] Family-based refresh rotation + theft detection
- [ ] Progressive login delays (Redis)
- [ ] Sessions + Devices modules
- [ ] PoW challenge endpoint (flag-gated, default off)
- [ ] Unit tests

**Status:** todo | **Owner:** Backend | **Depends on:** Phase 1

### Phase 3 — Vault API + Entities (Backend)
- [ ] Group / GroupMembership / Secret / SecretVersion / AuditLog entities
- [ ] Initial migration + seed script
- [ ] Groups CRUD + rotate-key atomic transaction
- [ ] Secrets CRUD + version history + restore
- [ ] Global AuditInterceptor
- [ ] `@nestjs/throttler` per-endpoint limits
- [ ] E2E tests
- [ ] Publish `packages/shared/types/api/*` contracts

**Status:** todo | **Owner:** Backend | **Depends on:** Phase 2

### Phase 4 — Shared Crypto + Nuxt Auth (Frontend)
- [ ] `packages/shared/src/crypto/` (derive, encrypt/decrypt with AAD, group key ops, generators)
- [ ] Vitest: round-trip, AAD-mismatch reject, non-extractability assertion
- [ ] Argon2id Web Worker
- [ ] Nuxt 4 + NuxtUI 4 + Pinia project
- [ ] `useAuthStore` + `useCryptoStore`
- [ ] Login/register/silent-refresh flow
- [ ] Auth middleware on `/vault/**` + `/settings/**`

**Status:** todo | **Owner:** Frontend | **Depends on:** Phase 1; backend types contract for full integration

### Phase 5 — Nuxt Vault UI (Frontend)
- [ ] `/vault/index.vue` table + filters + cursor pagination
- [ ] `/vault/[id].vue` detail + inline edit + 30 s clipboard auto-clear
- [ ] `/generator.vue` standalone
- [ ] `/settings/security.vue` sessions list
- [ ] `/settings/danger.vue` account deletion
- [ ] `useVaultStore` (no persistence) + `useAutoLock`
- [ ] `PasswordInput` with zxcvbn

**Status:** todo | **Owner:** Frontend | **Depends on:** Phase 3 API, Phase 4 crypto

## Post-V1 (deferred but reserved)

### Phase 6 — 2FA (TOTP + WebAuthn)
- [-] Backend: otplib + @simplewebauthn/server, recovery codes
- [-] Frontend: setup-2fa.vue, passkey management

**Status:** deferred

### Phase 7 — Browser Extension (MV3)
- [-] Vite + TS scaffold, popup, content script, service worker
- [-] Reuses `packages/shared/crypto`

**Status:** deferred

### Phase 8 — Production Hardening
- [-] `docker-compose.prod.yml`, Coolify, Cloudflare proxy
- [-] Production nginx (rate limits, security headers, HSTS)
- [-] fail2ban filter + jail, escalating bans
- [-] Backup script (7-daily + 4-weekly + optional rclone)
- [-] UFW firewall (Cloudflare IPs only)
- [-] PWA manifest + service worker
- [-] Dep audit + OWASP review

**Status:** deferred

### Phase 9 — Capacitor Mobile (iOS + Android)
- [-] `apps/mobile/` Capacitor wrapping `apps/web`
- [-] Native Keychain + biometric plugins

**Status:** deferred

### Future roadmap (post-Phase 9)
- [-] Tauri desktop app
- [-] Phone-as-Key (Sub-model A + B)
- [-] Emergency access (trusted contact)
- [-] VaultEntry sharing (asymmetric re-encryption)
- [-] TOTP vault entries
- [-] CLI tool

## Changelog
- 2026-05-27 — Phase 1: monorepo scaffold + Docker stack + test harness landed

## Coverage snapshot
Updated on every test-affecting commit. Numbers from `pnpm -r test --coverage` output.

| Workspace | Lines | Branches | Threshold | Status |
|-----------|-------|----------|-----------|--------|
| `apps/api` | 100% (harness) | 100% (harness) | ≥80% lines | OK |
| `packages/shared` | 100% (harness) | n/a | ≥95% lines (crypto) | OK |
| `apps/web` (stores + composables) | n/a (no source yet) | n/a | ≥70% lines | n/a |

Below threshold = blocking. Drop in coverage on a PR must be justified inline.
