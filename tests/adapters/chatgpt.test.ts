/** chatgpt.com composer lookup, including the logged-out textarea layout. */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { test, expect, beforeAll, afterAll } from 'bun:test';

let chatgptAdapter: typeof import('../../lib/adapters/chatgpt').chatgptAdapter;
beforeAll(async () => {
  GlobalRegistrator.register();
  ({ chatgptAdapter } = await import('../../lib/adapters/chatgpt'));
});
afterAll(() => GlobalRegistrator.unregister());

test('logged-in: finds the ProseMirror composer', () => {
  document.body.innerHTML = `<form><div id="prompt-textarea" class="ProseMirror" contenteditable="true"></div>
<button data-testid="send-button" aria-label="Send prompt"></button></form>`;
  expect(chatgptAdapter.findComposer()!.id).toBe('prompt-textarea');
  expect(chatgptAdapter.findSendButton()!.getAttribute('data-testid')).toBe('send-button');
});

test('logged-out: finds the plain textarea and reads its value', () => {
  document.body.innerHTML = `<form><textarea id="mobile-composer-prompt" name="prompt" rows="1"></textarea>
<button type="submit" aria-label="Send message"></button></form>
<qb-toolbar contenteditable="false"></qb-toolbar>`;
  const c = chatgptAdapter.findComposer() as HTMLTextAreaElement;
  expect(c.id).toBe('mobile-composer-prompt');
  c.value = 'hello jane@example.com';
  expect(chatgptAdapter.getText(c)).toBe('hello jane@example.com');
  expect(chatgptAdapter.findSendButton()!.getAttribute('aria-label')).toBe('Send message');
});
