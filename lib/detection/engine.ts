/**
 * Detection engine — combines Layer 1 (regex) + Layer 2 (NLP),
 * deduplicates overlapping spans, and returns a unified result.
 *
 * Key invariant: if this throws, the caller (intercept.ts) must
 * treat the result as "block" in strict mode — never silent pass-through.
 */

import type { Detection, DetectionResult } from './types';
import { detectRegex } from './regex';
import { detectNlp } from './nlp';
import { detectNerRemote } from './ner-client';
import { detectLanguage } from './lang';
import { getDecision, tierOf } from '../policy';
import { denyHits, dropAllowed } from '../lists';

// ---------------------------------------------------------------------------
// Overlap deduplication
// ---------------------------------------------------------------------------

/**
 * Remove overlapping detections, keeping the higher-score span.
 * When scores are equal, prefer the longer span.
 * Same algorithm as pii_scrub/engine.py::_dedupe_overlaps.
 */
function dedupeOverlaps(detections: Detection[]): Detection[] {
  const sorted = [...detections].sort(
    (a, b) => b.score - a.score || b.value.length - a.value.length,
  );
  const chosen: Detection[] = [];
  for (const d of sorted) {
    const overlaps = chosen.some(
      (c) => !(d.end <= c.start || d.start >= c.end),
    );
    if (!overlaps) chosen.push(d);
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the full detection pipeline on `text`.
 * Always returns a result — never throws to the caller.
 * On unexpected error returns a safe "block" result.
 */
export async function analyze(
  text: string,
  options: { skipNlp?: boolean; skipNer?: boolean } = {},
): Promise<DetectionResult> {
  try {
    const lang = detectLanguage(text);

    // Layer 1: regex (sync) — locale-aware phone patterns require lang
    const regexHits = detectRegex(text, lang);

    // Layers 2 + 3 run concurrently; both fail-open to [].
    // Layer 2: compromise (instant, lexicon-based fallback).
    // Layer 3: transformer NER (heavy, multilingual, catches novel surnames +
    // non-English given names). Higher NER scores win the overlap dedupe.
    const [nlpHits, ner] = await Promise.all([
      options.skipNlp ? Promise.resolve([]) : detectNlp(text, lang),
      options.skipNer
        ? Promise.resolve({ detections: [] as Detection[], timedOut: false })
        : detectNerRemote(text, lang),
    ]);

    const all = dropAllowed(
      dedupeOverlaps([...denyHits(text), ...regexHits, ...nlpHits, ...ner.detections]),
    );
    const topTier = all.length > 0
      ? (all.map((d) => tierOf(d.entityType)).sort((a, b) =>
          tierRank(a) - tierRank(b),
        )[0] ?? null)
      : null;

    const decision = getDecision(all);

    return { detections: all, topTier, decision, ...(ner.timedOut ? { nerTimedOut: true } : {}) };
  } catch (err) {
    console.error('[pii-airlock] detection engine error:', err);
    // Fail-closed: treat as block so PII is never silently passed through
    return {
      detections: [],
      topTier: 'high',
      decision: 'block',
      error: true,
    };
  }
}

function tierRank(tier: 'high' | 'medium' | 'low' | null): number {
  if (tier === 'high') return 0;
  if (tier === 'medium') return 1;
  if (tier === 'low') return 2;
  return 3;
}
