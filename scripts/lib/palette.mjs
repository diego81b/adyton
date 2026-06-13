// Single-source color-system engine for Adyton.
//
// One place defines the brand PAIR (a light anchor + a dark anchor) and the
// semantic hues; everything else — the light theme, the dark theme, and the
// Tailwind utility ramps — is DERIVED from it. Rebranding is "change the two
// anchors, regenerate" instead of hand-editing dozens of hex values.
//
// NOTE: keep comments and docs colour-AGNOSTIC — describe roles (light/dark
// anchor, brand, surface, accent), never a specific colour name. The only place
// a concrete colour value lives is DEFAULT_ANCHORS below + the generated CSS.
//
// How it stays WCAG-safe across a rebrand: every token's OKLCH *lightness* (L)
// is FIXED in the recipe below; only hue (and a global chroma scale) move when
// the anchors change. Contrast is a function of L, so pinning L pins contrast.
// `auditAA` re-verifies the load-bearing pairs and the generator fails on a miss.

import { converter, formatHex, wcagContrast, clampChroma } from 'culori';

const toOklch = converter('oklch');

/**
 * The brand pair — a LIGHT anchor and a DARK anchor. Change these to rebrand.
 * `light` drives the brand accent / CTA hue + saturation; `dark` drives the
 * (desaturated) surface family. The hues are read from these two colors.
 */
export const DEFAULT_ANCHORS = {
  light: '#fff8c9',
  dark: '#002b3f',
};

/**
 * Semantic hues (degrees), pinned deliberately far from the brand hue so that
 * `success` never blends into a same-hue surface (the same-hue drowning problem).
 */
export const DEFAULT_SEMANTIC_HUES = {
  success: 150,
  error: 25,
  warning: 70,
  info: 240,
};

/** Hue references a token can point at. Resolved from the anchors at build time. */
const HUE = {
  BRAND: 'brand',
  NEUTRAL: 'neutral', // surfaces: dark-anchor hue, a touch bluer + near-zero chroma
};

// 11-stop OKLCH lightness ladders. These are perceptual and FIXED — the
// guarantee that contrast survives any hue change.
const BRAND_L = {
  50: 0.97,
  100: 0.93,
  200: 0.864,
  300: 0.79,
  400: 0.7,
  500: 0.62,
  600: 0.503,
  700: 0.43,
  800: 0.36,
  900: 0.306,
  950: 0.2,
};
const BRAND_C = {
  50: 0.02,
  100: 0.03,
  200: 0.03,
  300: 0.045,
  400: 0.052,
  500: 0.055,
  600: 0.055,
  700: 0.052,
  800: 0.05,
  900: 0.051,
  950: 0.034,
};

// Surface ramp: near-neutral. Dark-anchor hue family but with chroma cut hard —
// surfaces read as a near-neutral graphite with only a faint hue undertone, so
// dark mode is never a wall of saturated brand. Chroma rises slightly with
// lightness so elevated surfaces feel a touch warmer than the deepest level.
const SURFACE_L = {
  50: 0.985,
  100: 0.96,
  200: 0.9,
  300: 0.82,
  400: 0.72,
  500: 0.62,
  600: 0.51,
  700: 0.41,
  800: 0.325,
  900: 0.26,
  950: 0.182,
};
const SURFACE_C = {
  50: 0.004,
  100: 0.006,
  200: 0.008,
  300: 0.012,
  400: 0.018,
  500: 0.026,
  600: 0.034,
  700: 0.04,
  800: 0.034,
  900: 0.027,
  950: 0.015,
};

// Semantic ramps share one L/C ladder; only the hue differs.
const SEMANTIC_L = {
  50: 0.97,
  100: 0.94,
  200: 0.88,
  300: 0.8,
  400: 0.72,
  500: 0.64,
  600: 0.55,
  700: 0.46,
  800: 0.4,
  900: 0.35,
  950: 0.26,
};
const SEMANTIC_C = {
  50: 0.03,
  100: 0.05,
  200: 0.08,
  300: 0.11,
  400: 0.14,
  500: 0.16,
  600: 0.16,
  700: 0.14,
  800: 0.12,
  900: 0.1,
  950: 0.07,
};

const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

