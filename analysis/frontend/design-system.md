# Design System — Brand Palette & Tokens

> The mockup (`analysis/frontend/mockups/adyton.html`) remains authoritative for
> **layout and structure**; colors follow this document.
>
> **Colour-agnostic doc rule:** describe ROLES (light anchor, dark anchor, brand,
> surface, accent, semantic), never a specific colour name or hex — otherwise
> every rebrand would mean editing this file in a dozen places. The only place a
> concrete colour value lives is `DEFAULT_ANCHORS` in `scripts/lib/palette.mjs`
> plus the generated block in `main.css`. Both are produced by the generator.

## 1. The brand pair

The palette is built from **two anchors**: a LIGHT colour and a DARK colour.

- The **light anchor** drives the brand accent / CTA hue + saturation.
- The **dark anchor** drives the (desaturated) surface family.

To see or change the current pair, look at `DEFAULT_ANCHORS` — that is the
single editable source. Anchors must clear WCAG when paired (the generator's
audit enforces it).

### The pairing rule (non-negotiable)

**Dark (brand-family) surfaces carry light-anchor-family text, and vice versa.**
Never neutral-gray-on-brand, never same-hue-on-same-hue at adjacent values.

**Dark surfaces are desaturated.** App surfaces (page, cards, sidebar, modals)
draw from the near-neutral `surface` ramp — the dark-anchor hue family with
chroma cut hard — not the saturated brand. This keeps the pairing rule while
preventing dark mode from becoming a wall of one saturated hue. The dark anchor
still renders true on the **auth split-panel** (a deliberate brand surface, not
a `--ui-bg`).

## 2. Single source of truth — generated palette (2026-06-13)

The palette is **generated from the two anchors**, not hand-authored. One
engine + one CLI own every shade, both themes, and the semantic colors:

| File | Role |
|---|---|
| `scripts/lib/palette.mjs` | pure engine: OKLCH ramps, role recipes, WCAG audit (vitest-tested) |
| `scripts/gen-palette.mjs` | CLI: anchors → rewrites the GENERATED block in `main.css`, prints WCAG table, **exits non-zero on any AA miss** |
| `apps/web/app/assets/css/main.css` | the `=== ADYTON PALETTE — GENERATED ===` block (DO NOT hand-edit) |

```
node scripts/gen-palette.mjs                            # regenerate from defaults
node scripts/gen-palette.mjs --light '<hex>' --dark '<hex>'   # rebrand
node scripts/gen-palette.mjs --check                    # audit only, no write
```
npm aliases: `pnpm palette` / `pnpm palette:check` / `pnpm test:palette`.

### How it works (three layers)

1. **Source** — `DEFAULT_ANCHORS` (a light + a dark anchor) in `palette.mjs`.
   The brand hue is read from the LIGHT anchor (the accent the user picks); the
   surface hue follows the DARK anchor, a touch bluer. The brand ramp's chroma
   is scaled to the light anchor's own saturation, so a vivid anchor stays vivid.
   `DEFAULT_SEMANTIC_HUES` pins success/error/warning/info **away** from the
   brand hue so `success` never blends into a same-hue surface.
2. **Ramps (derived)** — three 11-stop OKLCH ramps emitted into `@theme static`:
   - `--color-brand-*` — accents / primary **only**.
   - `--color-surface-*` — near-neutral graphite with a faint hue undertone
     (chroma cut hard vs brand). **All surfaces draw from this ramp, never from
     the saturated brand ramp — this is what keeps dark mode from becoming a
     wall of one hue.**
   - `--color-success/error/warning/info-*` — semantic, wired in `app.config.ts`.
3. **Role mapping (derived)** — `:root` + `.dark` `--ui-*` tokens, **mirrored on
   the lightness axis**. The token L (lightness) values are FIXED in the recipe;
   only the hue rotates on rebrand. **Contrast is a function of L, so pinning L
   pins WCAG compliance** — the generator's audit re-verifies every load-bearing
   pair and refuses to write on a miss.

### Why a rebrand can't break accessibility

Because L is frozen and only hue moves, swapping the anchors to any hue keeps
the same contrast ratios. `palette.spec.mjs` proves this: it rebrands to an
unrelated pair and asserts the audit still passes AA.

### Changing the palette = change two anchors, run one command

Edit `DEFAULT_ANCHORS` (or pass `--light/--dark`), run the generator. Both
themes, auth split-panel, vault chrome, TOTP ring, glows, and semantic colors
follow. The light/dark **role mapping is written once** in the recipe and is
invariant to the anchors — you never touch it on a rebrand.

## 3. Manual sync points (static assets — cannot reference CSS vars)

These hold literal colour values (raster/meta cannot reference CSS vars), so they
must be re-synced by hand after a rebrand. Read the target value from the
generator output (`pnpm palette` prints every ramp) at the role noted below —
never type a hex from memory. **Backlog:** these are still on the previous brand
and drift behind the generated ramp; resync + APK rebuild is cosmetic, deferred.

| File | Value | Role to copy from generator |
|---|---|---|
| `apps/web/public/favicon.svg` | `fill=…` (×2) | brand-500 |
| `apps/web/nuxt.config.ts` | `theme-color` meta | surface-950 |
| `apps/web/public/manifest.json` | `background_color` + `theme_color` | surface-950 |
| `apps/mobile/capacitor.config.ts` | `SplashScreen.backgroundColor` | surface-950 |
| `apps/mobile/scripts/generate-assets.mjs` | `BG` | surface-950 |

Then run: regenerate web raster icons from favicon.svg (favicon.ico,
apple-touch-icon, icon-192/512/maskable — sharp one-off, see git history) and
`pnpm --filter @adyton/mobile assets` (Capacitor launcher + splash, both
platforms). Mobile requires an APK/IPA rebuild to ship.

