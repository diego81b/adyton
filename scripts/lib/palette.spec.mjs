import { describe, it, expect } from 'vitest';
import { converter } from 'culori';
import {
  buildPalette,
  buildRamp,
  auditAA,
  contrast,
  hueDistance,
  oklchHex,
  DEFAULT_ANCHORS,
  DEFAULT_SEMANTIC_HUES,
} from './palette.mjs';

const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const luminance = (hex) => contrast(hex, '#000000'); // proxy: higher = lighter

describe('oklchHex', () => {
  it('returns an in-gamut 6-digit hex', () => {
    expect(oklchHex(0.5, 0.1, 200)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps out-of-gamut chroma instead of producing null', () => {
    // Absurd chroma that cannot exist in sRGB must still resolve to a hex.
    expect(oklchHex(0.5, 0.9, 200)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('buildRamp', () => {
  const ramp = buildRamp(
    {
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
    },
    Object.fromEntries(STOPS.map((s) => [s, 0.05])),
    200,
  );

  it('emits every stop', () => {
    for (const s of STOPS) expect(ramp[s]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('is monotonically darker from 50 to 950', () => {
    for (let i = 1; i < STOPS.length; i++) {
      expect(luminance(ramp[STOPS[i]])).toBeLessThan(luminance(ramp[STOPS[i - 1]]));
    }
  });

  it('scales chroma when chromaScale changes (more chroma → further from gray)', () => {
    const gray = oklchHex(0.62, 0, 200);
    const low = buildRamp({ 500: 0.62 }, { 500: 0.04 }, 200, 0.25);
    const high = buildRamp({ 500: 0.62 }, { 500: 0.04 }, 200, 2);
    expect(contrast(high[500], gray)).toBeGreaterThanOrEqual(contrast(low[500], gray));
  });
});

describe('buildPalette — default anchors', () => {
  const p = buildPalette();

  it('takes the brand hue from the LIGHT anchor (not an average of the pair)', () => {
    const lightHue = converter('oklch')(DEFAULT_ANCHORS.light).h;
    expect(p.brandHue).toBeCloseTo(lightHue, 1);
  });

  it('pins the default dark surface anchors (regression)', () => {
    expect(p.dark['--ui-bg']).toBe('#0c1318');
    expect(p.dark['--ui-bg-elevated']).toBe('#18262f');
  });

  it('honors the light anchor saturation in the dark CTA (vivid, not washed out)', () => {
    const oklch = converter('oklch');
    const anchorC = oklch(DEFAULT_ANCHORS.light).c;
    const primaryC = oklch(p.dark['--ui-primary']).c;
    expect(primaryC).toBeGreaterThan(anchorC * 0.8); // ramp tracks the anchor's chroma
  });

  it('keeps light page background pure white', () => {
    expect(p.light['--ui-bg']).toBe('#ffffff');
  });

  it('feeds surfaces from the near-neutral family, not the saturated brand ramp', () => {
    // The surface ramp must be far less chromatic than the brand ramp at the
    // dark end (related hue family, much lower chroma) — this is what keeps dark
    // surfaces near-neutral instead of a wall of saturated brand.
    const oklch = converter('oklch');
    const surfaceChroma = oklch(p.surface[950]).c;
    const brandChroma = oklch(p.brand[950]).c;
    expect(surfaceChroma).toBeLessThan(brandChroma * 0.6);
  });

  it('mirrors light and dark on the lightness axis', () => {
    // Dark bg is dark, light bg is light; dark text is light, light text is dark.
    expect(luminance(p.dark['--ui-bg'])).toBeLessThan(luminance(p.light['--ui-bg']));
    expect(luminance(p.dark['--ui-text'])).toBeGreaterThan(luminance(p.light['--ui-text']));
  });

  it('emits full brand, surface and semantic ramps', () => {
    for (const s of STOPS) {
      expect(p.brand[s]).toMatch(/^#[0-9a-f]{6}$/);
      expect(p.surface[s]).toMatch(/^#[0-9a-f]{6}$/);
    }
    for (const name of Object.keys(DEFAULT_SEMANTIC_HUES)) {
      for (const s of STOPS) expect(p.semantic[name][s]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('WCAG audit', () => {
  it('passes AA for the default palette', () => {
    const { pass, rows } = auditAA(buildPalette());
    const failures = rows.filter((r) => !r.pass);
    expect(failures, JSON.stringify(failures)).toHaveLength(0);
    expect(pass).toBe(true);
  });

  it('passes AA when the brand pair is rebranded to a different hue', () => {
    // Single-source promise: swap the anchors, contrast must still hold because
    // the L ladder is fixed. An arbitrary unrelated pair here.
    const rebranded = buildPalette({ anchors: { light: '#c7c9f2', dark: '#1e1b4b' } });
    expect(auditAA(rebranded).pass).toBe(true);
  });
});

describe('semantic hues are distinct from the brand', () => {
  it('keeps success at least 30deg off the brand hue (no same-hue drowning)', () => {
    const p = buildPalette();
    expect(hueDistance(DEFAULT_SEMANTIC_HUES.success, p.brandHue)).toBeGreaterThan(30);
  });

  it('keeps every semantic hue clear of the brand hue', () => {
    const p = buildPalette();
    for (const hue of Object.values(DEFAULT_SEMANTIC_HUES)) {
      expect(hueDistance(hue, p.brandHue)).toBeGreaterThan(30);
    }
  });
});

describe('anchors are exported for the generator', () => {
  it('exposes a light and a dark anchor', () => {
    expect(DEFAULT_ANCHORS.light).toMatch(/^#[0-9a-f]{6}$/i);
    expect(DEFAULT_ANCHORS.dark).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
