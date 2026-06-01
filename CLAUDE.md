# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

**Phases 1–4 + 4.1 complete** (2026-06-01). Monorepo scaffold, Docker dev stack, NestJS auth, vault API, shared crypto, and Nuxt auth flows are implemented and tested. Phase 5 (Nuxt vault UI) is next, on branch `feature/phase-5-vault-ui`. All implementation work follows the design documents in `analysis/`.

## Project — Adyton

Self-hosted, zero-knowledge password manager + `.env` / production secrets vault. Designed for personal use on a single VPS, no third-party trust.

Product, repo, and working directory all share the name **Adyton** (Greek ἄδυτον — inner sanctum).

## Where the design lives

The full technical analysis (~5000 lines) is fragmented by scope under `analysis/`. Read `analysis/README.md` first — it is the index. Do not edit `ANALYSIS.original.md`: it is the immutable backup of the monolithic source document.

| Concern | File |
|---|---|
| Exec summary + system architecture | `analysis/00-overview.md` |
| Crypto, JWT, rate limiting, fail2ban | `analysis/security/architecture.md` |
| What the system does / does not guarantee | `analysis/security/guarantees.md` |
| Threat model | `analysis/security/attack-vectors.md` |
| Pentest plan | `analysis/security/pentest.md` |
| NestJS 10 + Fastify backend | `analysis/backend/nestjs.md` |
| MikroORM 6 entities, indexes, migrations | `analysis/backend/database.md` |
| Nuxt 4 + NuxtUI 4 + Pinia | `analysis/frontend/nuxt.md` |
| Mobile-first UX | `analysis/frontend/ux-mobile.md` |
| PWA vs Tauri trade-off | `analysis/frontend/pwa-vs-tauri.md` |
| Manifest V3 browser extension | `analysis/extension.md` |
| `packages/shared` (crypto + types) | `analysis/shared.md` |
| Docker, Coolify, Cloudflare, backup | `analysis/infrastructure.md` |
| Phases 1–9 (V1 scope) | `analysis/roadmap/phases.md` |
| Phone-as-Key (future, post V1) | `analysis/roadmap/device-as-key.md` |

**Always consult the relevant scope file before proposing architectural changes.** If you propose deviating from the design, surface the trade-off explicitly — do not silently diverge.

## Stack

- **Monorepo:** pnpm workspaces — `apps/api`, `apps/web`, `apps/extension`, `packages/shared`
- **Backend:** NestJS 11 (Fastify 5 adapter), MikroORM 6 code-first, PostgreSQL 16, Redis 7
- **Auth:** JWT RS256 — 15 min access in Pinia memory, 7-day refresh as httpOnly cookie, SHA-256 hash of refresh in DB
- **Frontend:** Nuxt 4 + NuxtUI 4 + TailwindCSS + Pinia
- **Extension:** Manifest V3 (Chrome + Firefox shared codebase)
- **Crypto (client-side only):** Argon2id `m=65536, t=3, p=1` → 256-bit AES-256-GCM key as **non-extractable `CryptoKey`**
- **Dev:** Docker Compose — 4 services (api, web, db, redis) — no nginx in dev
- **Prod:** Hetzner VPS + Coolify + Traefik + Cloudflare

## Non-negotiable invariants

Violating any of these breaks the security model. Flag immediately and refuse to implement code that contradicts them.

1. **Zero-knowledge.** The server must never see the master password, the derived vault key, or any plaintext secret. Server stores opaque ciphertext blobs only.
2. **All encryption and decryption happen in the browser/extension.** No "decrypt on the server, just over TLS" shortcuts.
3. **`CryptoKey` must be non-extractable.** Never `exportKey` the vault key. Derive once per unlock, hold in memory, auto-lock clears it.
4. **Argon2id parameters are load-bearing.** Do not lower `m=65536, t=3, p=1` for "performance" without an explicit security review note in the diff.
5. **JWT signing uses RS256 with key pair on disk.** Never HS256, never a shared secret committed to env files.
6. **Refresh tokens are stored hashed (SHA-256) server-side**, not in plaintext. Rotation on every refresh.
7. **Entry types are a fixed enum:** `LOGIN`, `SECURE_NOTE`, `CREDIT_CARD`, `IDENTITY`, `ENV_FILE`, `SECRET`. Adding a type requires shared package changes + migration + UI work — flag the cross-cutting scope.
8. **`ENV_FILE` is stored as one encrypted blob.** Parse to `key=value` only after client-side decrypt. Version history keeps last 10 versions (`VaultEntryVersion`). Environment tag (`production`/`staging`/`development`/`custom`) is plaintext metadata, never a secret.
9. **Unit tests are mandatory on every change.** Every feature, modification, or bug fix lands with unit tests covering the change on the affected layer(s): backend (`apps/api`), shared (`packages/shared`), frontend (`apps/web`). Bug fixes ship a failing regression test in the same commit as the fix. Crypto code requires near-100% coverage (round-trip, AAD-mismatch rejection, non-extractability, parameter validation). Coverage targets V1: backend ≥80% lines, shared crypto ≥95% lines, frontend stores ≥70% lines. Tests-missing is a blocking review finding, not a nit. Pre-commit hook runs `tsc --noEmit` + affected tests; do not use `--no-verify` to bypass.

