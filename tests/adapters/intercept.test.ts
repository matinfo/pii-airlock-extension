/**
 * SendInterceptor behaviour, driven through a DOM (happy-dom) with a fully
 * controllable fake adapter.
 *
 * SCOPE NOTE — what a JS DOM emulator CAN and CANNOT verify here:
 *   happy-dom (and jsdom) do NOT reproduce real-browser "at-target listeners
 *   fire in registration order" semantics — they segregate capture-before-bubble
 *   on the target element. That is the exact quirk behind the claude.ai leak
 *   (ProseMirror's Enter handler, registered first, fired before our old
 *   composer-level capture listener). So a regression test for THAT specific
 *   bug would false-green on the broken code and is intentionally omitted —
 *   it belongs in a real-browser harness (Playwright/WebDriver-BiDi).
 *
 *   What IS faithfully testable and security-relevant, and is covered below:
 *     - fail-closed: never send when the scrub did not commit to the composer
 *     - the disabled-send-button poll (the chatgpt.com no-send bug)
 *     - policy routing: clean → send, name → auto_scrub → send
 *     - our document-capture listener blocks a page-level handler + the raw text
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import type { ChatAdapter } from '../../lib/adapters/types';
import { applySettings } from '../../lib/policy';

let SendGuard: typeof import('../../lib/intercept').SendGuard;
const guards: Array<{ destroy(): void }> = [];

/** Install a guard; torn down after each test (listeners live on `document`). */
function guard(
  adapter: ChatAdapter,
  opts: import('../../lib/intercept').GuardOptions = {},
) {
  const g = new SendGuard(adapter, opts);
  g.install();
  guards.push(g);
  return g;
}

beforeAll(async () => {
  GlobalRegistrator.register();
  // intercept.ts pulls in UI code that touches DOM globals at module load —
  // import only after the DOM exists.
  ({ SendGuard } = await import('../../lib/intercept'));
});
afterAll(() => GlobalRegistrator.unregister());
afterEach(() => { while (guards.length) guards.pop()!.destroy(); });

beforeEach(() => {
  document.body.innerHTML = '';
  applySettings({ mode: 'strict', overrides: {} });
});

// --- helpers ---------------------------------------------------------------

/** Advance the async pipeline (analyze + rAF verify + send poll) to quiescence. */
async function settle(frames = 30): Promise<void> {
  for (let i = 0; i < frames; i++) {
    await new Promise<void>((res) => requestAnimationFrame(() => res()));
    await Promise.resolve();
  }
}

interface FakeState {
  adapter: ChatAdapter;
  composer: HTMLElement;
  button: HTMLButtonElement;
  sends: { calledWhileDisabled: boolean }[];
  setTextCalls: string[];
}

/**
 * Build a composer + adapter. `commit` controls whether setText actually writes
 * to the composer (true = normal editor, false = editor ignores the mutation,
 * mimicking ProseMirror dropping a raw DOM write).
 */
function makeFake(initial: string, opts: { commit?: boolean; button?: boolean } = {}): FakeState {
  const commit = opts.commit ?? true;
  const composer = document.createElement('div');
  composer.setAttribute('contenteditable', 'true');
  composer.textContent = initial;
  document.body.appendChild(composer);

  const button = document.createElement('button');
  button.textContent = 'Send';
  document.body.appendChild(button);

  const sends: { calledWhileDisabled: boolean }[] = [];
  const setTextCalls: string[] = [];

  const adapter: ChatAdapter = {
    name: 'fake',
    findComposer: () => composer,
    findSendButton: (_c?: HTMLElement) => (opts.button === false ? null : button),
    getText: (c) => c.textContent ?? '',
    setText: (c, text) => {
      setTextCalls.push(text);
      if (commit) c.textContent = text;
    },
    triggerSend: () => {
      sends.push({ calledWhileDisabled: button.disabled });
    },
  };

  return { adapter, composer, button, sends, setTextCalls };
}

function pressEnter(target: HTMLElement): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
}

// --- tests -----------------------------------------------------------------

