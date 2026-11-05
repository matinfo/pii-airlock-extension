/** Selector check against the structure of chat.mistral.ai's composer (trimmed snapshot). */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { test, expect, beforeAll, afterAll } from 'bun:test';

let mistralAdapter: typeof import('../../lib/adapters/mistral').mistralAdapter;
beforeAll(async () => {
  GlobalRegistrator.register();
  ({ mistralAdapter } = await import('../../lib/adapters/mistral'));
});
afterAll(() => GlobalRegistrator.unregister());

const HTML = `<form class="w-full"><div data-chat-input-bar="true"><div data-composer-editor="true">
<div class="caret-brand-500"><div class="ProseMirror" contenteditable="true" data-placeholder="Ask anything"><p><br></p></div></div></div>
<button type="submit" hidden=""></button>
<button aria-label="Voice Mode" type="button"></button></div></form>`;

test('finds the ProseMirror composer, not the hidden submit button', () => {
  document.body.innerHTML = HTML;
  const c = mistralAdapter.findComposer()!;
  expect(c.classList.contains('ProseMirror')).toBe(true);
  expect(mistralAdapter.findSendButton(c)).toBeNull();
});