`apps/web/public/logo.svg` uses `currentColor` — never needs syncing.

## 4. Load-bearing gotchas

1. **`@theme static` is required.** Tailwind v4 tree-shakes unused `@theme`
   variables. Shades referenced only through NuxtUI's `--ui-color-primary-*`
   aliases (e.g. brand-600, the light primary) produce **no utility class** and
   get pruned without `static` → empty tokens, transparent buttons.
2. **`--ui-color-brand-*` does not exist.** NuxtUI mints vars only for its
   semantic aliases (`primary`, `neutral`, …). Reference the raw scale as
   `var(--color-brand-N)`.
3. **Dark CTA is brand-200, not a mid stop.** A mid stop reads washed-out on the
   dark surfaces; the light-anchor fill with inverted text is the signature
   pairing. Don't force `text-white` on primary buttons — NuxtUI's `text-inverted`
   resolves correctly per theme.
4. **Dark inputs**: `dark:bg-surface-800/40` via `app.config.ts` ui slots
   (input/textarea/select) — a filled well from the surface ramp, slightly
   raised from card/page backgrounds (sidesteps the input-border 3:1 problem).
5. **Typography**: Inter (sans) + JetBrains Mono, self-hosted via `@nuxt/fonts`
   (no CDN — CSP/zero-knowledge posture). Unchanged by the rebrand.

## 5. Button hierarchy (2026-06-13 — mandatory)

One system across the whole app. Pick by role, not by taste:

| Role | Recipe | Notes |
|---|---|---|
| Primary CTA | `color="primary"` solid | **One per screen.** Never force `text-white` (breaks the dark pairing — NuxtUI's `text-inverted` resolves per theme). `accent-glow` only on auth/lock screens (login, register, unlock, 2FA challenge, LockOverlay); in-app actions stay flat. |
| Leading page action | `color="primary" variant="subtle"` | e.g. detail-page Edit when a solid primary already exists or isn't warranted. |
| Secondary | `color="neutral" variant="subtle"` | Bordered tint — the default for toolbar/inline actions (Filters, Export, History, Regenerate…). `variant="soft"` is retired for buttons. |
| Tertiary / dismiss | `color="neutral" variant="ghost"` | Modal Cancel/Close/Back/Reset, inline copy/reveal, header chrome. |
| Destructive trigger | `color="error" variant="subtle"` | Delete entry / account row buttons. |
| Destructive confirm | `color="error"` solid | Only inside confirm dialogs, paired with a ghost Cancel. |

## 6. Theme-adaptive accent classes (mandatory)

Any non-semantic Tailwind palette color on text must ship both modes:
light `*-600/700/800` + `dark:*-200/300/400`. A bare `text-rose-300`/`text-amber-400`
is a bug — illegible on white. Canonical shapes (see `entry-display.ts` TILE_CLASS):

- tint tiles: `bg-{c}-500/10 border-{c}-500/25 text-{c}-700 dark:bg-{c}-400/10 dark:border-{c}-400/20 dark:text-{c}-300`
- danger text: `text-rose-700 dark:text-rose-300` (headings `rose-600 dark:rose-400` for icons)

Theme preference is per-device (`@nuxtjs/color-mode` localStorage, selector in
Settings → Appearance via `AppearanceCard`), deliberately not in DB-backed settings.

## 7. Contrast reference (verified)

| Pair | Ratio | Use |
|---|---|---|
| brand-200 on brand-900/950 | 8.8–13.5:1 | dark CTA, panel text |
| brand-300 on brand-950 | 10.2:1 | dark muted text |
| brand-400 on brand-950 | 7.0:1 | dark dimmed text |
| white on brand-600 | 5.8:1 | light CTA |
| brand-600 on white | 5.8:1 | light muted/link text |
| brand-800 on brand-200 | ~6.5:1 | light panel body text |
| brand-400 on white | 2.9:1 | light input borders (non-text, ~3:1) |

## 8. Swiss-enterprise layout layer (2026-06-13 — mandatory for app screens)

The app screens (vault list, vault detail, settings) share ONE layout grammar so nothing
looks foreign. Grounded in `ui-ux-pro-max` → Swiss/Minimal enterprise. The generated palette
is unchanged; coherence comes from token discipline + shared primitives.

- **Radius — single scale.** Containers/rows `rounded-lg`; chips/tiles/small controls
  `rounded-md`. Do NOT use `rounded-xl`/`rounded-2xl` on app screens.
- **Surface elevation.** L0 page `bg-default`; L1 group = ONE hairline container
  (`border border-default rounded-lg`, `bg-elevated` only to lift); rows inside split by
  `divide-y divide-default`. No card-in-card. Shadow none (≤ `shadow-xs`).
- **Type roles.** Section header `text-[11px] font-semibold uppercase tracking-wider text-dimmed`;
  row label `text-sm font-medium text-default`; value/helper `text-sm`/`text-[13px] text-muted`;
  data values `font-mono tabular-nums`.
- **Accent discipline (brand/gold).** Only on: the single primary CTA per screen, the active
  nav/segment, `focus-visible` ring, and a status dot. Everything else neutral/surface.
  Destructive = `error`, spatially separated.
- **Numbers** (counts, IPs, dates, vN, TOTP): `tabular-nums`.
- **Shared primitives:** `SettingsGroup.vue` (uppercase header + hairline `divide-y` container)
  and `SettingRow.vue` (`flex-wrap` label/helper/value/`#action` row — wrap is load-bearing so a
  long value can never squeeze the action out of the container).
