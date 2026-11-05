/**
 * Offscreen document — hosts the transformer NER model on Chrome/Edge MV3.
 *
 * Content scripts can't run the WASM model (blocks the page, CSP). The
 * background creates this offscreen document and relays NER requests here. The
 * model + onnxruntime WASM are loaded from bundled extension URLs only — never
 * a remote CDN (invariant #3).
 */

import * as nerMod from '../../lib/detection/ner';
import { configureNerEnv, detectNer, resetNerState } from '../../lib/detection/ner';
import { MSG } from '../../lib/messages';
import {
  isNerOffscreenRequest,
  type NerDetectResponse,
} from '../../lib/detection/ner-messages';

let ready: Promise<void> | null = null;

function ensureConfigured(): Promise<void> {
  if (!ready) {
    ready = configureNerEnv({
      mjs: browser.runtime.getURL('wasm/ort-wasm-simd-threaded.mjs' as never),
      wasm: browser.runtime.getURL('wasm/ort-wasm-simd-threaded.wasm' as never),
    });
  }
  return ready;
}

browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if ((msg as { type?: string })?.type === MSG.NER_RESET) {
    resetNerState();
    return false;
  }
  if (!isNerOffscreenRequest(msg)) return false;
  void (async () => {
    let detections: NerDetectResponse['detections'] = [];
    try {
      await ensureConfigured();
      detections = await detectNer(msg.text, msg.lang);
    } catch {
      detections = []; // fail-open
    }
    sendResponse({ detections, ...(nerMod.lastNerError ? { error: nerMod.lastNerError } : {}) } satisfies NerDetectResponse);
  })();
  return true; // async sendResponse
});
