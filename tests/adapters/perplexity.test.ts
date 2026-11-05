/** Selector check against the structure of perplexity.ai's composer (trimmed snapshot). */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { test, expect, beforeAll, afterAll } from 'bun:test';

let perplexityAdapter: typeof import('../../lib/adapters/perplexity').perplexityAdapter;
beforeAll(async () => {
  GlobalRegistrator.register();
  ({ perplexityAdapter } = await import('../../lib/adapters/perplexity'));
});
afterAll(() => GlobalRegistrator.unregister());

test('finds the Lexical contenteditable composer', () => {
  document.body.innerHTML = `<div class="composer-row"><div class="relative">
<div aria-label="Ask anything…" contenteditable="true" role="textbox" data-lexical-editor="true"><p dir="auto"><br></p></div></div>
<button aria-label="Use voice mode" type="button"></button></div>`;
  const c = perplexityAdapter.findComposer()!;
  expect(c.getAttribute('data-lexical-editor')).toBe('true');
});
