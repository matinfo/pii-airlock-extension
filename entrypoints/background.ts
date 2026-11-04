import {
  NER_DETECT_OFFSCREEN,
  isNerDetectRequest,
  type NerDetectResponse,
} from '../lib/detection/ner-messages';
import type { Detection } from '../lib/detection/types';

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
let bgReady: Promise<void> | null = null;

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
 * Firefox MV2: the persistent background page hosts the model directly.
 * Dynamic import so transformers is NEVER bundled into the Chrome background
 * (where it only forwards to the offscreen doc) — keeps that bundle small and
 * avoids the import.meta-in-iife warning.
 */
async function detectInBackground(text: string, lang: string): Promise<Detection[]> {
  // Build-time guard: MANIFEST_VERSION is inlined per target, so on Chrome MV3
  // this branch is dead-code-eliminated and transformers is dropped entirely
  // from background.js (only the Firefox MV2 build bundles the model here).
  if (import.meta.env.MANIFEST_VERSION !== 2) return [];
  const ner = await import('../lib/detection/ner');
  if (!bgReady) bgReady = ner.configureNerEnv(url('models/'), url('wasm/'));
  await bgReady;
  return ner.detectNer(text, lang);
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    browser.storage.sync.set({ mode: 'strict', overrides: {}, scrubCount: 0 });
  });

  browser.tabs.onRemoved.addListener((_tabId) => {
    // No persistent per-tab state — mappings are in-memory in the content script.
  });

  // Layer 3 NER dispatch from content scripts. Always fail-open to [].
  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!isNerDetectRequest(msg)) return false;
    void (async () => {
      let detections: Detection[] = [];
      try {
        detections = hasOffscreen
          ? await detectViaOffscreen(msg.text, msg.lang)
          : await detectInBackground(msg.text, msg.lang);
      } catch {
        detections = [];
      }
      sendResponse({ detections } satisfies NerDetectResponse);
    })();
    return true; // async sendResponse
  });
});
