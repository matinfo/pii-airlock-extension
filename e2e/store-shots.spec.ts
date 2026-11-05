/**
 * Store screenshots (1280x800). Not part of the normal suite: run with
 *   bun run shots
 * Output: store-assets/screenshots/*.png (fake data only, neutral mock chat UI).
 */
import { test, expect } from './fixtures';

test.skip(!process.env.STORE_SHOTS, 'store screenshots only (bun run shots)');
test.use({ viewport: { width: 1280, height: 800 } });

const OUT = 'store-assets/screenshots';
const MSG =
  'Hi, I am Jane Roe. Please draft a reply to jane.roe@example.com and call me on +41 79 123 45 67 about invoice CH93 0076 2011 6238 5295 7.';

const CSS = `
  html,body{height:100%;margin:0;font:16px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;background:#fff;color:#1f2328}
  body{display:flex;flex-direction:column;align-items:center}
  #mock-head{width:100%;box-sizing:border-box;padding:14px 28px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151}
  #log{flex:1;width:760px;max-width:92%;padding:28px 0;overflow:hidden}
  .u,.a{margin:0 0 18px;padding:12px 16px;border-radius:14px;max-width:80%}
  .u{background:#eef2ff;margin-left:auto}
  .a{background:#f3f4f6}
  #editor{width:760px;max-width:92%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:16px;padding:12px 16px;min-height:56px;margin:0 0 56px}
  #editor .ProseMirror{outline:none;min-height:40px}
  #send{position:absolute;right:calc(50% - 360px);bottom:68px;border:0;border-radius:50%;width:34px;height:34px;background:#111827;color:#fff;font-size:0}
  #send::after{content:"\\2191";font-size:18px}
  #edit{display:none}
`;

async function setup(h: import('./fixtures').Harness) {
  await h.page.addStyleTag({ content: CSS });
  await h.page.evaluate(() => {
    const head = document.createElement('div');
    head.id = 'mock-head';
    head.textContent = 'AI Assistant';
    document.body.prepend(head);
    const log = document.getElementById('log')!;
    log.innerHTML =
      '<div class="u">Can you help me write a polite payment reminder?</div>' +
      '<div class="a">Of course. Share the details and I will draft it for you.</div>';
  });
}

test('chip', async ({ h }) => {
  await setup(h);
  await h.page.click('#prompt-textarea');
  await h.page.keyboard.type(MSG);
  await h.page.waitForTimeout(1200);
  await h.page.screenshot({ path: `${OUT}/1-live-chip.png` });
});

test('review panel', async ({ h }) => {
  await setup(h);
  await h.setSettings({ mode: 'review' });
  await h.page.click('#prompt-textarea');
  await h.page.keyboard.type(MSG);
  await h.page.keyboard.press('Enter');
  await h.page.waitForTimeout(1200);
  await h.page.screenshot({ path: `${OUT}/2-review-panel.png` });
  expect(h.sent.length).toBe(0);
});

test('real values restored in the answer', async ({ h }) => {
  await setup(h);
  await h.page.click('#prompt-textarea');
  await h.page.keyboard.type(MSG);
  await h.page.keyboard.press('Enter');
  await expect.poll(() => h.sent.length, { timeout: 8000 }).toBe(1);
  const sent = h.sent[0]!;
  expect(sent).not.toContain('jane.roe@example.com');
  const email = /<EMAIL_ADDRESS_\d+>/.exec(sent)![0];
  await h.page.evaluate((tok) => {
    const log = document.getElementById('log')!;
    const u = document.createElement('div');
    u.className = 'u';
    u.textContent = 'Message sent with placeholders only.';
    const a = document.createElement('div');
    a.className = 'a';
    a.textContent = `Draft: "Hello, thank you for your message. I will reply to ${tok} shortly regarding the invoice."`;
    log.append(u, a);
  }, email);
  await h.page.waitForTimeout(1500);
  await h.page.screenshot({ path: `${OUT}/3-answer-restored.png` });
});

test('options + popup', async ({ h }) => {
  let [sw] = h.context.serviceWorkers();
  sw ??= await h.context.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const opt = await h.context.newPage();
  await opt.setViewportSize({ width: 1280, height: 800 });
  await opt.goto(`chrome-extension://${id}/options.html`);
  await opt.waitForTimeout(1000);
  await opt.screenshot({ path: `${OUT}/4-options.png` });
  const pop = await h.context.newPage();
  await pop.setViewportSize({ width: 360, height: 420 });
  await pop.goto(`chrome-extension://${id}/popup.html`);
  await pop.waitForTimeout(800);
  await pop.screenshot({ path: `${OUT}/5-popup.png` });
});
