/**
 * Renders the toolbar icon variants with a status mark at the top right:
 * on (green dot), warn (orange diamond), off (grey ring). Shapes differ so
 * colour is never the only signal. Output is committed (public/icon-state/),
 * so builds stay reproducible. Run: bun scripts/gen-state-icons.ts
 */
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';

const SIZES = [16, 32, 48];
const STATES = ['on', 'warn', 'off'] as const;
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
      g.drawImage(img, 0, 0, size, size);
      const r = size * 0.22; // mark radius
      const ring = Math.max(1, size / 16);
      const m = (state === 'warn' ? r * 1.2 : r) + ring; // keep halo inside the canvas
      const cx = size - m;
      const cy = m;
      const path = () => {
        g.beginPath();
        if (state === 'warn') { g.moveTo(cx, cy - r * 1.2); g.lineTo(cx + r * 1.2, cy); g.lineTo(cx, cy + r * 1.2); g.lineTo(cx - r * 1.2, cy); g.closePath(); }
        else g.arc(cx, cy, r, 0, Math.PI * 2);
      };
      // light halo so the mark reads on dark and light toolbars
      g.lineJoin = 'round'; g.lineWidth = ring * 2; g.strokeStyle = '#ffffff'; path(); g.stroke();
      g.fillStyle = state === 'on' ? '#16a34a' : state === 'warn' ? '#f59e0b' : '#6b7280';
      path(); g.fill();
      if (state === 'off') { g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, r * 0.45, 0, Math.PI * 2); g.fill(); }
    }, { src, size, state });
    await page.locator('#c').screenshot({ path: `public/icon-state/${state}-${size}.png`, omitBackground: true });
  }
}
await b.close();
console.log('state icons done');
