/** Gemini's send button must be found whatever the UI language (aria-label is localised). */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { test, expect, beforeAll, afterAll } from 'bun:test';

let geminiAdapter: typeof import('../../lib/adapters/gemini').geminiAdapter;
beforeAll(async () => {
  GlobalRegistrator.register();
  ({ geminiAdapter } = await import('../../lib/adapters/gemini'));
});
afterAll(() => GlobalRegistrator.unregister());

test('finds the send button by its icon in a French UI', () => {
  document.body.innerHTML = `<div><rich-textarea><div class="ql-editor" contenteditable="true"></div></rich-textarea></div>
<div class="far"><button aria-label="Dicter"><mat-icon data-mat-icon-name="mic"></mat-icon></button>
<button aria-label="Envoyer un message"><gem-icon><mat-icon data-mat-icon-name="arrow_upward"></mat-icon></gem-icon></button></div>`;
  expect(geminiAdapter.findSendButton()!.getAttribute('aria-label')).toBe('Envoyer un message');
});
