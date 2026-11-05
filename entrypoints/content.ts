import { resolveAdapter } from '../lib/adapters';
import { SendGuard } from '../lib/intercept';
import { applySettings, currentSettings } from '../lib/policy';
import { setLists, type Lists } from '../lib/lists';
import { setNerTransport, warmNer } from '../lib/detection/ner-client';
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

    // Warm the names model when the user starts composing (not on page load),
    // so the first send does not hit a cold model. No-op if not installed.
    let lastWarm = 0;
    document.addEventListener('focusin', (e) => {
      const t = e.target as HTMLElement | null;
      if (!t || !(t.isContentEditable || t.tagName === 'TEXTAREA')) return;
      if (Date.now() - lastWarm < 60_000) return;
      lastWarm = Date.now();
      warmNer();
    }, true);

    // Settings: mode + overrides + per-site switch in sync; pause + lists in
    // local (lists hold the user's own sensitive values: never sync them).
    const host = location.hostname;
    const loadSettings = async () => {
      const sync = await browser.storage.sync.get({ mode: 'auto', overrides: {}, sitesOff: [] });
      const local = await browser.storage.local.get({ pausedUntil: 0, lists: undefined });
      applySettings({
        mode: sync.mode as string,
        overrides: sync.overrides as Record<string, never>,
        siteOff: (sync.sitesOff as string[]).includes(host),
        pausedUntil: local.pausedUntil as number,
      });
      setLists(local.lists as Partial<Lists> | undefined);
    };
    void loadSettings();

    const adapter = resolveAdapter();

    // Persistent scrub counter for the popup. storage.local (not sync: no point
    // syncing a counter) and updated in the background to avoid get+set races
    // between tabs.
    const guard = new SendGuard(adapter, {
      onScrub: (count) => {
        browser.runtime.sendMessage({ type: MSG.SCRUBBED, count }).catch(() => {});
      },
      onListChange: (lists) => {
        void browser.storage.local.set({ lists });
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

    // Propagate changes from the popup / options page in real time.
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && (changes.mode || changes.overrides || changes.sitesOff)) void loadSettings();
      if (area === 'local' && (changes.pausedUntil || changes.lists)) void loadSettings();
    });

    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      const type = (msg as { type?: string }).type;
      if (type === MSG.PANIC_CLEAR) {
        guard.clearMapping();
        setLists(undefined);
      } else if (type === MSG.STATUS) {
        const cur = currentSettings();
        sendResponse({
          site: adapter.name,
          host,
          composerFound: adapter.findComposer() !== null,
          mode: cur.mode,
          siteOff: cur.siteOff,
          pausedUntil: cur.pausedUntil,
        });
      }
    });
  },
});
