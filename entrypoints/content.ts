import { resolveAdapter } from '../lib/adapters';
import { SendInterceptor } from '../lib/intercept';
import { applySettings } from '../lib/policy';

export default defineContentScript({
  matches: [
    '*://chatgpt.com/*',
    '*://chat.openai.com/*',
    '*://claude.ai/*',
    '*://gemini.google.com/*',
    '*://copilot.microsoft.com/*',
    '*://perplexity.ai/*',
    '*://poe.com/*',
    '*://character.ai/*',
    '*://mistral.ai/*',
    '*://huggingface.co/*',
    '*://you.com/*',
  ],
  main() {
    // Load settings from storage then activate
    browser.storage.sync.get({ mode: 'strict', overrides: {} }).then((s) => {
      applySettings(s as { mode: 'strict' | 'permissive'; overrides: Record<string, import('../lib/detection/types').Decision> });
    });

    const adapter = resolveAdapter();
    let interceptor: import('../lib/intercept').SendInterceptor | null = null;

    function attach() {
      const composer = adapter.findComposer();
      if (!composer) return;

      // Already attached to this element?
      if ((composer as HTMLElement & { _piiAttached?: boolean })._piiAttached) return;
      (composer as HTMLElement & { _piiAttached?: boolean })._piiAttached = true;

      interceptor?.destroy();
      interceptor = new SendInterceptor(composer, adapter);
    }

    // Initial attach
    attach();

    // Re-attach on SPA navigation / React re-mounts
    const observer = new MutationObserver(() => {
      attach();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Listen for settings changes from popup/options
    browser.storage.onChanged.addListener((changes) => {
      const update: Record<string, unknown> = {};
      if (changes.mode) update.mode = changes.mode.newValue;
      if (changes.overrides) update.overrides = changes.overrides.newValue;
      if (Object.keys(update).length) applySettings(update as Parameters<typeof applySettings>[0]);
    });
  },
});
