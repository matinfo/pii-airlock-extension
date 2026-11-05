import {
  NER_DETECT_OFFSCREEN,
  isNerDetectRequest,
  type NerDetectResponse,
} from '../lib/detection/ner-messages';
import type { Detection } from '../lib/detection/types';
import { MSG } from '../lib/messages';

/**
 * Minimal typing for the MV3 offscreen APIs (not in webextension-polyfill).
 * Present on Chrome/Edge; absent on Firefox MV2.
 */
interface OffscreenApi {
  offscreen?: {
    createDocument(opts: { url: string; reasons: string[]; justification: string }): Promise<void>;
  };
  runtime: {
    getContexts(filter: { contextTypes: string[]; documentUrls: string[] }): Promise<unknown[]>;
  };
}
const chromeApi = (globalThis as { chrome?: OffscreenApi }).chrome;
const hasOffscreen = !!chromeApi?.offscreen;

// runtime.getURL is typed against generated public paths; our model/wasm dirs
// are copied from public/ at build time, so cast through the loose path type.
const url = (p: string) => browser.runtime.getURL(p as never);

let offscreenReady: Promise<void> | null = null;

/** Create the offscreen document once (idempotent across service-worker restarts). */
async function ensureOffscreen(): Promise<void> {
  if (!offscreenReady) {
    offscreenReady = (async () => {
      const docUrl = url('offscreen.html');
      const existing = await chromeApi!.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [docUrl],
      });
      if (existing.length === 0) {
        await chromeApi!.offscreen!.createDocument({
          url: docUrl,
          reasons: ['WORKERS'],
          justification: 'Run the local PII NER model off the page thread.',
        });
      }
    })().catch((e) => {
      offscreenReady = null; // allow retry on next request
      throw e;
    });
  }
  return offscreenReady;
}

async function detectViaOffscreen(text: string, lang: string): Promise<Detection[]> {
  await ensureOffscreen();
  const res = (await browser.runtime.sendMessage({
    type: NER_DETECT_OFFSCREEN,
    text,
    lang,
  })) as NerDetectResponse | undefined;
  return res?.detections ?? [];
}

/**
 * Firefox MV2 has no offscreen API, but its persistent background page can host
 * the same extension page in a hidden iframe. One code path (offscreen.html)
 * for both browsers keeps transformers OUT of the background bundle.
 */
function ensureFrame(): Promise<void> {
  if (!frameReady) {
    frameReady = new Promise<void>((resolve, reject) => {
      const f = document.createElement('iframe');
      f.style.display = 'none';
      f.src = url('offscreen.html');
      f.onload = () => resolve();
      f.onerror = () => { frameReady = null; reject(new Error('ner frame failed')); };
      document.body.appendChild(f);
    });
  }
  return frameReady;
}
let frameReady: Promise<void> | null = null;

async function detect(text: string, lang: string): Promise<Detection[]> {
  if (hasOffscreen) return detectViaOffscreen(text, lang);
  await ensureFrame();
  const res = (await browser.runtime.sendMessage({
    type: NER_DETECT_OFFSCREEN,
    text,
    lang,
  })) as NerDetectResponse | undefined;
  return res?.detections ?? [];
}

export default defineBackground(() => {
  // Defaults on FRESH INSTALL only, and never over existing values. 'update'
  // (extension or browser) must not reset the user's settings.
  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason !== 'install') return;
    const existing = await browser.storage.sync.get(['mode', 'overrides']);
    await browser.storage.sync.set({
      mode: existing.mode ?? 'strict',
      overrides: existing.overrides ?? {},
    });
  });

  // Counter lives in storage.local and is updated here, in one place, so
  // concurrent tabs can't lose increments (the old get+set ran in each tab).
  let counterQueue: Promise<void> = Promise.resolve();
  const addToCounter = (n: number) => {
    counterQueue = counterQueue.then(async () => {
      const { scrubCount = 0 } = await browser.storage.local.get('scrubCount');
      await browser.storage.local.set({ scrubCount: (scrubCount as number) + n });
    }).catch(() => {});
  };

  browser.runtime.onMessage.addListener((msg, sender) => {
    const m = msg as { type?: string; count?: number; ok?: boolean };
    if (m?.type === MSG.SCRUBBED && typeof m.count === 'number') {
      addToCounter(m.count);
    } else if (m?.type === MSG.HEALTH && sender.tab?.id !== undefined) {
      const tabId = sender.tab.id;
      void browser.action.setBadgeText({ tabId, text: m.ok ? '' : '!' });
      if (!m.ok) {
        void browser.action.setBadgeBackgroundColor({ tabId, color: '#d97706' });
        void browser.action.setTitle({
          tabId,
          title: 'PII Airlock: no chat box found on this page. NOT protected here.',
        });
      } else {
        void browser.action.setTitle({ tabId, title: 'PII Airlock' });
      }
    }
    return false;
  });

  // Layer 3 NER dispatch from content scripts. Always fail-open to [].
  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!isNerDetectRequest(msg)) return false;
    void (async () => {
      let detections: Detection[] = [];
      try {
        detections = await detect(msg.text, msg.lang);
      } catch (e) {
        console.warn('[pii-airlock] names model request failed:', e);
        detections = [];
      }
      sendResponse({ detections } satisfies NerDetectResponse);
    })();
    return true; // async sendResponse
  });
});
