/**
 * Layer 3 NER tests — use an injected runner so no 107MB model is loaded.
 * Verifies label mapping, score gating, offset→value slicing, and fail-open.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { detectNer, __setNerRunner, type NerEntity } from '../../lib/detection/ner';

function runnerFrom(entities: NerEntity[]) {
  return async () => entities;
}

afterEach(() => __setNerRunner(null));

describe('detectNer', () => {
  const text = 'Je vais à la plage avec Jean et Élodie Dupont à Lyon.';
  const jeanStart = text.indexOf('Jean');
  const elodieStart = text.indexOf('Élodie Dupont');
  const lyonStart = text.indexOf('Lyon');

  it('maps PER/LOC/ORG labels and slices value from offsets', async () => {
    __setNerRunner(
      runnerFrom([
        { entity_group: 'PER', score: 0.99, word: 'Jean', start: jeanStart, end: jeanStart + 4 },
        { entity_group: 'PER', score: 0.97, word: 'Élodie Dupont', start: elodieStart, end: elodieStart + 'Élodie Dupont'.length },
        { entity_group: 'LOC', score: 0.95, word: 'Lyon', start: lyonStart, end: lyonStart + 4 },
      ]),
    );
    const out = await detectNer(text, 'fr');
    expect(out.map((d) => [d.entityType, d.value])).toEqual([
      ['PERSON', 'Jean'],
      ['PERSON', 'Élodie Dupont'],
      ['LOCATION', 'Lyon'],
    ]);
    expect(out.every((d) => d.source === 'ner')).toBe(true);
  });

  it('drops MISC and below-threshold spans', async () => {
    __setNerRunner(
      runnerFrom([
        { entity_group: 'MISC', score: 0.99, word: 'Jean', start: jeanStart, end: jeanStart + 4 },
        { entity_group: 'PER', score: 0.3, word: 'Jean', start: jeanStart, end: jeanStart + 4 },
      ]),
    );
    expect(await detectNer(text, 'fr')).toEqual([]);
  });

  it('skips empty/null offset spans', async () => {
    __setNerRunner(
      runnerFrom([{ entity_group: 'PER', score: 0.99, word: 'Jean', start: null, end: null }]),
    );
    expect(await detectNer(text, 'fr')).toEqual([]);
  });

  it('returns [] on empty text without invoking the runner', async () => {
    __setNerRunner(async () => {
      throw new Error('runner should not be called');
    });
    expect(await detectNer('   ', 'fr')).toEqual([]);
  });

  it('fail-open: returns [] when the runner throws', async () => {
    __setNerRunner(async () => {
      throw new Error('model load failed');
    });
    expect(await detectNer(text, 'fr')).toEqual([]);
  });
});