test('clean text → sends through untouched', async () => {
  const f = makeFake('the weather is nice today');
  guard(f.adapter);

  pressEnter(f.composer);
  await settle();

  expect(f.sends.length).toBe(1);
  expect(f.setTextCalls.length).toBe(0); // nothing scrubbed
});

test('name in strict mode → auto-scrubbed then sent, no raw value', async () => {
  const f = makeFake('Bonjour Mathieu');
  let scrubbed = 0;
  guard(f.adapter, { onScrub: (n) => (scrubbed += n) });

  pressEnter(f.composer);
  await settle();

  expect(f.setTextCalls.length).toBe(1);
  expect(f.setTextCalls[0]).toMatch(/<PERSON_\d+>/);
  expect(f.setTextCalls[0]).not.toContain('Mathieu');
  expect(f.sends.length).toBe(1);
  expect(f.composer.textContent).not.toContain('Mathieu');
  expect(scrubbed).toBeGreaterThan(0);
});

test('FAIL-CLOSED: scrub that does not commit to the composer blocks the send', async () => {
  // Editor ignores the DOM write (commit:false) → composer still holds the raw
  // name after setText. The interceptor must re-read, see the leak, and refuse
  // to send. This is invariant #1/#3 and is fully emulator-independent.
  const f = makeFake('Bonjour Mathieu', { commit: false });
  guard(f.adapter);

  pressEnter(f.composer);
  await settle();

  expect(f.setTextCalls.length).toBe(1);       // it tried to scrub
  expect(f.composer.textContent).toContain('Mathieu'); // but it didn't commit
  expect(f.sends.length).toBe(0);              // and so it MUST NOT send
});

test('disabled send button → poll waits, fires only once button is enabled', async () => {
  const f = makeFake('Bonjour Mathieu');
  f.button.disabled = true; // editor disables send right after input (chatgpt)

  // Re-enable on the 3rd poll, as the editor would once it processes the input.
  // Tied to poll count (not wall-clock) because happy-dom's rAF resolves in ~0ms,
  // so a timer-based re-enable would race the poll out. This also proves the poll
  // actually re-queries findSendButton each frame.
  let polls = 0;
  f.adapter.findSendButton = (_c?: HTMLElement) => {
    if (++polls >= 3) f.button.disabled = false;
    return f.button;
  };

  guard(f.adapter);
  pressEnter(f.composer);
  await settle();

  expect(polls).toBeGreaterThanOrEqual(3);            // it waited, polling each frame
  expect(f.sends.length).toBe(1);
  expect(f.sends[0]!.calledWhileDisabled).toBe(false); // never clicked while disabled
});

test('document-capture listener blocks a page-level Enter handler + the raw text', async () => {
  // Positive direction only (see SCOPE NOTE): proves our interception suppresses
  // a page handler. It canNOT prove the registration-order fix in an emulator.
  const f = makeFake('Bonjour Mathieu');
  let pageSendFired = false;
  f.composer.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.defaultPrevented) pageSendFired = true;
  });

  guard(f.adapter);
  pressEnter(f.composer);
  await settle();

  expect(pageSendFired).toBe(false);
});

test('Shift+Enter is a newline, not a send — passes through to the page', async () => {
  const f = makeFake('Bonjour Mathieu');
  let pageSawShiftEnter = false;
  f.composer.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.shiftKey) pageSawShiftEnter = true;
  });

  guard(f.adapter);
  f.composer.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }),
  );
  await settle(2);

  expect(pageSawShiftEnter).toBe(true); // not intercepted
  expect(f.sends.length).toBe(0);
});

// --- Phase 1 leak regressions ----------------------------------------------

const failing = (async () => ({
  detections: [],
  topTier: 'high',
  decision: 'block',
  error: true,
})) as unknown as typeof import('../../lib/detection/engine').analyze;

test('A1: engine error never sends and never scrubs nothing', async () => {
  const f = makeFake('my email is jane@example.com');
  guard(f.adapter, { analyze: failing });

  pressEnter(f.composer);
  await settle();

  expect(f.sends.length).toBe(0);          // not sent
  expect(f.setTextCalls.length).toBe(0);   // no bogus "scrub" of an empty list
  expect(f.composer.textContent).toContain('jane@example.com');
});