// Layer 3 — role recipes. Each --ui-* token is {l, c, hue} where hue references
// the brand or the near-neutral surface family. L and C are calibrated to the
// browser-verified desaturated dark theme (2026-06-13); only the hue rotates on
// rebrand. Light and dark are mirrored on the L axis. `tier:'placeholder'` marks
// tokens audited at 3:1 (disabled/placeholder text is WCAG-exempt from 4.5:1).
const LIGHT_TOKENS = {
  '--ui-primary': { ramp: 'brand', stop: 600 }, // white-on-600 ≥ 4.5:1
  '--ui-bg': { hex: '#ffffff' },
  '--ui-bg-muted': { l: SURFACE_L[50], c: SURFACE_C[50], hue: HUE.NEUTRAL },
  '--ui-bg-elevated': { l: SURFACE_L[50], c: SURFACE_C[50], hue: HUE.NEUTRAL },
  '--ui-bg-accented': { l: SURFACE_L[100], c: SURFACE_C[100], hue: HUE.NEUTRAL },
  '--ui-border': { l: SURFACE_L[200], c: SURFACE_C[200], hue: HUE.NEUTRAL },
  '--ui-border-muted': { l: SURFACE_L[100], c: SURFACE_C[100], hue: HUE.NEUTRAL },
  '--ui-border-accented': { l: SURFACE_L[400], c: SURFACE_C[400], hue: HUE.NEUTRAL },
  '--ui-text-dimmed': { l: BRAND_L[500], c: BRAND_C[500], hue: HUE.BRAND, tier: 'placeholder' },
  '--ui-text-muted': { l: BRAND_L[600], c: BRAND_C[600], hue: HUE.BRAND },
  '--ui-text-toned': { l: BRAND_L[700], c: BRAND_C[700], hue: HUE.BRAND },
  '--ui-text': { l: BRAND_L[800], c: BRAND_C[800], hue: HUE.BRAND },
  '--ui-text-highlighted': { l: BRAND_L[950], c: BRAND_C[950], hue: HUE.BRAND },
};
const DARK_TOKENS = {
  '--ui-primary': { ramp: 'brand', stop: 200 }, // light-anchor fill, inverted dark text
  '--ui-bg': { l: 0.182, c: 0.015, hue: HUE.NEUTRAL },
  '--ui-bg-muted': { l: 0.205, c: 0.019, hue: HUE.NEUTRAL },
  '--ui-bg-elevated': { l: 0.261, c: 0.026, hue: HUE.NEUTRAL },
  '--ui-bg-accented': { l: 0.325, c: 0.034, hue: HUE.NEUTRAL },
  '--ui-border': { l: 0.328, c: 0.033, hue: HUE.NEUTRAL },
  '--ui-border-muted': { l: 0.245, c: 0.022, hue: HUE.NEUTRAL },
  '--ui-border-accented': { l: 0.513, c: 0.048, hue: HUE.NEUTRAL },
  '--ui-text-dimmed': { l: 0.7, c: 0.036, hue: HUE.NEUTRAL, tier: 'placeholder' },
  '--ui-text-muted': { l: 0.778, c: 0.05, hue: HUE.BRAND },
  '--ui-text-toned': { l: 0.83, c: 0.05, hue: HUE.BRAND },
  '--ui-text': { l: 0.894, c: 0.012, hue: HUE.NEUTRAL }, // body stays neutral for readability
  // Headings/important values carry the brand accent so the light anchor recurs
  // beyond the CTA — warm-tinted, not flooded.
  '--ui-text-highlighted': { l: 0.93, c: 0.05, hue: HUE.BRAND },
};

/** Build an in-gamut sRGB hex from OKLCH, reducing chroma if it would clip. */
export function oklchHex(l, c, h) {
  return formatHex(clampChroma({ mode: 'oklch', l, c, h }, 'oklch'));
}

/** Resolve a ramp object {stop: hex} from L/C ladders + a hue + a chroma scale. */
export function buildRamp(Lladder, Cladder, hue, chromaScale = 1) {
  const ramp = {};
  for (const s of STOPS) ramp[s] = oklchHex(Lladder[s], Cladder[s] * chromaScale, hue);
  return ramp;
}

/**
 * Build the full palette from anchors. Returns brand/surface/semantic ramps plus
 * the resolved semantic theme tokens (--ui-*) for light and dark.
 */
