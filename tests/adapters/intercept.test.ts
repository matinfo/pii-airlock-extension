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
import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { ChatAdapter } from '../../lib/adapters/types';
import { applySettings } from '../../lib/policy';

let SendInterceptor: typeof import('../../lib/intercept').SendInterceptor;

beforeAll(async () => {
  GlobalRegistrator.register();
  // intercept.ts pulls in UI code that touches DOM globals at module load —
  // import only after the DOM exists.
  ({ SendInterceptor } = await import('../../lib/intercept'));
});
afterAll(() => GlobalRegistrator.unregister());

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
    findSendButton: () => (opts.button === false ? null : button),
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
  new SendInterceptor(f.composer, f.adapter);

  pressEnter(f.composer);
  await settle();

  expect(f.sends.length).toBe(1);
  expect(f.setTextCalls.length).toBe(0); // nothing scrubbed
});

test('name in strict mode → auto-scrubbed then sent, no raw value', async () => {
  const f = makeFake('Bonjour Mathieu');
  let scrubbed = 0;
  new SendInterceptor(f.composer, f.adapter, { onScrub: (n) => (scrubbed += n) });

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
  new SendInterceptor(f.composer, f.adapter);

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
  f.adapter.findSendButton = () => {
    if (++polls >= 3) f.button.disabled = false;
    return f.button;
  };

  new SendInterceptor(f.composer, f.adapter);
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

  new SendInterceptor(f.composer, f.adapter);
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

  new SendInterceptor(f.composer, f.adapter);
  f.composer.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }),
  );
  await settle(2);

  expect(pageSawShiftEnter).toBe(true); // not intercepted
  expect(f.sends.length).toBe(0);
});
