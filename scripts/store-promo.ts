/** Renders the store promo images with Playwright. Run: bun run promo */
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';

const icon = `data:image/png;base64,${readFileSync('public/icon/128.png').toString('base64')}`;
mkdirSync('store-assets/promo', { recursive: true });

const html = (w: number, h: number, big: boolean) => `<!doctype html><html><body style="margin:0;width:${w}px;height:${h}px;
background:#0f1b33;color:#fff;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center">
<div style="display:flex;align-items:center;gap:${big ? 40 : 22}px;padding:0 ${big ? 80 : 28}px">
<img src="${icon}" style="width:${big ? 200 : 96}px;height:${big ? 200 : 96}px">
<div>
<div style="font-size:${big ? 76 : 38}px;font-weight:700;letter-spacing:-0.02em">PII Airlock</div>
<div style="font-size:${big ? 34 : 19}px;line-height:1.3;margin-top:${big ? 14 : 8}px;color:#c9d6f2">Personal data replaced before<br>your AI chat message is sent.</div>
<div style="font-size:${big ? 24 : 14}px;margin-top:${big ? 22 : 12}px;color:#8fa3cf">On-device. No account. No server.</div>
</div></div></body></html>`;

const b = await chromium.launch();
for (const [name, w, h, big] of [['promo-small-440x280', 440, 280, false], ['promo-marquee-1400x560', 1400, 560, true]] as const) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.setContent(html(w, h, big));
  await p.screenshot({ path: `store-assets/promo/${name}.png` });
}
await b.close();
console.log('promo done');
