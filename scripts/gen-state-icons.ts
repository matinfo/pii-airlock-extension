/**
 * Renders the toolbar warn icon (orange shield: enabled but no chat box found).
 * On and off use the plain blue icon; "protected" is a badge on the composer. Output is committed (public/icon-state/),
 * so builds stay reproducible. Run: bun scripts/gen-state-icons.ts
 */
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';

const SIZES = [16, 32, 48];
const STATES = ['warn'] as const;
mkdirSync('public/icon-state', { recursive: true });

const b = await chromium.launch();
const page = await b.newPage();
for (const size of SIZES) {
  const src = `data:image/png;base64,${readFileSync(`public/icon/${size}.png`).toString('base64')}`;
  for (const state of STATES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:transparent"><canvas id=c width=${size} height=${size}></canvas></body>`);
    await page.evaluate(async ({ src, size, state }) => {
      const c = document.getElementById('c') as HTMLCanvasElement;
      const g = c.getContext('2d')!;
      const img = new Image();
      img.src = src;
      await img.decode();
      // Recolour the shield itself (the grey lock is unaffected by hue shifts).
      g.filter = 'hue-rotate(165deg) saturate(1.3) brightness(1.05)';
      g.drawImage(img, 0, 0, size, size);
    }, { src, size, state });
    await page.locator('#c').screenshot({ path: `public/icon-state/${state}-${size}.png`, omitBackground: true });
  }
}
await b.close();
console.log('state icons done');
