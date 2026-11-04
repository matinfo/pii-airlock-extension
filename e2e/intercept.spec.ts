/**
 * Leak regressions in a real browser. Every assertion is on what the fake
 * backend RECEIVED, never on the DOM.
 */
import { test, expect, type Harness } from './fixtures';

const EMAIL = 'jane.roe@example.com';
const AUTO = { mode: 'strict', overrides: { EMAIL_ADDRESS: 'auto_scrub', PERSON: 'auto_scrub' } };

async function type(h: Harness, text: string) {
  await h.page.click('#prompt-textarea');
  await h.page.keyboard.type(text);
}
const none = (h: Harness) => h.page.waitForTimeout(2500).then(() => h.sent);
function noRaw(sent: string[]) {
  for (const body of sent) expect(body).not.toContain(EMAIL);
}

test('Enter is intercepted before ProseMirror sends (default policy: dialog, nothing sent)', async ({ h }) => {
  await type(h, `mail me at ${EMAIL} please`);
  await h.page.keyboard.press('Enter');
  noRaw(await none(h));
  expect(h.sent.length).toBe(0);
});

test('Esc closes the dialog and still nothing was sent', async ({ h }) => {
  await type(h, `mail ${EMAIL}`);
  await h.page.keyboard.press('Enter');
  await h.page.waitForTimeout(1000);
  await h.page.keyboard.press('Escape');
  noRaw(await none(h));
  expect(h.sent.length).toBe(0);
});

test('auto-scrub: Enter sends a token, never the email', async ({ h }) => {
  await h.setSettings(AUTO);
  await type(h, `mail me at ${EMAIL} please`);
  await h.page.keyboard.press('Enter');
  await expect.poll(() => h.sent.length, { timeout: 8000 }).toBe(1);
  noRaw(h.sent);
  expect(h.sent[0]).toMatch(/<EMAIL_ADDRESS_\d+>/);
});

for (const combo of ['Control+Enter', 'Meta+Enter']) {
  test(`A2: ${combo} is intercepted`, async ({ h }) => {
    await h.setSettings(AUTO);
    await type(h, `mail ${EMAIL}`);
    await h.page.keyboard.press(combo);
    await expect.poll(() => h.sent.length, { timeout: 8000 }).toBe(1);
    noRaw(h.sent);
  });
}

test('send button click is intercepted', async ({ h }) => {
  await h.setSettings(AUTO);
  await type(h, `mail ${EMAIL}`);
  await h.page.click('#send');
  await expect.poll(() => h.sent.length, { timeout: 8000 }).toBe(1);
  noRaw(h.sent);
});

test('A4: composer remount does not open a gap', async ({ h }) => {
  await h.setSettings(AUTO);
  await h.page.evaluate(() => (window as unknown as { __remount(): void }).__remount());
  // Immediately — no waiting for any observer debounce.
  await type(h, `mail ${EMAIL}`);
  await h.page.keyboard.press('Enter');
  await expect.poll(() => h.sent.length, { timeout: 8000 }).toBe(1);
  noRaw(h.sent);
});

test('A3: edit-message box is guarded', async ({ h }) => {
  await h.page.fill('#edit', `contact ${EMAIL}`);
  await h.page.focus('#edit');
  await h.page.keyboard.press('Enter');
  noRaw(await none(h));
  expect(h.sent.length).toBe(0);
});

test('A8: triple Enter sends once', async ({ h }) => {
  await h.setSettings(AUTO);
  await type(h, `mail ${EMAIL}`);
  await h.page.keyboard.press('Enter');
  await h.page.keyboard.press('Enter');
  await h.page.keyboard.press('Enter');
  await h.page.waitForTimeout(3000);
  expect(h.sent.length).toBe(1);
  noRaw(h.sent);
});

test('clean text still sends', async ({ h }) => {
  await type(h, 'hello there');
  await h.page.keyboard.press('Enter');
  await expect.poll(() => h.sent.length, { timeout: 5000 }).toBe(1);
  expect(h.sent[0]).toContain('hello there');
});

test('Shift+Enter is a newline, not a send', async ({ h }) => {
  await type(h, 'line one');
  await h.page.keyboard.press('Shift+Enter');
  await h.page.keyboard.type('line two');
  await h.page.waitForTimeout(1000);
  expect(h.sent.length).toBe(0);
});
