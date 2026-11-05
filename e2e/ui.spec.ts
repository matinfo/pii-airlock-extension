/**
 * UI behaviour + screenshots in real Chromium. The shadow root is closed, so
 * assertions go through a screenshot-free signal where possible (what was sent)
 * and screenshots are written to test-results/ui for visual review.
 */
import { test, expect } from './fixtures';

const EMAIL = 'jane.roe@example.com';

for (const theme of ['light', 'dark'] as const) {
  test(`chip + toast follow the page theme (${theme})`, async ({ h }) => {
    await h.page.addStyleTag({
      content: theme === 'dark'
        ? 'body{background:#212121;color:#ececec} #editor,#edit{background:#2f2f2f;color:#ececec} #send{background:#ececec;color:#171717}'
        : 'body{background:#fff;color:#171717} #send{background:#171717;color:#fff}',
    });
    await h.page.click('#prompt-textarea');
    await h.page.keyboard.type(`mail me at ${EMAIL}, thanks`);
    await h.page.waitForTimeout(900); // debounce + scan
    await h.page.screenshot({ path: `test-results/ui/chip-${theme}.png` });
    await h.page.keyboard.press('Enter');
    await expect.poll(() => h.sent.length, { timeout: 8000 }).toBe(1);
    await h.page.waitForTimeout(400);
    await h.page.screenshot({ path: `test-results/ui/toast-${theme}.png` });
  });
}

test('review panel screenshot', async ({ h }) => {
  await h.setSettings({ mode: 'review' });
  await h.page.click('#prompt-textarea');
  await h.page.keyboard.type(`mail ${EMAIL} or call +41 79 123 45 67`);
  await h.page.keyboard.press('Enter');
  await h.page.waitForTimeout(900);
  await h.page.screenshot({ path: 'test-results/ui/review.png' });
  expect(h.sent.length).toBe(0);
});
