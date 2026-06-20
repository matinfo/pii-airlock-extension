/**
 * NLP layer tests.
 *
 * Tests the compromise.js wrapper. These run the actual NLP, so they may be
 * noisier than pure regex tests — false positives are possible. The critical
 * things to verify are correctness of the span logic and the all-occurrences fix.
 */

import { describe, it, expect } from 'bun:test';
import { detectNlp } from '../../lib/detection/nlp';

// ── Language guard ────────────────────────────────────────────────────────────

describe('detectNlp: language guard', () => {
  it('returns [] for non-English text', async () => {
    const r = await detectNlp('Bonjour, je suis Jean Dupont.', 'fr');
    expect(r).toHaveLength(0);
  });

  it('runs for English', async () => {
    // compromise reliably tags "Microsoft" as an ORG
    const r = await detectNlp('I work at Microsoft.', 'en');
    expect(r.some((d) => d.entityType === 'ORG')).toBe(true);
  });
});

// ── Span correctness ──────────────────────────────────────────────────────────

describe('detectNlp: span integrity', () => {
  it('start/end slice equals value for every detection', async () => {
    const text = 'John Smith works at Google in London.';
    const detections = await detectNlp(text, 'en');
    for (const d of detections) {
      expect(text.slice(d.start, d.end)).toBe(d.value);
    }
  });
});

// ── All-occurrences fix ───────────────────────────────────────────────────────

describe('detectNlp: all occurrences detected', () => {
  it('finds both occurrences of the same name', async () => {
    // "Microsoft" appears twice — both should be detected
    const text = 'Microsoft was founded by Bill Gates. Microsoft is headquartered in Redmond.';
    const detections = await detectNlp(text, 'en');
    const orgs = detections.filter((d) => d.entityType === 'ORG' && d.value === 'Microsoft');
    // Must find 2 spans, not just 1
    expect(orgs.length).toBeGreaterThanOrEqual(2);
    // Both spans must point to correct positions
    const positions = orgs.map((d) => d.start);
    expect(positions).toContain(text.indexOf('Microsoft'));
    expect(positions).toContain(text.lastIndexOf('Microsoft'));
  });

  it('each occurrence span slices correctly', async () => {
    const text = 'Alice met Alice at the conference.';
    const detections = await detectNlp(text, 'en');
    for (const d of detections) {
      expect(text.slice(d.start, d.end)).toBe(d.value);
    }
  });
});

// ── Source tag ────────────────────────────────────────────────────────────────

describe('detectNlp: source tag', () => {
  it('all detections have source=nlp', async () => {
    const text = 'Alice works at Google.';
    const detections = await detectNlp(text, 'en');
    for (const d of detections) {
      expect(d.source).toBe('nlp');
    }
  });
});