export function buildPalette({
  anchors = DEFAULT_ANCHORS,
  semanticHues = DEFAULT_SEMANTIC_HUES,
  chromaScale = 1,
} = {}) {
  const lightAnchor = toOklch(anchors.light);
  const darkAnchor = toOklch(anchors.dark);

  // Brand hue = the LIGHT anchor's hue: it is the accent / CTA the user actually
  // picks, so it must read as itself. Surfaces follow the DARK anchor, a touch
  // bluer to read calm. Deriving the brand hue from the light anchor — not an
  // average of the two — is what lets a warm/cool pair hold instead of
  // collapsing to a meaningless middle hue.
  const brandHue = lightAnchor.h;
  const neutralHue = darkAnchor.h + 2;

  // Honor the light anchor's actual saturation: scale the brand ramp so its 200
  // stop matches the anchor's chroma. A vivid anchor then renders vivid instead
  // of washed-out; a low-chroma anchor keeps the scale near 1.
  const brandChromaScale = lightAnchor.c / BRAND_C[200];
  const brand = buildRamp(BRAND_L, BRAND_C, brandHue, chromaScale * brandChromaScale);
  const surface = buildRamp(SURFACE_L, SURFACE_C, neutralHue, chromaScale);
  const semantic = {};
  for (const [name, hue] of Object.entries(semanticHues)) {
    semantic[name] = buildRamp(SEMANTIC_L, SEMANTIC_C, hue, chromaScale);
  }

  // Resolve a recipe entry into a hex. Forms: {hex} literal · {ramp,stop} a brand/
  // surface ramp stop (used so --ui-primary tracks the anchor-faithful ramp) ·
  // {l,c,hue} an explicit OKLCH point (hue = brand/neutral family key).
  const hues = { [HUE.BRAND]: brandHue, [HUE.NEUTRAL]: neutralHue };
  const ramps = { brand, surface };
  const resolve = (recipe) => {
    const out = {};
    for (const [token, def] of Object.entries(recipe)) {
      if (def.hex) out[token] = def.hex;
      else if (def.ramp) out[token] = ramps[def.ramp][def.stop];
      else out[token] = oklchHex(def.l, def.c * chromaScale, hues[def.hue]);
    }
    return out;
  };

  return {
    brandHue,
    neutralHue,
    brand,
    surface,
    semantic,
    light: resolve(LIGHT_TOKENS),
    dark: resolve(DARK_TOKENS),
    recipes: { light: LIGHT_TOKENS, dark: DARK_TOKENS },
  };
}

/** WCAG contrast ratio (1..21) between two hex colors. */
export function contrast(a, b) {
  return wcagContrast(a, b);
}

/**
 * Audit the load-bearing pairs for AA. `largeOnly` pairs only need 3:1.
 * Returns { pass: boolean, rows: [{label, ratio, threshold, pass}] }.
 */
export function auditAA(palette) {
  const { light, dark } = palette;
  const checks = [
    ['light: text on bg', light['--ui-text'], light['--ui-bg'], 4.5],
    ['light: muted on bg', light['--ui-text-muted'], light['--ui-bg'], 4.5],
    ['light: primary fill on bg', light['--ui-primary'], light['--ui-bg'], 3],
    ['light: white on primary', '#ffffff', light['--ui-primary'], 4.5],
    ['dark: text on bg', dark['--ui-text'], dark['--ui-bg'], 4.5],
    ['dark: text on elevated', dark['--ui-text'], dark['--ui-bg-elevated'], 4.5],
    ['dark: muted on bg', dark['--ui-text-muted'], dark['--ui-bg'], 4.5],
    // dimmed is placeholder/disabled tier — WCAG-exempt from 4.5:1, audited at 3:1.
    ['dark: dimmed on elevated', dark['--ui-text-dimmed'], dark['--ui-bg-elevated'], 3],
    ['dark: primary fill on bg', dark['--ui-primary'], dark['--ui-bg'], 3],
    ['dark: inverted text on primary', palette.brand[950], dark['--ui-primary'], 4.5],
    ['dark: border-accented on bg', dark['--ui-border-accented'], dark['--ui-bg'], 3],
  ];
  const rows = checks.map(([label, fg, bg, threshold]) => {
    const ratio = contrast(fg, bg);
    return { label, ratio: Math.round(ratio * 100) / 100, threshold, pass: ratio >= threshold };
  });
  return { pass: rows.every((r) => r.pass), rows };
}

/** Minimum hue distance (degrees, 0..180) between two hues. */
export function hueDistance(a, b) {
  const d = Math.abs(((a - b + 180) % 360) - 180);
  return d;
}
