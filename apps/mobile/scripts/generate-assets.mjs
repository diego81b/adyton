// Renders the Adyton brand SVG into the source images @capacitor/assets expects
// (assets/icon*.png, assets/splash*.png), then `pnpm assets` turns those into the
// platform-specific launcher icons and splash screens.
//
// Source of truth: apps/web/public/favicon.svg (emerald #09c989 logo, transparent bg).
// Brand background: #0a0e0f (app theme-color).
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const logoSvg = path.resolve(here, '../../web/public/favicon.svg');
const outDir = path.resolve(here, '../assets');
const BG = '#0a0e0f';

await mkdir(outDir, { recursive: true });

// Rasterize the SVG at high density so the upscale stays crisp.
async function logoPng(height) {
  return sharp(logoSvg, { density: 600 })
    .resize({ height, fit: 'contain' })
    .png()
    .toBuffer();
}

async function canvas(size, background, logoHeight, out) {
  const logo = await logoPng(logoHeight);
  await sharp({
    create: { width: size, height: size, channels: 4, background },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(path.join(outDir, out));
  console.log(`written assets/${out}`);
}

// Full icon (iOS + fallback): dark bg, logo at ~62%.
await canvas(1024, BG, 640, 'icon-only.png');
// Adaptive icon foreground: transparent, logo inside the ~66% safe zone.
await canvas(1024, { r: 0, g: 0, b: 0, alpha: 0 }, 470, 'icon-foreground.png');
// Adaptive icon background: solid brand dark.
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: BG } })
  .png()
  .toFile(path.join(outDir, 'icon-background.png'));
console.log('written assets/icon-background.png');
// Splash screens (dark-only brand — same image for light and dark).
await canvas(2732, BG, 600, 'splash.png');
await canvas(2732, BG, 600, 'splash-dark.png');
