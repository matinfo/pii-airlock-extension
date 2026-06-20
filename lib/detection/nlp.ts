/**
 * Layer 2 — NLP-based detection via compromise.js.
 *
 * Detects unstructured PII: person names, locations, organisations.
 * compromise is ~170KB gzip, pure JS, synchronous (~10–20ms per message).
 * English-centric for MVP; other languages fall through to regex only.
 */

import type { Detection } from './types';
import nlp from 'compromise';

/**
 * Run NLP detection on `text`. Returns person/location/org detections.
 * Returns [] if language is not English.
 */
export async function detectNlp(text: string, lang: string): Promise<Detection[]> {
  // compromise is English-only; skip for other languages to avoid noise
  if (lang !== 'en') return [];
  if (!text.trim()) return [];

  try {
    const doc = nlp(text);
    const results: Detection[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function addMatches(view: any, entityType: string, score: number) {
      view.forEach((match: { text: () => string }) => {
        const term = match.text();
        if (!term || term.length < 2) return;
        // Find first occurrence in text
        const idx = text.indexOf(term);
        if (idx === -1) return;
        results.push({
          entityType,
          start: idx,
          end: idx + term.length,
          score,
          value: term,
          source: 'nlp',
        });
      });
    }

    addMatches(doc.people(), 'PERSON', 0.75);
    addMatches(doc.places(), 'LOCATION', 0.65);
    addMatches(doc.organizations(), 'ORG', 0.65);

    return results;
  } catch {
    // NLP failure is non-fatal — regex layer still runs
    return [];
  }
}