test('A2: Ctrl+Enter and Cmd+Enter are intercepted, not sent raw', async () => {
  for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
    const f = makeFake('Bonjour Mathieu');
    let pageSaw = false;
    f.composer.addEventListener('keydown', () => { pageSaw = true; });
    guard(f.adapter);
    f.composer.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ...mod, bubbles: true, cancelable: true }),
    );
    await settle();
    expect(pageSaw).toBe(false);
    expect(f.composer.textContent).not.toContain('Mathieu');
    expect(f.sends.length).toBe(1);
    guards.pop()!.destroy();
    document.body.innerHTML = '';
  }
});

test('A9: Enter that confirms an IME composition is not a send', async () => {
  const f = makeFake('Bonjour Mathieu');
  let pageSaw = false;
  f.composer.addEventListener('keydown', () => { pageSaw = true; });
  guard(f.adapter);
  f.composer.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }),
  );
  await settle(3);
  expect(pageSaw).toBe(true);        // passed through to the page/IME
  expect(f.sends.length).toBe(0);
  expect(f.setTextCalls.length).toBe(0);
});

test('A8: double Enter sends exactly once', async () => {
  const f = makeFake('Bonjour Mathieu');
  guard(f.adapter);
  pressEnter(f.composer);
  pressEnter(f.composer);
  pressEnter(f.composer);
  await settle();
  expect(f.sends.length).toBe(1);
});

test('A8: text typed during analysis is re-analysed, not overwritten', async () => {
  applySettings({ mode: 'strict', overrides: { PERSON: 'auto_scrub', EMAIL_ADDRESS: 'auto_scrub' } });
  const f = makeFake('Bonjour Mathieu');
  let first = true;
  const { analyze: real } = await import('../../lib/detection/engine');
  guard(f.adapter, {
    analyze: async (t, o) => {
      const r = await real(t, o);
      if (first) { first = false; f.composer.textContent = 'Bonjour Mathieu et jane@example.com'; }
      return r;
    },
  });
  pressEnter(f.composer);
  await settle(60);
  // The newer text was analysed too: the email must be gone from what is sent.
  expect(f.composer.textContent).not.toContain('jane@example.com');
  expect(f.composer.textContent).not.toContain('Mathieu');
});

test('A3: an edit-message box (not the main composer) is guarded too', async () => {
  const f = makeFake('');
  const edit = document.createElement('textarea');
  document.body.appendChild(edit);
  edit.value = 'mail jane@example.com';
  let replayed = false;
  guard(f.adapter);
  // After approval the guard replays Enter on the edit box; record it.
  edit.addEventListener('keydown', (e) => { if (!e.defaultPrevented) replayed = true; });
  edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await settle();
  expect(replayed).toBe(false);  // high-risk email in strict mode → blocked behind a dialog
  expect(f.sends.length).toBe(0);
});

test('A11: an allow-listed entity is not scrubbed along with others', async () => {
  applySettings({ mode: 'strict', overrides: { PERSON: 'allow', EMAIL_ADDRESS: 'auto_scrub' } });
  const f = makeFake('Mathieu wrote from jane@example.com');
  guard(f.adapter);
  pressEnter(f.composer);
  await settle();
  expect(f.composer.textContent).not.toContain('jane@example.com');
  expect(f.composer.textContent).toContain('Mathieu');
  expect(f.sends.length).toBe(1);
});

test('A12: a wrong-scope "Send" button elsewhere on the page is not hijacked', async () => {
  const f = makeFake('hello');
  const stray = document.createElement('button');
  stray.setAttribute('aria-label', 'Send feedback');
  document.body.appendChild(stray);
  let clicked = false;
  stray.addEventListener('click', () => { clicked = true; });
  guard(f.adapter);
  stray.click();
  await settle(3);
  expect(clicked).toBe(true);
  expect(f.sends.length).toBe(0);
});
