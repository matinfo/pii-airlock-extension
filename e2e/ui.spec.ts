/**
 * UI behaviour + screenshots in real Chromium. The shadow root is closed, so
 * assertions go through a screenshot-free signal where possible (what was sent)
 * and screenshots are written to test-results/ui for visual review.
 */
declare const chrome: { storage: { local: { set(v: unknown): Promise<void> } } };
import { test, expect, type Harness } from './fixtures';

const EMAIL = 'jane.roe@example.com';

/**
 * Re-dress the fixture like Gemini: a rounded pill holding a + button and the
 * send button, and inside it a rounded, filled text wrapper without buttons.
 * The status tab must land on the pill's top border, not on the inner wrapper.
 */
async function dressAsPill(h: Harness, theme: 'light' | 'dark') {
  const dark = theme === 'dark';
  await h.page.addStyleTag({
    content: `
body{margin:0;min-height:100vh;background:${dark ? '#131314' : '#fff'};color:${dark ? '#e3e3e3' : '#1f1f1f'}}
#pill{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);width:640px;display:flex;align-items:flex-end;gap:8px;
  padding:12px;border-radius:28px;background:${dark ? '#1e1f20' : '#f0f4f9'};border:1px solid ${dark ? '#444' : '#dde3ea'}}
#inner{flex:1;border-radius:16px;background:${dark ? '#1e1f20' : '#f0f4f9'};padding:6px 4px;min-height:24px}
#editor,#prompt-textarea{outline:none;color:inherit;background:transparent}
#edit{display:none}
#plus,#send{width:36px;height:36px;border-radius:50%;border:0;background:${dark ? '#333' : '#e2e7ed'};color:inherit}
#send{background:${dark ? '#e3e3e3' : '#1f1f1f'};color:${dark ? '#1f1f1f' : '#fff'};font-size:0}`,
  });
  await h.page.evaluate(() => {
    const pill = document.createElement('div'); pill.id = 'pill';
    const plus = document.createElement('button'); plus.id = 'plus'; plus.textContent = '+';
    const inner = document.createElement('div'); inner.id = 'inner';
    const editor = document.getElementById('editor')!;
    const send = document.getElementById('send')!;
    document.body.appendChild(pill);
    inner.appendChild(editor);
    pill.append(plus, inner, send);
  });
}

async function pause(h: Harness) {
  let [sw] = h.context.serviceWorkers();
  sw ??= await h.context.waitForEvent('serviceworker');
  await sw.evaluate(() => chrome.storage.local.set({ pausedUntil: Date.now() + 3_600_000 }));
}

for (const theme of ['light', 'dark'] as const) {
  test(`status tab + toast follow the page theme (${theme})`, async ({ h }) => {
    await dressAsPill(h, theme);
    // "Protected" shows before anything is typed (health check), then shrinks.
    await h.page.waitForTimeout(1200);
    await h.page.screenshot({ path: `test-results/ui/tab-${theme}.png` });
    await h.page.waitForTimeout(4500);
    await h.page.screenshot({ path: `test-results/ui/tab-${theme}-shrunk.png` });
    await h.page.click('#prompt-textarea');
    await h.page.keyboard.type(`mail me at ${EMAIL}, thanks`);
    await h.page.waitForTimeout(900); // debounce + scan
    await h.page.screenshot({ path: `test-results/ui/tab-items-${theme}.png` });
    await h.page.keyboard.press('Enter');
    await expect.poll(() => h.sent.length, { timeout: 8000 }).toBe(1);
    expect(h.sent[0]).not.toContain(EMAIL);
    await h.page.waitForTimeout(400);
    await h.page.screenshot({ path: `test-results/ui/toast-${theme}.png` });
  });
}

test('paused: tab says not protected, nothing is scrubbed', async ({ h }) => {
  await dressAsPill(h, 'light');
  await pause(h);
  await h.page.click('#prompt-textarea');
  await h.page.keyboard.type(`mail ${EMAIL}`);
  await h.page.waitForTimeout(900);
  await h.page.screenshot({ path: 'test-results/ui/tab-paused.png' });
  await h.page.keyboard.press('Enter');
  await expect.poll(() => h.sent.length, { timeout: 8000 }).toBe(1);
  expect(h.sent[0]).toContain(EMAIL);
});

test('review panel screenshot', async ({ h }) => {
  await h.setSettings({ mode: 'review' });
  await h.page.click('#prompt-textarea');
  await h.page.keyboard.type(`mail ${EMAIL} or call +41 79 123 45 67`);
  await h.page.keyboard.press('Enter');
  await h.page.waitForTimeout(900);
  await h.page.screenshot({ path: 'test-results/ui/review.png' });
  expect(h.sent.length).toBe(0);
});
