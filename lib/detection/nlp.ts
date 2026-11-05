/**
 * Layer 2 — NLP-based detection via compromise.js.
 *
 * Detects unstructured PII: person names, locations, organisations.
 * compromise is ~170KB gzip, pure JS, synchronous (~10–20ms per message).
 * compromise's tagger is English-centric, but proper-noun detection keys off
 * capitalisation + name lists, so it reliably catches Latin-script names in
 * other Latin-script languages (fr/de/es/…). We only skip languages whose
 * script compromise cannot tokenise meaningfully (Cyrillic/CJK).
 */

import type { Detection } from './types';
import nlp from 'compromise';
import { NAME_PAIR_RE, TITLE_NAME_RE, isFirstName } from './names';

/**
 * Languages whose script compromise cannot tokenise — NLP produces only noise,
 * so we skip Layer 2 and rely on regex (Layer 1) for these.
 */
const NON_LATIN_LANGS = new Set(['ru', 'ja', 'zh']);

/**
 * True if `term`'s first letter is uppercase. Person/location/org names are
 * proper nouns and always capitalised; this rejects compromise mis-tags of
 * lowercase common words (e.g. the French verb "va" tagged as a place).
 */
function startsUppercase(term: string): boolean {
  const first = term.trimStart()[0] ?? '';
  return first !== first.toLowerCase() && first === first.toUpperCase();
}

/**
 * Run NLP detection on `text`. Returns person/location/org detections.
 * Returns [] for non-Latin-script languages (compromise can't tokenise them).
 */
export async function detectNlp(text: string, lang: string): Promise<Detection[]> {
  if (NON_LATIN_LANGS.has(lang)) return [];
  if (!text.trim()) return [];

  try {
    const doc = nlp(text);
    const results: Detection[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function addMatches(view: any, entityType: string, score: number, requireUppercase: boolean) {
      view.forEach((match: { text: () => string }) => {
        // Strip leading/trailing punctuation: compromise may include adjacent
        // characters with no separating space, e.g. "Mathieu)" → "Mathieu".
        const term = match.text().replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
        if (term.length < 2) return;
        // LOCATION/ORG: require a capitalised initial to reject lowercase
        // common-word mis-tags (e.g. the French verb "va" tagged as a place).
        // PERSON is left ungated — compromise's people tagger is conservative,
        // and lowercase first names ("marie") are still real PII we must catch.
        if (requireUppercase && !startsUppercase(term)) return;
        // Find ALL occurrences, on word boundaries: indexOf would also hit the
        // term inside other words ("Al" in "Alpha") and corrupt them on scrub.
        const re = new RegExp(
          `(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`,
          'gu',
        );
        for (const m of text.matchAll(re)) {
          const idx = m.index!;
          // compromise tags some "First Last" names as ORG. A known first name
          // in front means it is a person.
          const asType =
            entityType === 'ORG' && isFirstName(term.split(/[\s-]/)[0]!) && /\s/.test(term)
              ? 'PERSON'
              : entityType;
          results.push({
            entityType: asType,
            start: idx,
            end: idx + term.length,
            score: asType === 'PERSON' ? 0.75 : score,
            value: term,
            source: 'nlp',
          });
        }
      });
    }

    addMatches(doc.people(), 'PERSON', 0.75, false);
    addMatches(doc.places(), 'LOCATION', 0.65, true);
    addMatches(doc.organizations(), 'ORG', 0.65, true);

    // "Jean Dupont": compromise's people tagger misses names outside its
    // lexicon. A listed first name followed by capitalised word(s) is a person.
    for (const m of text.matchAll(NAME_PAIR_RE)) {
      if (isFirstName(m[1]!)) {
        results.push({
          entityType: 'PERSON',
          start: m.index!,
          end: m.index! + m[0].length,
          score: 0.7,
          value: m[0],
          source: 'nlp',
        });
      }
    }

    for (const m of text.matchAll(TITLE_NAME_RE)) {
      const start = m.index! + m[0].lastIndexOf(m[1]!);
      results.push({
        entityType: 'PERSON',
        start,
        end: start + m[1]!.length,
        score: 0.8,
        value: m[1]!,
        source: 'nlp',
      });
    }

    return results;
  } catch {
    // NLP failure is non-fatal — regex layer still runs
    return [];
  }
}

