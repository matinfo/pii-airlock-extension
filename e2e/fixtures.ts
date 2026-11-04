import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EXT = resolve('.output/chrome-mv3');
const SITE = 'https://chatgpt.com';

const PAGE = `<!doctype html><html><body>
<div id="editor"></div>
<button id="send" data-testid="send-button" aria-label="Send prompt">Send</button>
<script src="/pm-app.js"></script>
</body></html>`;

export interface Harness {
  context: BrowserContext;
  page: Page;
  /** Raw bodies the fake backend received. */
  sent: string[];
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
    await use({ context, page, sent });
    await context.close();
  },
});
export { expect } from '@playwright/test';
