/**
 * Composes the raw captures in screenshots/ onto 1280x800 opaque canvases for
 * the Chrome Web Store (and reuse on AMO). Run: bun run store:assets
 * Output: store-assets/chrome/*.png
 */
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';

interface Shot { file: string; out: string; caption: string; box: [number, number]; top?: boolean }
const SHOTS: Shot[] = [
  { file: 'composer-with-pii-detection.png', out: '1-live-chip', caption: 'See what will be replaced, as you type', box: [1120, 323] },
  { file: 'composer-with-pii-review.png', out: '2-review', caption: 'Review before sending, untick anything', box: [643, 580] },
  { file: 'popup.png', out: '3-popup', caption: 'Protection per site, one click', box: [446, 585] },
  { file: 'settings.png', out: '4-settings', caption: 'Choose a mode, add better name detection', box: [1000, 540], top: true },
];

const b64 = (f: string) => `data:image/png;base64,${readFileSync(`screenshots/${f}`).toString('base64')}`;
mkdirSync('store-assets/chrome', { recursive: true });

const browser = await chromium.launch();
for (const s of SHOTS) {
  const [w, h] = s.box;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent(`<!doctype html><body style="margin:0;width:1280px;height:800px;background:#0f1b33;
    font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center">
    <div style="font-size:40px;font-weight:700;letter-spacing:-0.01em;margin:0 0 40px">${s.caption}</div>
    <img src="${b64(s.file)}" style="width:${w}px;height:${h}px;object-fit:${s.top ? 'cover' : 'contain'};object-position:${s.top ? 'top' : 'center'};
      border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.45)">
    </body>`);
  await page.screenshot({ path: `store-assets/chrome/${s.out}.png` });
  await page.close();
}
await browser.close();
console.log('composed', SHOTS.length);
