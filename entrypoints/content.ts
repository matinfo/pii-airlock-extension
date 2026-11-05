import { resolveAdapter } from '../lib/adapters';
import { SendGuard } from '../lib/intercept';
import { applySettings, currentSettings, isActive } from '../lib/policy';
import { setLists, type Lists } from '../lib/lists';
import { setNerTransport, warmNer } from '../lib/detection/ner-client';
import { NER_DETECT, type NerDetectResponse } from '../lib/detection/ner-messages';
import { MSG } from '../lib/messages';
import { BrowserMapping } from '../lib/mapping';
import { startRestore } from '../lib/restore';

export default defineContentScript({
  matches: [
    'https://chatgpt.com/*',
    'https://chat.openai.com/*',
    'https://claude.ai/*',
    'https://gemini.google.com/*',
    'https://copilot.microsoft.com/*',
    'https://copilot.cloud.microsoft/*',
    'https://*.perplexity.ai/*',
    'https://*.mistral.ai/*',
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
      const sync = await browser.storage.sync.get({ mode: 'auto', overrides: {}, sitesOff: [], confirmAfterSend: true });
      const local = await browser.storage.local.get({ pausedUntil: 0, lists: undefined });
      applySettings({
        mode: sync.mode as string,
        overrides: sync.overrides as Record<string, never>,
        siteOff: (sync.sitesOff as string[]).includes(host),
        confirmAfterSend: sync.confirmAfterSend !== false,
        pausedUntil: local.pausedUntil as number,
      });
      setLists(local.lists as Partial<Lists> | undefined);
    };
    const loadingSettings = loadSettings();

    const adapter = resolveAdapter();

    // Persistent scrub counter for the popup. storage.local (not sync: no point
    // syncing a counter) and updated in the background to avoid get+set races
    // between tabs.
    // Token store shared by the send guard (mints) and the restorer (reads).
    // Persisted per tab through the background so reloads keep numbering.
    const mapping = new BrowserMapping();
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    mapping.onChange = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        browser.runtime.sendMessage({ type: MSG.MAP_SAVE, entries: mapping.entries() }).catch(() => {});
      }, 300);
    };
    const restoring = browser.runtime
      .sendMessage({ type: MSG.MAP_LOAD })
      .then((res: { entries?: Array<[string, string, string]> } | undefined) => {
        const saved = mapping.onChange;
        mapping.onChange = undefined; // loading is not a change worth saving
        mapping.load(res?.entries ?? []);
        mapping.onChange = saved;
      })
      .catch(() => {});
    void restoring.then(() => {
      if (document.body) startRestore(mapping);
      else document.addEventListener('DOMContentLoaded', () => startRestore(mapping), { once: true });
    });

    const guard = new SendGuard(adapter, {
      mapping,
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
    // State drives the toolbar icon: on = protecting, warn = enabled but no
    // composer found (NOT protecting), off = switched off / paused.
    let lastState: string | null = null;
    let settled = false; // false during the SPA mount grace period
    const reportState = () => {
      const found = adapter.findComposer() !== null;
      if (!found && !settled && isActive()) return; // may still be mounting
      const state = !isActive() ? 'off' : found ? 'on' : 'warn';
      if (state === lastState) return;
      lastState = state;
      browser.runtime.sendMessage({ type: MSG.HEALTH, state }).catch(() => {});
    };
    // Grace period for the SPA to mount; then a cheap periodic check
    // (a querySelector every few seconds, no MutationObserver churn). The
    // periodic tick also catches a timed pause expiring.
    setTimeout(() => void loadingSettings.then(reportState), 1500);
    setTimeout(() => { settled = true; reportState(); }, 4000);
    setInterval(reportState, 5000);

    // Propagate changes from the popup / options page in real time.
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && (changes.mode || changes.overrides || changes.sitesOff || changes.confirmAfterSend)) void loadSettings().then(reportState);
      if (area === 'local' && (changes.pausedUntil || changes.lists)) void loadSettings().then(reportState);
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
