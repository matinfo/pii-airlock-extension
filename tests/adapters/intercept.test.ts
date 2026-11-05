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
  applySettings({ mode: 'auto', overrides: {}, siteOff: false, pausedUntil: 0 });
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
  applySettings({ mode: 'auto', overrides: { PERSON: 'auto_scrub', EMAIL_ADDRESS: 'auto_scrub' } });
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
  // auto mode scrubs the edit box in place, then replays the user's Enter
  expect(edit.value).not.toContain('jane@example.com');
  expect(edit.value).toMatch(/<EMAIL_ADDRESS_\d+>/);
  expect(replayed).toBe(true);
});

test('review mode: nothing is sent or changed until the user decides; Esc cancels', async () => {
  applySettings({ mode: 'review' });
  const f = makeFake('mail jane@example.com');
  guard(f.adapter);
  pressEnter(f.composer);
  await settle();
  expect(f.sends.length).toBe(0);
  expect(f.composer.textContent).toContain('jane@example.com');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  expect(f.sends.length).toBe(0);
  expect(f.composer.textContent).toContain('jane@example.com');
});

test('mode off: the guard steps aside completely', async () => {
  applySettings({ mode: 'off' });
  const f = makeFake('mail jane@example.com');
  guard(f.adapter);
  const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  f.composer.dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(false);
});

test('site switched off and active pause both step aside; pause expiry resumes', async () => {
  const f = makeFake('mail jane@example.com');
  guard(f.adapter);
  applySettings({ siteOff: true });
  let ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  f.composer.dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(false);
  applySettings({ siteOff: false, pausedUntil: Date.now() + 60_000 });
  ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  f.composer.dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(false);
  applySettings({ pausedUntil: Date.now() - 1 });
  ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  f.composer.dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(true);
});

test('allow-list: an allowed value is sent as typed', async () => {
  const { setLists, EMPTY_LISTS } = await import('../../lib/lists');
  setLists({ allow: ['jane@example.com'] });
  const f = makeFake('mail jane@example.com');
  guard(f.adapter);
  pressEnter(f.composer);
  await settle();
  setLists(EMPTY_LISTS);
  expect(f.sends.length).toBe(1);
  expect(f.composer.textContent).toContain('jane@example.com');
});

test('A11: an allow-listed entity is not scrubbed along with others', async () => {
  applySettings({ mode: 'auto', overrides: { PERSON: 'allow', EMAIL_ADDRESS: 'auto_scrub' } });
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

test("Quill's hidden .ql-clipboard input after a paste does not hijack the live scan (gemini chip)", async () => {
  const f = makeFake('write to jane@example.com');
  const clip = document.createElement('div'); // Quill parks focus + fires input here on paste
  clip.className = 'ql-clipboard';
  clip.setAttribute('contenteditable', 'true');
  document.body.appendChild(clip);
  guard(f.adapter);

  f.composer.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));
  clip.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 600));
  await settle(3);

  expect(document.getElementById('pii-airlock-ui')).not.toBeNull(); // chip rendered
});

test('a live scan pending at send time does not bring the chip back after send', async () => {
  const f = makeFake('write to jane@example.com');
  const { shield } = await import('../../lib/ui/components');
  const orig = shield.render.bind(shield);
  let last: number | null = null;
  shield.render = (state, keep) => { last = state.items.length + state.notices.length; return orig(state, keep); };
  try {
    guard(f.adapter);
    f.composer.dispatchEvent(new Event('input', { bubbles: true })); // schedules a scan
    pressEnter(f.composer);                                          // send before it fires
    await new Promise((r) => setTimeout(r, 700));
    await settle(5);
    expect(f.sends.length).toBe(1);
    expect(last).toBe(0); // chip cleared, never redrawn
  } finally {
    shield.render = orig;
  }
});

test('"Confirm after sending" off: the message still goes out scrubbed, with no toast', async () => {
  const { shield } = await import('../../lib/ui/components');
  const orig = shield.toast.bind(shield);
  let toasts = 0;
  shield.toast = (...a) => { toasts++; return orig(...a); };
  try {
    for (const [confirmAfterSend, expected] of [[true, 1], [false, 0]] as const) {
      toasts = 0;
      applySettings({ mode: 'auto', overrides: {}, siteOff: false, pausedUntil: 0, confirmAfterSend });
      document.body.innerHTML = '';
      const f = makeFake('write to jane@example.com');
      const g = guard(f.adapter);
      pressEnter(f.composer);
      await settle();
      expect(f.sends.length).toBe(1);
      expect(f.composer.textContent).not.toContain('jane@example.com');
      expect(toasts).toBe(expected);
      g.destroy();
    }
  } finally {
    shield.toast = orig;
    applySettings({ confirmAfterSend: true });
  }
});

