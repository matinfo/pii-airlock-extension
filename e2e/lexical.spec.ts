/**
 * Lexical composer (perplexity.ai-style): the scrub must commit to the editor's
 * own state, so what is SENT never contains the raw values.
 */
import { test, expect } from './fixtures';

const EMAIL = 'jane.roe@example.com';

test('Lexical: multi-line message with an email is scrubbed before it is sent', async ({ lx: h }) => {
  await h.page.click('#lexical-root');
  await h.page.keyboard.type(`mail me at ${EMAIL} please`);
  await h.page.keyboard.press('Shift+Enter');
  await h.page.keyboard.type('and call +41 79 123 45 67');
  await h.page.keyboard.press('Enter');
  await expect.poll(() => h.sent.length, { timeout: 8000 }).toBe(1);
  expect(h.sent[0]).not.toContain(EMAIL);
  expect(h.sent[0]).not.toContain('123 45 67');
  expect(h.sent[0]).toMatch(/<EMAIL_ADDRESS_\d+>/);
  // nothing lost: the second line and its token arrive too
  expect(h.sent[0]).toMatch(/and call <PHONE_NUMBER_\d+>/);
});
