/** findFrame: the status tab must sit on the visible pill, not an inner wrapper. */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { test, expect, beforeAll, afterAll } from 'bun:test';

let findFrame: typeof import('../../lib/ui/frame').findFrame;
beforeAll(async () => {
  GlobalRegistrator.register();
  ({ findFrame } = await import('../../lib/ui/frame'));
});
afterAll(() => GlobalRegistrator.unregister());

const PILL = 'border-radius:28px;background:rgb(240,244,249)';

test('Gemini-like: skips a rounded inner wrapper without buttons, returns the pill', () => {
  document.body.innerHTML = `
<div id="page" style="background:#fff">
  <div id="pill" style="${PILL}">
    <button aria-label="Add">+</button>
    <div id="inner" style="border-radius:16px;background:rgb(240,244,249)">
      <rich-textarea><div id="ed" class="ql-editor" contenteditable="true"></div></rich-textarea>
    </div>
    <button aria-label="Send">→</button>
  </div>
</div>`;
  const ed = document.getElementById('ed')!;
  expect(findFrame(ed).id).toBe('pill');
});

test('a button inside the composer does not qualify the wrapper', () => {
  document.body.innerHTML = `
<div id="pill" style="${PILL}">
  <button>mic</button>
  <div id="inner" style="border-radius:12px;border:1px solid #ccc">
    <div id="ed" contenteditable="true"><button>inline chip</button></div>
  </div>
</div>`;
  expect(findFrame(document.getElementById('ed')!).id).toBe('pill');
});

test('ChatGPT-like: composer in a form with a rounded, shadowed pill', () => {
  document.body.innerHTML = `
<form id="form">
  <div id="pill" style="border-radius:28px;box-shadow:0 0 0 1px #0001">
    <div class="grid"><div id="ed" class="ProseMirror" contenteditable="true"></div></div>
    <div><button data-testid="composer-plus-btn">+</button><button id="send">send</button></div>
  </div>
</form>`;
  expect(findFrame(document.getElementById('ed')!).id).toBe('pill');
});

test('undecorated wrappers: falls back to the common ancestor with the send button', () => {
  document.body.innerHTML = `
<div id="outer"><div id="row"><textarea id="ta"></textarea><button id="send">Send</button></div></div>`;
  const ta = document.getElementById('ta') as HTMLElement;
  expect(findFrame(ta, document.getElementById('send')).id).toBe('row');
});

test('plain textarea with nothing around it: form, else the textarea itself', () => {
  document.body.innerHTML = `<form id="f"><div><textarea id="ta"></textarea></div></form>`;
  expect(findFrame(document.getElementById('ta') as HTMLElement).id).toBe('f');
  document.body.innerHTML = `<div><textarea id="ta"></textarea></div>`;
  expect(findFrame(document.getElementById('ta') as HTMLElement).id).toBe('ta');
});
