import { test, expect } from './fixtures';

for (const scheme of ['light', 'dark'] as const) {
  test(`popup + options render (${scheme})`, async ({ h }) => {
    let [sw] = h.context.serviceWorkers(); sw ??= await h.context.waitForEvent('serviceworker');
    const id = new URL(sw.url()).host;
    for (const name of ['popup', 'options']) {
      const p = await h.context.newPage();
      await p.emulateMedia({ colorScheme: scheme });
      await p.setViewportSize(name === 'popup' ? { width: 300, height: 420 } : { width: 900, height: 1100 });
      await p.goto(`chrome-extension://${id}/${name}.html`);
      await p.waitForTimeout(500);
      await p.screenshot({ path: `test-results/ui/${name}-${scheme}.png`, fullPage: name === 'options' });
      if (name === 'popup') await expect(p.getByRole('radio', { name: 'Auto' })).toBeChecked();
    }
  });
}
