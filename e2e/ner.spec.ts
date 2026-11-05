/**
 * Phase 3 in a real Chromium: no network before opt-in; after the user clicks
 * "Download", the pinned model is fetched, verified and used to catch a name no
 * list contains. HF is served from .cache/ner-model (bun run fetch:ner --model).
 */
import { test, expect } from './fixtures';
import { startModelServer } from './model-server';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const MODEL_DIR = '.cache/ner-model';
const NAME = 'Oluwaseun Adeyemi-Okonkwo';
const AUTO = { mode: 'strict', overrides: { PERSON: 'auto_scrub' } };

async function extensionId(h: { context: import('@playwright/test').BrowserContext }) {
  let [sw] = h.context.serviceWorkers();
  sw ??= await h.context.waitForEvent('serviceworker');
  return new URL(sw.url()).host;
}

test('no request to the model host before opt-in; names fall back to L1+L2', async ({ h }) => {
  const hf: string[] = [];
  h.context.on('request', (r) => { if (/huggingface\.co|hf\.co/.test(r.url())) hf.push(r.url()); });
  await h.setSettings(AUTO);
  await h.page.click('#prompt-textarea');
  await h.page.keyboard.type(`please ask ${NAME} to call back`);
  await h.page.keyboard.press('Enter');
  await h.page.waitForTimeout(3000);
  expect(hf).toEqual([]);
});

test('opt-in: download is verified, then an unlisted name is scrubbed', async ({ h }) => {
  test.skip(!existsSync(join(MODEL_DIR, 'onnx/model_quantized.onnx')), 'run: bun run fetch:ner --model');
  test.setTimeout(180_000);
  const hf: string[] = [];
  const srv = await startModelServer(MODEL_DIR, hf);
  const id = await extensionId(h);
  const opts = await h.context.newPage();
  await opts.goto(`chrome-extension://${id}/options.html`);
  expect(hf).toEqual([]); // opening the page requests nothing
  await opts.getByRole('button', { name: /Download model/ }).click();
  await expect(opts.getByText(/Installed/)).toBeVisible({ timeout: 120_000 });
  expect(hf.length).toBe(4);
  srv.close();
  expect(hf.every((u) => /\/resolve\/263e82c06569c8c2ac46238a7ae5107598934234\//.test(u))).toBe(true);

  await h.setSettings(AUTO);
  await h.page.bringToFront();
  await h.page.click('#prompt-textarea'); // focus warms the model
  // wait until the model answers inside the 400 ms budget
  await expect.poll(async () => {
    h.sent.length = 0;
    await h.page.keyboard.type(`please ask ${NAME} to call back`);
    await h.page.keyboard.press('Enter');
    await h.page.waitForTimeout(2500);
    const ok = h.sent.length > 0 && !h.sent.join('').includes('Oluwaseun');
    if (!ok) await h.page.keyboard.press('Control+A'), await h.page.keyboard.press('Delete');
    return ok;
  }, { timeout: 90_000, intervals: [1000] }).toBe(true);
  expect(h.sent.join('')).toMatch(/<PERSON_\d+>/);
  expect(h.sent.join('')).not.toContain('Adeyemi');
});
