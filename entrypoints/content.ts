import { resolveAdapter } from '../lib/adapters';
import { SendGuard } from '../lib/intercept';
import { applySettings } from '../lib/policy';
import { setNerTransport } from '../lib/detection/ner-client';
import { NER_DETECT, type NerDetectResponse } from '../lib/detection/ner-messages';
import { MSG } from '../lib/messages';

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
    // Route Layer 3 NER to the background (→ offscreen on Chrome, direct on
    // Firefox). Fail-open: any messaging error yields [] so L1+L2 still run.
    setNerTransport(async (text, lang) => {
      try {
        const res = (await browser.runtime.sendMessage({
          type: NER_DETECT,
          text,
          lang,
        })) as NerDetectResponse | undefined;
        return res?.detections ?? [];
      } catch {
        return [];
      }
    });

    // Load settings from storage then activate
    browser.storage.sync
      .get({ mode: 'strict', overrides: {} })
      .then((s) => applySettings(s as Parameters<typeof applySettings>[0]));

    const adapter = resolveAdapter();

    // Persistent scrub counter for the popup. storage.local (not sync: no point
    // syncing a counter) and updated in the background to avoid get+set races
    // between tabs.
    const guard = new SendGuard(adapter, {
      onScrub: (count) => {
        browser.runtime.sendMessage({ type: MSG.SCRUBBED, count }).catch(() => {});
      },
    });
    // Stateless: listeners live on `document`, so SPA remounts cannot open a gap.
    guard.install();

    // Health: does this page actually have a composer we can protect? A broken
    // selector otherwise fails silently while the popup claims "Active".
    let lastHealth: boolean | null = null;
    const checkHealth = () => {
      const ok = adapter.findComposer() !== null;
      if (ok === lastHealth) return;
      lastHealth = ok;
      browser.runtime.sendMessage({ type: MSG.HEALTH, ok }).catch(() => {});
    };
    // Grace period for the SPA to mount; then a cheap periodic check
    // (a querySelector every few seconds, no MutationObserver churn).
    setTimeout(checkHealth, 4000);
    setInterval(checkHealth, 5000);

    // Propagate settings changes from popup / options page in real-time
    browser.storage.onChanged.addListener((changes) => {
      const update: Record<string, unknown> = {};
      if (changes.mode)     update.mode     = changes.mode.newValue;
      if (changes.overrides) update.overrides = changes.overrides.newValue;
      if (Object.keys(update).length) {
        applySettings(update as Parameters<typeof applySettings>[0]);
      }
    });

    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      const type = (msg as { type?: string }).type;
      if (type === MSG.PANIC_CLEAR) {
        guard.clearMapping();
      } else if (type === MSG.STATUS) {
        sendResponse({ site: adapter.name, composerFound: adapter.findComposer() !== null });
      }
    });
  },
});
