/**
 * Layer 3 NER tests. The model is replaced by an injected runner that replays
 * CAPTURED real model output (tests/fixtures/ner-real.ts), so the adapter is
 * tested against the true wire shape: per-wordpiece, BIO, `##`, no offsets.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import {
  detectNer,
  mergeTokens,
  chunkText,
  CHUNK_CHARS,
  __setNerRunner,
  type NerToken,
} from '../../lib/detection/ner';
import { REAL } from '../fixtures/ner-real';

afterEach(() => __setNerRunner(null));

const replay = (text: string) => async (t: string) => {
  if (t !== text) throw new Error('unexpected text');
  return REAL[text]!;
};

describe('mergeTokens (real model output)', () => {
  it('Jean Dupont-Lachapelle → one PER span, exact offsets', () => {
    const text = 'Please email Jean Dupont-Lachapelle about the invoice.';
    const ents = mergeTokens(text, REAL[text]!);
    expect(ents).toHaveLength(1);
    expect(text.slice(ents[0]!.start, ents[0]!.end)).toBe('Jean Dupont-Lachapelle');
    expect(ents[0]!.entity_group).toBe('PER');
  });

  it('accents and ## pieces: Élodie Martin / Genève / Nestlé', () => {
    const text = 'Élodie Martin lives in Genève and works at Nestlé.';
    const got = mergeTokens(text, REAL[text]!).map((e) => [e.entity_group, text.slice(e.start, e.end)]);
    expect(got).toEqual([['PER', 'Élodie Martin'], ['LOC', 'Genève'], ['ORG', 'Nestlé']]);
  });

  it('particles: Zoë van der Berg', () => {
    const text = 'My name is Zoë van der Berg.';
    const ents = mergeTokens(text, REAL[text]!);
    expect(ents.map((e) => text.slice(e.start, e.end))).toEqual(['Zoë van der Berg']);
  });

  it('hyphenated surname the model split around an O-tagged hyphen stays one span', () => {
    const text = 'please ask Oluwaseun Adeyemi-Okonkwo to call back';
    const ents = mergeTokens(text, REAL[text]!);
    expect(ents.map((e) => text.slice(e.start, e.end))).toEqual(['Oluwaseun Adeyemi-Okonkwo']);
  });

  it('a space-separated gap is NOT bridged', () => {
    const text = 'Anna x Bob';
    const toks: NerToken[] = [
      { entity: 'B-PER', score: 0.9, index: 1, word: 'Anna' },
      { entity: 'I-PER', score: 0.9, index: 3, word: 'Bob' },
    ];
    expect(mergeTokens(text, toks).map((e) => text.slice(e.start, e.end))).toEqual(['Anna', 'Bob']);
  });

  it('B- after I- of same type starts a new entity', () => {
    const text = 'Anna Bob';
    const toks: NerToken[] = [
      { entity: 'B-PER', score: 0.9, index: 1, word: 'Anna' },
      { entity: 'B-PER', score: 0.9, index: 2, word: 'Bob' },
    ];
    expect(mergeTokens(text, toks).map((e) => text.slice(e.start, e.end))).toEqual(['Anna', 'Bob']);
  });

  it('unalignable token ends the entity instead of corrupting offsets', () => {
    const text = 'Hello Anna';
    const toks: NerToken[] = [
      { entity: 'B-PER', score: 0.9, index: 1, word: '[UNK]' },
      { entity: 'I-PER', score: 0.9, index: 2, word: 'Anna' },
    ];
    expect(mergeTokens(text, toks).map((e) => text.slice(e.start, e.end))).toEqual(['Anna']);
  });
});

describe('detectNer', () => {
  it('maps labels, slices values, tags source', async () => {
    const text = 'Élodie Martin lives in Genève and works at Nestlé.';
    __setNerRunner(replay(text));
    const out = await detectNer(text, 'fr');
    expect(out.map((d) => [d.entityType, d.value, d.source])).toEqual([
      ['PERSON', 'Élodie Martin', 'ner'],
      ['LOCATION', 'Genève', 'ner'],
      ['ORG', 'Nestlé', 'ner'],
    ]);
  });

  it('drops MISC and low scores', async () => {
    __setNerRunner(async () => [
      { entity: 'B-MISC', score: 0.99, index: 1, word: 'Jean' },
      { entity: 'B-PER', score: 0.3, index: 1, word: 'Jean' },
    ]);
    expect(await detectNer('Jean', 'fr')).toEqual([]);
  });

  it('empty text never invokes the runner', async () => {
    __setNerRunner(async () => { throw new Error('no'); });
    expect(await detectNer('   ', 'fr')).toEqual([]);
  });

  it('fail-open when the runner throws', async () => {
    __setNerRunner(async () => { throw new Error('model load failed'); });
    expect(await detectNer('Jean Dupont', 'fr')).toEqual([]);
  });
});

describe('chunking', () => {
  it('short text is one chunk', () => {
    expect(chunkText('hello')).toEqual([[0, 'hello']]);
  });

  it('long text: chunks cover everything, offsets map back, no mid-word cuts', () => {
    const words = Array.from({ length: 1500 }, (_, i) => `w${i}`);
    const text = words.join(' ');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(2);
    for (const [off, piece] of chunks) {
      expect(text.slice(off, off + piece.length)).toBe(piece);
      expect(piece.length).toBeLessThanOrEqual(CHUNK_CHARS);
      expect(/^w\d+/.test(piece)).toBe(true);
      expect(/w\d+$/.test(piece)).toBe(true);
    }
    expect(chunks[0]![0]).toBe(0);
    const last = chunks.at(-1)!;
    expect(last[0] + last[1].length).toBe(text.length);
  });

  it('a name late in a long text is found once with correct global offset', async () => {
    const filler = 'lorem ipsum dolor sit amet '.repeat(200);
    const text = `${filler}Anna Keller ${filler}`;
    __setNerRunner(async (piece) => {
      const i = piece.indexOf('Anna Keller');
      if (i < 0) return [];
      // emulate the model: wordpieces in order
      return [
        { entity: 'B-PER', score: 0.99, index: 1, word: 'Anna' },
        { entity: 'I-PER', score: 0.99, index: 2, word: 'Keller' },
      ].map((t) => t) as NerToken[];
    });
    // Runner returns tokens relative to its piece; mergeTokens searches from
    // cursor 0, so "Anna" is located at its first occurrence in that piece.
    const out = await detectNer(text, 'en');
    expect(out).toHaveLength(1);
    expect(out[0]!.value).toBe('Anna Keller');
    expect(text.indexOf('Anna Keller')).toBe(out[0]!.start);
  });
});
