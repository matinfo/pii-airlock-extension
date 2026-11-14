/** Infomaniak Euria (euria.infomaniak.com, iframed by kSuite): selector check against a trimmed live snapshot (2026-11). */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { test, expect, beforeAll, afterAll } from 'bun:test';

let euriaAdapter: typeof import('../../lib/adapters/euria').euriaAdapter;
beforeAll(async () => {
  GlobalRegistrator.register({ url: 'https://euria.infomaniak.com/' });
  ({ euriaAdapter } = await import('../../lib/adapters/euria'));
});
afterAll(() => GlobalRegistrator.unregister());

// Trimmed: closed shadow root (LanguageTool mirror), SVGs and utility classes removed.
const HTML = `<div class="m-auto self-end rounded-xl"><div class="relative grid w-full rounded-xl p-1" data-testid="main-prompt">
<section class="relative flex">
<textarea aria-disabled="false" aria-label="Demandez à Euria" placeholder="Demandez à Euria" class="h-10 w-full resize-none p-2"></textarea>
<div class="pointer-events-none absolute"><canvas role="img" aria-label="Visualisation de la forme d'onde audio"></canvas></div></section>
<section class="grid h-10"><section class="grid">
<button type="button" aria-haspopup="true" aria-expanded="false" aria-label="Ajouter des pièces jointes et options"></button></section>
<section class="grid">
<button type="button" aria-haspopup="true" aria-expanded="false"><span>Rapide</span></button>
<button type="button" aria-label="Voice message"></button>
<button type="submit" disabled="" aria-label="Envoyer" data-disabled="true"></button>
</section></section></div></div>`;

test('finds the Euria textarea', () => {
  document.body.innerHTML = HTML;
  expect(euriaAdapter.findComposer()?.getAttribute('aria-label')).toBe('Demandez à Euria');
});

test('finds the submit button, not attachments/model/voice', () => {
  document.body.innerHTML = HTML;
  const c = euriaAdapter.findComposer()!;
  expect(euriaAdapter.findSendButton(c)?.getAttribute('type')).toBe('submit');
});

test('setText writes the textarea value and fires input', () => {
  document.body.innerHTML = HTML;
  const c = euriaAdapter.findComposer()!;
  let inputs = 0;
  c.addEventListener('input', () => inputs++);
  euriaAdapter.setText(c, 'mail <EMAIL_ADDRESS_1>');
  expect(euriaAdapter.getText(c)).toBe('mail <EMAIL_ADDRESS_1>');
  expect(inputs).toBe(1);
});

test('registry resolves euria.infomaniak.com to euria', async () => {
  const { resolveAdapter } = await import('../../lib/adapters/index');
  expect(resolveAdapter().name).toBe('euria');
});
