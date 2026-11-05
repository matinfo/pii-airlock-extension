declare const chrome: { storage: { sync: { set(v: unknown): Promise<void> } } };
import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EXT = resolve('.output-e2e/chrome-mv3');
const SITE = 'https://chatgpt.com';

const PAGE = `<!doctype html><html><body>
<div id="log"></div>
<div id="editor"></div>
<textarea id="edit" placeholder="edit message"></textarea>
<button id="send" data-testid="send-button" aria-label="Send prompt">Send</button>
<script src="/pm-app.js"></script>
</body></html>`;

export interface Harness {
  context: BrowserContext;
  page: Page;
  /** Raw bodies the fake backend received. */
  sent: string[];
  /** Write extension settings (as the options page would). */
  setSettings(s: Record<string, unknown>): Promise<void>;
}

export const test = base.extend<{ h: Harness }>({
  h: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'pii-e2e-'));
    const context = await chromium.launchPersistentContext(dir, {
      headless: false,
      args: [
        '--headless=new',
        `--disable-extensions-except=${EXT}`,
        `--load-extension=${EXT}`,
      ],
    });
    const sent: string[] = [];
    await context.route(`${SITE}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/send') {
        sent.push(route.request().postData() ?? '');
        return route.fulfill({ status: 200, body: 'ok' });
      }
      if (url.pathname === '/pm-app.js') {
        return route.fulfill({
          contentType: 'text/javascript',
          body: readFileSync('e2e/.dist/pm-app.js', 'utf8'),
        });
      }
      return route.fulfill({ contentType: 'text/html', body: PAGE });
    });
    const page = await context.newPage();
    await page.goto(`${SITE}/`);
    await page.waitForSelector('#prompt-textarea');
    // content script runs at document_idle; give interceptor time to attach
    await page.waitForTimeout(1500);
    const setSettings = async (s: Record<string, unknown>) => {
      let [sw] = context.serviceWorkers();
      sw ??= await context.waitForEvent('serviceworker');
      await sw.evaluate((v) => chrome.storage.sync.set(v), s);
      await page.waitForTimeout(300);
    };
    await use({ context, page, sent, setSettings });
    await context.close();
  },
});
export { expect } from '@playwright/test';
