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

/** How long a send may wait for the names model before regex+compromise decide alone. */
export const NER_BUDGET_MS = 400;

export interface NerOutcome {
  detections: Detection[];
  /** The model did not answer within the budget (loading or slow). */
  timedOut: boolean;
}

/**
 * Ask the names model, but never block a send on it: after `budgetMs` the
 * caller proceeds with L1+L2 only. The request keeps running, so a model that
 * was still loading is warm for the next message. Never throws.
 */
export async function detectNerRemote(
  text: string,
  lang: string,
  budgetMs: number = NER_BUDGET_MS,
): Promise<NerOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<NerOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ detections: [], timedOut: true }), budgetMs);
  });
  const run = transport(text, lang).then(
    (detections): NerOutcome => ({ detections, timedOut: false }),
    (): NerOutcome => ({ detections: [], timedOut: false }),
  );
  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Fire-and-forget: ask the host to load the model now (composer focus). */
export function warmNer(): void {
  void transport('Warm up.', 'en').catch(() => {});
}
