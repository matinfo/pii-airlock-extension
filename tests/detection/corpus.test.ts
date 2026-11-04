/**
 * Precision / recall gate over tests/fixtures/corpus.ts under the DEFAULT policy.
 * A hit counts only if the default policy would act on it (scrub/warn/block);
 * notify-only hits (locations, orgs, private IPs) are not interruptions.
 */
import { describe, it, expect, beforeAll } from 'bun:test';
import { analyze } from '../../lib/detection/engine';
import { applySettings, mustScrub } from '../../lib/policy';
import { CORPUS, type Case } from '../fixtures/corpus';

beforeAll(() => applySettings({ mode: 'strict', overrides: {} }));

async function actionable(text: string) {
  const r = await analyze(text, { skipNer: true });
  expect(r.error).toBeUndefined();
  return r.detections.filter(mustScrub);
}

describe('corpus: per-case', () => {
  for (const c of CORPUS) {
    it(c.text.slice(0, 70), async () => {
      const hits = await actionable(c.text);
      for (const want of c.pii) {
        const at = c.text.indexOf(want.value);
        const covered = hits.some(
          (h) => h.start <= at && h.end >= at + want.value.length && want.types.includes(h.entityType),
        );
        expect({ missed: want.value, hits: hits.map((h) => `${h.entityType}:${h.value}`) }).toEqual(
          covered ? { missed: want.value, hits: hits.map((h) => `${h.entityType}:${h.value}`) } : { missed: '', hits: [] },
        );
      }
      const spurious = hits.filter(
        (h) => !c.pii.some((w) => {
          const at = c.text.indexOf(w.value);
          return h.start < at + w.value.length && h.end > at;
        }),
      );
      expect(spurious.map((h) => `${h.entityType}:${h.value}`)).toEqual([]);
    });
  }
});

describe('corpus: aggregate gate', () => {
  it('precision >= 0.98 and recall >= 0.95', async () => {
    let tp = 0, fp = 0, fn = 0;
    for (const c of CORPUS as Case[]) {
      const hits = await actionable(c.text);
      const matched = new Set<number>();
      c.pii.forEach((w, i) => {
        const at = c.text.indexOf(w.value);
        const hit = hits.findIndex(
          (h) => h.start <= at && h.end >= at + w.value.length && w.types.includes(h.entityType),
        );
        if (hit >= 0) { tp++; matched.add(hit); } else fn++;
      });
      fp += hits.filter((_, i) => !matched.has(i) && !c.pii.some((w) => {
        const at = c.text.indexOf(w.value);
        return hits[i]!.start < at + w.value.length && hits[i]!.end > at;
      })).length;
    }
    const precision = tp / Math.max(1, tp + fp);
    const recall = tp / Math.max(1, tp + fn);
    console.log(`corpus: tp=${tp} fp=${fp} fn=${fn} precision=${precision.toFixed(3)} recall=${recall.toFixed(3)}`);
    expect(precision).toBeGreaterThanOrEqual(0.98);
    expect(recall).toBeGreaterThanOrEqual(0.95);
  });
});
