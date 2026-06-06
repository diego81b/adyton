# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

**Phases 1–4 + 4.1 complete** (2026-06-01). Monorepo scaffold, Docker dev stack, NestJS auth, vault API, shared crypto, and Nuxt auth flows are implemented and tested.

**Phase 5 (Nuxt vault UI) in progress** on `feature/phase-5-vault-ui`. Steps 0–2 complete (2026-06-03):
- **Step 0** — auth-UI foundation + mockup retrofit of login/register/unlock: emerald visual system (`bg-grid`/`radial-glow`/`accent-glow` as Tailwind v4 `@utility`, Inter + JetBrains Mono via `@nuxt/fonts`, dark-default); `AuthShell`/`AuthCard`/`BrandLogo`/`PasswordInput`/`PasswordStrengthMeter`/`KeyDerivationStatus` + `usePasswordStrength`.
- **Step 1** — vault data layer (`vault-crypto.ts`, `useVaultStore`), entry list (`/vault`), app shell (`vault` layout, sidebar/bottom-nav, `LockOverlay`, auto-lock).
- **Step 2** — entry detail (`/vault/[id]`), `VaultEntryModal` (add/edit all 6 types, responsive **slideover**), version history + restore, per-LOGIN **TOTP** (RFC 6238 in `packages/shared/src/totp.ts`), reveal/copy (`useReveal` separate from clipboard clear), `.env` export. Plus: `fetchAll` loads the whole vault on unlock (client search is complete — server can't search ciphertext); `VaultFilters` slideover (type + environment; environment shown only for ENV_FILE/SECRET); dedicated `/environments` view **dropped** (folded into filters); nav now Vault/Generator/Settings.

- **Step 4** — `/generator` (2026-06-04): password/passphrase modes, shared `generator.ts` (`generatePassphrase` on the **EFF large wordlist** 7776 words ≈ 12.92 bits/word, CSPRNG + rejection sampling) + entropy helpers (`passwordEntropyBits`/`passphraseEntropyBits` compute from the real pool via exported `buildPasswordPool` — UI never approximates); `useGenerator` + `GeneratedSecret`/`EntropyMeter`; `/generator` added to auth middleware.
- **Step 5** — `/settings` (2026-06-04): **settings are per-user DB-backed** (`users.settings` JSONB, `GET/PUT /api/settings`, merge-patch) with localStorage as boot cache only — they sync across devices for the extension/mobile phases; shared `UserSettings` (`displayName`, `lockMode: activity|absolute`, `lockDurationMs` 0=never or 1–60 min). Auto-lock: duration from settings, `absolute` mode skips activity resets, timer-fired lock **defers while an entry modal is dirty** (`useLockDeferral` + `VaultEntryModal` `v-model:dirty`; explicit lock always wins). `DELETE /api/auth/account` (password re-verify → cascade). Settings page: account / 2FA placeholder / sessions + trusted devices revoke / auto-lock / delete account. No "this device" badge on sessions (refresh cookie is `/api/auth`-scoped — API can't identify the caller's session).

**Phase 5 COMPLETE + verified (2026-06-04).** Int tests run (settings/account-deletion/cors pass; only failures = 2 pre-existing 429 rate-limit ones), snapshots regenerated, full browser smoke of `/generator` + `/settings` done. **CORS fix landed:** `@fastify/cors` v11 defaults to GET,HEAD,POST — explicit `methods` list in `create-app.ts` now allows PUT/PATCH/DELETE (regression test `cors.int-spec.ts`); without it every browser mutation except POST failed preflight.

**Post-Phase-5 UI polish (2026-06-04, browser-verified):** JSON env files (`detectEnvFormat` → raw viewer + `.json` download; dotenv table otherwise); card brand detection (`cardBrand`, simple-icons) + expiry auto-slash; vault cards: type tooltip on tile (no text badge), fixed fuchsia `vN` tag before the title, env as left color stripe, expandable notes section (`@click.stop` everywhere — card click opens detail), two fixed action columns (notes yellow / copy emerald, tile-style); filters apply on Done (draft semantics); chips derive tones from `TILE_CLASS` (sync pinned by test); `apiFetch` non-auth 401 → silent refresh+retry once, dead session → hard redirect `/login`; settings two-column desktop (Account/Vault/Danger left, Security right); width system: layout `max-w-6xl`, pages pin 4xl (vault/detail/generator) or 5xl (settings). Backlog: type/env color legend.

**Phase 6 (2FA) COMPLETE** on `feature/phase-6-2fa` (off the phase-5 tip; phase-5 pushed to origin, phase-6 NOT pushed yet). All 4 steps done (2026-06-06):
- **Step 0 — backend TOTP:** `TwoFactorModule` (`/auth/2fa/setup|enable|disable|recovery-codes|authenticate`). 2FA login issues an **opaque Redis `mfaToken`** (SHA-256-hashed key, TTL 300s, 5-attempt budget) and NO JWT — nothing partial can pass `JwtAuthGuard`; tokens only from `authenticate` via `AuthService.completeLogin()` (extracted, public). TOTP secret AES-256-GCM at rest, key `secrets/totp_enc.key` (gitignored; gen-keys scripts produce it; compose secret `totp_enc_key`, env `TOTP_ENC_KEY_PATH`) — sanctioned ZK exception (architecture.md §3.5); losing the key forces global 2FA re-enrollment. 8 recovery codes Argon2id `m=19456,t=2,p=1`, row deleted on use. `RecoveryCode` entity + migration. otplib v13 functional API; `epochTolerance:30` is SECONDS (pinned by stale-code regression test). jest transforms otplib's ESM-only deps (`transformIgnorePatterns` + `allowJs` — keep).
- **Step 1 — frontend TOTP:** two-phase login (password kept in memory until second factor — needed for vault-key derivation; expired/exhausted token resets to credentials), `TwoFactorChallenge`, settings `TwoFactorCard` + `TwoFactorSetupModal` (QR → verify → recovery codes w/ mandatory ack, modal locked at step c) + `RecoveryCodesList/Modal` + `PasswordPromptModal`. 'View recovery codes' deliberately omitted (server stores hashes only).
- **Step 2 — WebAuthn passkeys:** `WebauthnModule` (`/auth/webauthn/register/*`, `/credentials`, `/authenticate/*`), same mfaToken flow + shared attempt budget, Redis in-flight challenges keyed by user (reg) / token hash (auth). **Passkey registration requires TOTP enabled first** (recovery-code story; V1 constraint). `MfaRequired.methods[]` (webauthn first). Frontend: `useWebAuthn` composable (@simplewebauthn/browser), `PasskeysCard`, passkey button in challenge. rpID/origin: `WEBAUTHN_RP_ID`/`WEBAUTHN_ORIGIN` env (dev defaults localhost/30000).
- **Step 3 — int tests + WebAuthn browser smoke + docs:** `test/integration/two-factor.int-spec.ts` (17 tests: setup/enable/disable/recovery-codes/authenticate happy+error paths, 5-attempt exhaustion, single-use recovery, security invariant mfaToken≠JWT, rate-limit headers) + `test/integration/webauthn.int-spec.ts` (17 tests: register options/verify, credentials GET/DELETE RBAC, authenticate options/verify, rate-limit). ESM transform added to `jest-integration.json` (`transformIgnorePatterns` + `allowJs` — matches unit config). Bug fix: `auth.controller.ts` login was dropping `methods` from `MfaRequired` response, preventing passkey button from rendering in `TwoFactorChallenge`; fixed by adding `methods: result.methods`. WebAuthn browser-smoked end-to-end via Playwright CDP virtual authenticator: register passkey → logout → login → passkey MFA → vault.
- **Verified:** unit suites green (api 204, web 310, shared 71), int tests green (34 new tests), TOTP + WebAuthn flows browser-smoked end-to-end incl. recovery single-use, mfaToken rejected on vault routes, rate-limit headers confirmed.
- **Post-closure bug fix (2026-06-06):** `TwoFactorService.disable` was not deleting `WebAuthnCredential` rows — disabling then re-enabling 2FA left old passkeys active. Fix: `nativeDelete(WebAuthnCredential, { user })` added alongside the existing `RecoveryCode` delete. Regression test in `two-factor.service.spec.ts`.
- **CI landmine:** `secrets/totp_enc.key` is gitignored — int tests will fail on CI until key is provisioned (see `secrets/README.md` + gen-keys scripts).
- **Gotchas:** new api deps need `up -d --build --force-recreate --renew-anon-volumes api` (anonymous node_modules volume survives plain `--build`); pre-commit web test `clears store after logout` is slow under load (15s timeout set — if hook fails at test, re-run `node scripts/precommit-affected.mjs` and retry).
- **WebAuthn rpID display:** passkey label on device shows `rpID` (domain), not `rpName`. In dev always shows "localhost" — correct, unchangeable (rpID is bound to hostname by the WebAuthn spec). In prod set `WEBAUTHN_RP_ID` + `WEBAUTHN_ORIGIN` to the real domain.

Integration contracts (do not regress): API uses `setGlobalPrefix('api')` → `NUXT_PUBLIC_API_BASE_URL` ends in `/api`, refresh cookie path `/api/auth`; `apiFetch` must not send `Content-Type: application/json` on no-body POSTs; `.npmrc` `public-hoist-pattern` lifts shared's client deps (hash-wasm, zxcvbn) and is `COPY`d into dev Dockerfiles. **Migrations:** auto-applied only when `RUN_MIGRATIONS=true` (dev: via container `dev:migrate` CLI on `src`; staging: built image on boot; prod: never — extract SQL with `pnpm --filter @adyton/api migration:sql` and apply manually). Editing `apps/api` source needs `docker compose restart api` (tsc watch misses Windows bind-mount changes).

All implementation work follows the design documents in `analysis/`.

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

## Frontend conventions (Nuxt `apps/web`) — MANDATORY

The mockup at `analysis/frontend/mockups/adyton.html` is the authoritative UI source. Read the relevant `screen-*` section before building any page. The mockup names the accent `violet` but overrides it to **emerald** (`#10b981`); NuxtUI uses `primary: 'emerald'`.

1. **Tailwind-first. No plain CSS scattered around.** Use Tailwind utilities and NuxtUI semantic tokens (`bg-elevated`, `border-default`, `text-muted`, `bg-accented`) that flip with the theme. When a primitive doesn't exist in Tailwind (e.g. `bg-grid`, `radial-glow`, `accent-glow`), define it as a Tailwind v4 `@utility` in `app/assets/css/main.css` — never a loose `.class {}` rule, never `html:not(.dark) .x` selectors. Component-specific styling goes as Tailwind classes in the `.vue`. Maximum concreteness, no over-abstraction.

2. **Pages are thin composition surfaces.** Always evaluate extracting a component or composable from a page. Move UI sections into child components (props down, events up); move stateful/side-effect logic into `composables/useX.ts`. Prefer small focused components + composables over mega-components.

3. **Use the vue/nuxt skills** (`vue-best-practices` is the convention source; also `vue-testing-best-practices`, `nuxt`, `nuxt-ui`, `pinia`, `vueuse-functions`) for Vue/Nuxt work.

4. **Inputs: full-width AND proper height.** `class="w-full"` + `size="lg"` (~42px, matches mockup `py-2.5`). No microscopic forms — not on mobile, not on desktop.

5. **Vue helpers imported explicitly in source** (`import { ref, computed } from 'vue'`) — matches the store convention and keeps files testable under plain vitest. User auto-imported composables must be explicitly imported in pages too (eslint `no-undef` otherwise).

6. **Self-hosted assets only (no CDN):** fonts via `@nuxt/fonts`, icons via `@iconify-json/lucide`. Consistent with zero-knowledge / CSP.

7. **Dev runtime:** run ONE at a time. Native (`run.bat web-local`) OR Docker — never both, they share the bind-mounted `.nuxt` and corrupt each other.

8. **Icon+label action buttons are icon-only on mobile.** Standard guideline: an action `UButton` that carries an icon hides its text label below `sm` and shows it from `sm` up — `icon="i-lucide-x"` + `aria-label="…"` (always, for a11y) + the label in a `<span class="hidden sm:inline">…</span>` default slot (not the `label` prop). Keeps mobile toolbars compact and one-row; labels return on larger screens. Applies to toolbar/inline actions (Add, Filters, Generate, detail action bar, etc.). Primary full-width form submit buttons (Save, Unlock) keep their label everywhere.

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

Branches are per **phase** (and, in future, per issue) — NOT per step.

- Phase branch: `feature/phase-N-<short-name>` (e.g. `feature/phase-5-vault-ui`)
- Numbered steps within a phase are committed **directly to the phase branch** as separate commits (one or more `feat`/`fix`/`test` commits per step). Do NOT create a branch per step.
- No step→phase merge step exists anymore; a "step" is a logical grouping of commits, not a branch.
- (Historical note: Step 0 used a `feature/phase-5-step-0-foundation` branch; that per-step-branch convention is retired as of 2026-06-03.)

## README maintenance — MANDATORY

`README.md` is the public face of the project. Keep it current whenever you change something user-visible.

**On every phase completion**, update `README.md` if any of these changed:
- Roadmap table (`| N | … | Status |`) — flip to `Done` when the phase lands
- Stack table — new technology added or removed
- Setup instructions — new prerequisites, new scripts, changed ports
- Project structure — new top-level directories or workspaces
- The **"How it works"** section — if a new security mechanism was added (new 2FA method, new encryption scope, new entry type, new lock behaviour). This section must stay accurate for a non-technical reader. Do not add jargon; explain the mechanism in plain terms and note what the server can and cannot see.

The "How it works" section is **not a marketing blurb** — it is a plain-language description of the actual security model. If the model changes, the section changes too. If a feature is added that changes what the server knows or does not know, update the "What the server knows / will never know" lists.

Do not rewrite sections unrelated to the current change.

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

These are not optional steps. Do not output "Step N complete" or "Phase N complete" without completing all three.

## Step / phase as issue — MANDATORY workflow

Every step and every phase is treated as an **issue** (a discrete, trackable unit of work).

**Before writing any code**, for each step or phase:

1. **Analyze** — read the relevant `analysis/*.md`, CLAUDE.md status, and memory. Understand scope, dependencies, risks.
2. **Declare tools** — explicitly state which agents, plugins, or skills will be used and why:
   - `feature-dev:code-explorer` or `caveman:cavecrew-investigator` — codebase exploration / locating symbols
   - `feature-dev:code-architect` — design / blueprint before implementation
   - `kairos:implementer-tdd-agent` / `kairos:implementer-coder-agent` — implementation with or without TDD
   - `feature-dev:code-reviewer` or `caveman:cavecrew-reviewer` — diff review after changes
   - `Workflow` — parallel fan-out across independent tracks (backend + frontend + tests)
   - `mcp__plugin_playwright_playwright__*` / `mcp__plugin_chrome-devtools-mcp_chrome-devtools__*` — browser smoke / WebAuthn virtual-authenticator
   - `advisor` — second opinion before committing to approach or declaring done
3. **Confirm** — get user go-ahead on the plan and tool selection before starting.
4. **Execute** — implement, then run the Step / phase completion checklist.

This workflow applies even for "small" steps. Skipping the declare step is not allowed.

## When in doubt

Re-read the relevant `analysis/*.md` file before writing code. The analysis is the source of truth; it took deliberate design work to produce and should not be re-derived from intuition.
