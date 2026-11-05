/**
 * Restore on page: the backend only ever sees tokens, the page shows real values.
 */
import { test, expect } from './fixtures';

const EMAIL = 'jane.roe@example.com';

/** Simulate a streamed assistant reply that mentions `token`, written token-by-token. */
async function stream(page: import('@playwright/test').Page, token: string) {
  await page.evaluate(async (tok) => {
    const p = document.createElement('p');
    p.id = 'reply';
    document.getElementById('log')!.append(p);
    const node = document.createTextNode('');
    p.append(node);
    for (const piece of ['Sure, I will write to ', tok.slice(0, 5), tok.slice(5), ' today.']) {
      node.nodeValue += piece;
      await new Promise((r) => setTimeout(r, 30));
    }
  }, token);
}

test('a streamed reply shows the real value while only the token was sent', async ({ h }) => {
  await h.page.click('#prompt-textarea');
  await h.page.keyboard.type(`mail me at ${EMAIL} please`);
  await h.page.keyboard.press('Enter');
  await expect.poll(() => h.sent.length, { timeout: 8000 }).toBe(1);
  expect(h.sent[0]).not.toContain(EMAIL);
  const token = /<EMAIL_ADDRESS_\d+>/.exec(h.sent[0]!)![0];

  await stream(h.page, token);
  await expect(h.page.locator('#reply')).toHaveText(`Sure, I will write to ${EMAIL} today.`);
  for (const body of h.sent) expect(body).not.toContain(EMAIL);
});

test('the mapping survives a reload: same token, still restored, numbering continues', async ({ h }) => {
  await h.page.click('#prompt-textarea');
  await h.page.keyboard.type(`mail me at ${EMAIL} please`);
  await h.page.keyboard.press('Enter');
  await expect.poll(() => h.sent.length, { timeout: 8000 }).toBe(1);
  const token = /<EMAIL_ADDRESS_\d+>/.exec(h.sent[0]!)![0];
  await h.page.waitForTimeout(800); // debounce + background save

  await h.page.reload();
  await h.page.waitForSelector('#prompt-textarea');
  await h.page.waitForTimeout(1500);

  await stream(h.page, token);
  await expect(h.page.locator('#reply')).toHaveText(`Sure, I will write to ${EMAIL} today.`);

  await h.page.click('#prompt-textarea');
  await h.page.keyboard.type('and also bob.lee@example.org');
  await h.page.keyboard.press('Enter');
  await expect.poll(() => h.sent.length, { timeout: 8000 }).toBe(2);
  expect(h.sent[1]).toMatch(/<EMAIL_ADDRESS_2>/);
});

test('text in the composer is never rewritten', async ({ h }) => {
  await h.setSettings({ mode: 'off' });
  await h.page.click('#prompt-textarea');
  await h.page.keyboard.type('literal <EMAIL_ADDRESS_1> stays');
  await h.page.waitForTimeout(500);
  await expect(h.page.locator('#prompt-textarea')).toContainText('<EMAIL_ADDRESS_1>');
});
