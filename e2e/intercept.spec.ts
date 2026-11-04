import { test, expect } from './fixtures';

const RAW_EMAIL = 'jane.roe@example.com';

test('Enter is intercepted before ProseMirror sends raw PII', async ({ h }) => {
  const { page, sent } = h;
  await page.click('#prompt-textarea');
  await page.keyboard.type(`mail me at ${RAW_EMAIL} please`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  for (const body of sent) expect(body).not.toContain(RAW_EMAIL);
});

test('clean text still sends', async ({ h }) => {
  const { page, sent } = h;
  await page.click('#prompt-textarea');
  await page.keyboard.type('hello there');
  await page.keyboard.press('Enter');
  await expect.poll(() => sent.length, { timeout: 5000 }).toBe(1);
  expect(sent[0]).toContain('hello there');
});
