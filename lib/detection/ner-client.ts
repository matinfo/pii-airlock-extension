/**
 * NER routing boundary.
 *
 * The engine runs in the content script, but the transformer model is too heavy
 * to host there (blocks the page, MV3 CSP — and statically importing it here
 * would bloat content.js by ~60MB). So this module NEVER imports ./ner; it
 * exposes a swappable transport that the host wires at startup:
 *
 *   - default          → no-op ([]). NER simply doesn't run.
 *   - content script   → installs a transport that messages the background,
 *                         which runs the model in an offscreen document (Chrome
 *                         MV3) or directly (Firefox). See content.ts startup.
 *
 * Hosts that DO run the model (background/offscreen, tests) call detectNer()
 * from ./ner directly — not through this seam. Always fail-open: a
 * missing/failed transport returns [] so the regex (L1) and compromise (L2)
 * layers still run. lib/ stays free of any browser API import, which keeps the
 * engine unit-testable under bun.
 */

import type { Detection } from './types';

export type NerTransport = (text: string, lang: string) => Promise<Detection[]>;

let transport: NerTransport = async () => [];

/** Override how NER detection is dispatched (content script wires messaging). */
export function setNerTransport(fn: NerTransport): void {
  transport = fn;
}

export async function detectNerRemote(text: string, lang: string): Promise<Detection[]> {
  try {
    return await transport(text, lang);
  } catch {
    return [];
  }
}