## Roadmap context

Phases 1–9 (`analysis/roadmap/phases.md`) define V1. Order matters — earlier phases unblock later ones:

1. Monorepo scaffolding + Docker
2. NestJS auth
3. MikroORM entities + migrations + vault API
4. `packages/shared` crypto + Nuxt auth flows
5. Nuxt vault UI
6. 2FA (TOTP + WebAuthn)
7. Browser extension (MV3)
8. Production hardening
9. Capacitor mobile app (iOS + Android)

Phase 10 / Section 16 (Phone-as-Key, WebAuthn PRF, Secure Enclave, QR+ECDH relay, Shamir) is **post-V1** — do not pull this work into V1 phases without explicit user approval.

`packages/shared` is the cross-cutting dependency: backend, frontend, and extension all import from it. Land it early so the other apps can rely on stable crypto + type contracts.

## Working notes for parallel implementation

When multiple agents/scopes work in parallel after Phase 1 lands:

- **Root-level files** (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `docker-compose.yml`) are owned by Phase 1 / infra work. Other scopes must not edit them without coordination.
- **`packages/shared` is upstream of everything.** Bump its version and update consumers in the same change; do not let `apps/api` and `apps/web` drift on different shared versions.
- **API contracts live in `packages/shared/types`.** Backend changes that alter request/response shapes require a shared types update + frontend/extension callers in the same PR.

## Commit style

After every code change, propose a commit message. Format:

```
type(scope): short description          ← subject ≤50 chars
                                        ← blank line (only if body follows)
- bullet explaining why, not what       ← max 3-4 bullets for non-trivial changes
- another bullet
```

Types: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `style`, `perf`, `ci`

Simple or obvious changes: subject line only, no body.

**Never include `Co-Authored-By` or any AI attribution in commit messages.**

## Language

All project output must be in English: commit messages, code comments, documentation, API descriptions, test names. This applies regardless of the language used in conversation.

## Branch workflow — MANDATORY

Each phase and each numbered step within a phase gets its own branch:

- Phase branch: `feature/phase-N-<short-name>` (e.g. `feature/phase-5-vault-ui`)
- Step branch off the phase branch: `feature/phase-N-step-M-<short-name>` (e.g. `feature/phase-5-step-0-foundation`)
- When step is verified, merge step branch into phase branch, then delete step branch
- Never commit step work directly to a phase branch — always via step branch

## Step / phase completion checklist — MANDATORY, no exceptions

Before declaring any step or phase done, always do **all three** of these in order:

**1. Automated verification** — run the relevant test suite and confirm it passes:
- `pnpm --filter @adyton/web test:cov` for frontend changes
- `pnpm --filter @adyton/shared test:cov` for shared changes
- `pnpm --filter @adyton/api test:cov` for backend changes
- TypeScript check: `pnpm --filter <package> typecheck`

**2. Memory update** — write or update memory files under `~/.claude/projects/C--varie-adyton/memory/`:
- Update `project_phase2_plan.md` with current phase/step status and what's next
- Add any new feedback memories for non-obvious decisions made during the work
- Update `MEMORY.md` index if new files were added

**3. Manual test plan** — output a numbered, actionable test plan covering:
- Golden path (register → login → vault unlock flow end-to-end)
- Key edge cases (wrong password, reload, auto-lock timeout)
- Security invariants (ciphertext not readable, cookie httpOnly, AAD rejection)
- Anything automated tests don't cover (real browser behavior, DB state checks, cookie handling)

These are not optional steps. Do not output "Step N complete" or "Phase N complete" or suggest a merge without completing all three.

## When in doubt

Re-read the relevant `analysis/*.md` file before writing code. The analysis is the source of truth; it took deliberate design work to produce and should not be re-derived from intuition.
