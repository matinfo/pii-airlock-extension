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
    browser.storage.sync
      .get({ mode: 'strict', overrides: {} })
      .then((s) => applySettings(s as Parameters<typeof applySettings>[0]));

    const adapter = resolveAdapter();
    let interceptor: SendInterceptor | null = null;

    // Increment persistent scrub counter so the popup can show lifetime stats.
    function onScrub(count: number) {
      browser.storage.sync.get({ scrubCount: 0 }).then((s) => {
        browser.storage.sync.set({ scrubCount: (s.scrubCount as number) + count });
      });
    }

    function attach() {
      const composer = adapter.findComposer();
      if (!composer) return;

      // Already attached to this exact element — skip
      if ((composer as HTMLElement & { _piiAttached?: boolean })._piiAttached) return;
      (composer as HTMLElement & { _piiAttached?: boolean })._piiAttached = true;

      interceptor?.destroy();
      interceptor = new SendInterceptor(composer, adapter, { onScrub });
    }

    attach();

    // Re-attach when the SPA remounts the composer (React, Vue, Svelte SPAs).
    // Debounced: SPAs fire hundreds of mutations per keystroke; we only need to
    // act after a quiescent moment, not on every individual DOM change.
    let debounceTimer = 0;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(attach, 400);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Propagate settings changes from popup / options page in real-time
    browser.storage.onChanged.addListener((changes) => {
      const update: Record<string, unknown> = {};
      if (changes.mode)     update.mode     = changes.mode.newValue;
      if (changes.overrides) update.overrides = changes.overrides.newValue;
      if (Object.keys(update).length) {
        applySettings(update as Parameters<typeof applySettings>[0]);
      }
    });

    // PANIC_CLEAR: popup button wipes all in-memory mappings immediately
    browser.runtime.onMessage.addListener((msg) => {
      if ((msg as { type?: string }).type === 'PANIC_CLEAR') {
        interceptor?.destroy();
        interceptor = null;
        // Force re-attach fresh (clears BrowserMapping inside old interceptor)
        const composer = adapter.findComposer();
        if (composer) {
          (composer as HTMLElement & { _piiAttached?: boolean })._piiAttached = false;
        }
        attach();
      }
    });
  },
});