// Send buttons are localised by the chat sites; the send must be intercepted in each
// interface language of the extension (+PT/NL), even when the adapter does not know
// the button and it sits several levels away from the composer (Gemini layout).
for (const label of [
  'Send message', 'Envoyer le message', 'Nachricht senden', 'Enviar mensaje',
  'Invia messaggio', 'Enviar mensagem', 'Bericht verzenden',
]) {
  test(`localised send button is intercepted: "${label}"`, async () => {
    document.body.innerHTML = `<div id="shell"><div class="a"><div class="b"><div class="c"><div class="d">
      <div id="ed" contenteditable="true">my mail jane@example.com</div></div></div>
      <div class="e"><button aria-label="${label}" id="go"></button></div></div></div></div>`;
    const composer = document.getElementById('ed')!;
    const sends: number[] = [];
    const adapter: ChatAdapter = {
      name: 'fake', findComposer: () => composer, findSendButton: () => null,
      getText: (c) => c.textContent ?? '', setText: (c, t) => { c.textContent = t; },
      triggerSend: () => { sends.push(1); },
    };
    guard(adapter);
    let pageSaw = false;
    document.getElementById('go')!.addEventListener('click', () => { pageSaw = true; });
    document.getElementById('go')!.click();
    await settle();
    expect(pageSaw).toBe(false);
    expect(composer.textContent).not.toContain('jane@example.com');
    expect(sends.length).toBe(1);
  });
}

test('an icon-only send button (no readable label) is intercepted', async () => {
  document.body.innerHTML = `<div><div><div><div><div>
    <div id="ed" contenteditable="true">call +41 79 367 45 67</div></div></div></div>
    <button id="go" aria-label="???"><mat-icon data-mat-icon-name="arrow_upward"></mat-icon></button></div></div>`;
  const composer = document.getElementById('ed')!;
  const sends: number[] = [];
  const adapter: ChatAdapter = {
    name: 'fake', findComposer: () => composer, findSendButton: () => null,
    getText: (c) => c.textContent ?? '', setText: (c, t) => { c.textContent = t; },
    triggerSend: () => { sends.push(1); },
  };
  guard(adapter);
  document.getElementById('go')!.click();
  await settle();
  expect(composer.textContent).not.toContain('367 45 67');
  expect(sends.length).toBe(1);
});

test('an unrelated button elsewhere is not hijacked (wider scope stays safe)', async () => {
  document.body.innerHTML = `<div><div id="ed" contenteditable="true">hello</div></div>
    <aside><div><div id="side" contenteditable="true">notes</div><button aria-label="Enviar comentarios" id="other"></button></div></aside>`;
  const composer = document.getElementById('ed')!;
  const adapter: ChatAdapter = {
    name: 'fake', findComposer: () => composer, findSendButton: () => null,
    getText: (c) => c.textContent ?? '', setText: (c, t) => { c.textContent = t; },
    triggerSend: () => {},
  };
  guard(adapter);
  let clicked = false;
  document.getElementById('other')!.addEventListener('click', () => { clicked = true; });
  document.getElementById('other')!.click();
  await settle(3);
  expect(clicked).toBe(true);
});

// --- safety net: send buttons we cannot recognise ---------------------------

function unknownButtonPage(extra = '', text = 'my mail jane@example.com') {
  document.body.innerHTML = `<div><div><div><div>
    <div id="ed" contenteditable="true">${text}</div></div></div>
    <div><button id="go" aria-label="???"></button>${extra}</div></div></div>`;
  const composer = document.getElementById('ed')!;
  const sends: number[] = [];
  const adapter: ChatAdapter = {
    name: 'fake', findComposer: () => composer, findSendButton: () => null,
    getText: (c) => c.textContent ?? '', setText: (c, t) => { c.textContent = t; },
    triggerSend: () => { sends.push(1); },
  };
  return { composer, sends, adapter };
}

test('unrecognised button + PII in the box: checked first, then the SAME click is replayed', async () => {
  const f = unknownButtonPage();
  guard(f.adapter);
  f.composer.dispatchEvent(new Event('input', { bubbles: true })); // the user just typed / pasted
  const seen: string[] = [];
  document.getElementById('go')!.addEventListener('click', () => seen.push(f.composer.textContent ?? ''));
  document.getElementById('go')!.click();
  await settle();
  expect(seen.length).toBe(1);                       // the page got the click, once
  expect(seen[0]).not.toContain('jane@example.com'); // ...only after the text was scrubbed
  expect(f.sends.length).toBe(0);                    // adapter.triggerSend not used: the user's own click was replayed
});

test('unrecognised button + clean text: works as before', async () => {
  const f = unknownButtonPage('', 'the weather is nice');
  guard(f.adapter);
  f.composer.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 600));
  await settle(3);
  let clicks = 0;
  document.getElementById('go')!.addEventListener('click', () => clicks++);
  document.getElementById('go')!.click();
  await settle(3);
  expect(clicks).toBe(1);
  expect(f.composer.textContent).toBe('the weather is nice');
});

test('menu / toggle buttons are never treated as send', async () => {
  const f = unknownButtonPage('<button id="menu" aria-haspopup="menu"></button><button id="tgl" aria-pressed="false"></button>');
  guard(f.adapter);
  f.composer.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 600));
  let hits = 0;
  for (const id of ['menu', 'tgl']) {
    document.getElementById(id)!.addEventListener('click', () => hits++);
    document.getElementById(id)!.click();
  }
  await settle(3);
  expect(hits).toBe(2);
  expect(f.composer.textContent).toContain('jane@example.com'); // untouched: nothing was scrubbed
});

test('a button outside the composer container is left alone', async () => {
  const f = unknownButtonPage();
  document.body.insertAdjacentHTML('beforeend', '<footer><button id="far"></button></footer>');
  guard(f.adapter);
  f.composer.dispatchEvent(new Event('input', { bubbles: true }));
  let clicks = 0;
  document.getElementById('far')!.addEventListener('click', () => clicks++);
  document.getElementById('far')!.click();
  await settle(3);
  expect(clicks).toBe(1);
  expect(f.composer.textContent).toContain('jane@example.com');
});
