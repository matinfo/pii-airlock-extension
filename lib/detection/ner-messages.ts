/** Message protocol for cross-context NER (content ↔ background ↔ offscreen). */

import type { Detection } from './types';

/** content → background. */
export const NER_DETECT = 'pii-airlock:ner:detect' as const;
/** background → offscreen. Distinct type so the broadcast doesn't loop. */
export const NER_DETECT_OFFSCREEN = 'pii-airlock:ner:detect:offscreen' as const;

/** Sent content→background (NER_DETECT) and background→offscreen (…:offscreen). */
export interface NerDetectRequest {
  type: typeof NER_DETECT | typeof NER_DETECT_OFFSCREEN;
  text: string;
  lang: string;
}

/** Reply from background/offscreen. Always resolves (fail-open → []). */
export interface NerDetectResponse {
  detections: Detection[];
  /** Why the names model produced nothing, if it failed. */
  error?: string;
}

function hasType(msg: unknown, type: string): msg is NerDetectRequest {
  return typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === type;
}

/** content→background message. */
export const isNerDetectRequest = (m: unknown): m is NerDetectRequest => hasType(m, NER_DETECT);
/** background→offscreen message. */
export const isNerOffscreenRequest = (m: unknown): m is NerDetectRequest =>
  hasType(m, NER_DETECT_OFFSCREEN);
