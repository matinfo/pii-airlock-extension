/** Selector check against the structure of poe.com's composer (trimmed live snapshot, 2026-11). */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { test, expect, beforeAll, afterAll } from 'bun:test';

let poeAdapter: typeof import('../../lib/adapters/poe').poeAdapter;
beforeAll(async () => {
  GlobalRegistrator.register({ url: 'https://poe.com/' });
  ({ poeAdapter } = await import('../../lib/adapters/poe'));
});
afterAll(() => GlobalRegistrator.unregister());

// Trimmed: closed shadow roots (LanguageTool mirror) and SVGs removed.
const HTML = `<div class="ChatHomeMain_inputContainer__9mgRh"><div>
<div class="ChatMessageInputContainer_inputContainer__s2AGa" data-input-is-empty="true" tabindex="-1">
<div class="GrowingTextArea_growWrap__im5W3 ChatMessageInputContainer_textArea__fNi6E">
<textarea class="GrowingTextArea_textArea__ZWQbP" rows="1" placeholder="Start a new chat"></textarea>
<div class="GrowingTextArea_hidden__xLW0K"></div></div>
<div class="ChatMessageInputContainer_actionContainerLeft__dIwkm" data-action-row="left">
<div><button type="button" aria-label="Select attachment" data-button-file-input="true"></button></div>
<input class="ChatMessageFileInputButton_input__svNx4" type="file" multiple="">
<div><button type="button" aria-label="Mention bot" data-button-at-mention="true"></button></div>
<button type="button" aria-label="Additional input" data-button-custom-ui="true"></button></div>
<div class="ChatMessageInputContainer_actionContainerRight__fyfsX" data-action-row="right">
<div><button type="button" aria-selected="false" data-button-voice-input="true"></button></div>
<button type="button" aria-label="Send message" data-button-send="true" disabled=""></button></div>
</div></div></div>`;

test('finds the growing textarea composer, not the hidden mirror div', () => {
  document.body.innerHTML = HTML;
  const c = poeAdapter.findComposer()!;
  expect(c).toBeInstanceOf(HTMLTextAreaElement);
  expect(c.getAttribute('placeholder')).toBe('Start a new chat');
});

test('finds the Send button (data-button-send), not attachment/mention/voice', () => {
  document.body.innerHTML = HTML;
  const c = poeAdapter.findComposer()!;
  expect(poeAdapter.findSendButton(c)?.getAttribute('data-button-send')).toBe('true');
});

test('getText/setText round-trip through the textarea value and fire input', () => {
  document.body.innerHTML = HTML;
  const c = poeAdapter.findComposer()!;
  let inputs = 0;
  c.addEventListener('input', () => inputs++);
  poeAdapter.setText(c, 'mail <EMAIL_ADDRESS_1>');
  expect(poeAdapter.getText(c)).toBe('mail <EMAIL_ADDRESS_1>');
  expect(inputs).toBe(1);
});

test('registry resolves poe.com to the poe adapter', async () => {
  const { resolveAdapter } = await import('../../lib/adapters/index');
  expect(resolveAdapter().name).toBe('poe');
});
