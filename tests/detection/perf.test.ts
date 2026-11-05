/**
 * Large pasted blobs must not freeze the page. These inputs used to take seconds
 * to minutes (quadratic URL-password regex, per-match full-text scans in the NLP
 * layer). Bounds are loose (CI noise) but far below the old behaviour.
 */
import { test, expect } from 'bun:test';
import { analyze } from '../../lib/detection/engine';

const cases: Record<string, string> = {
  'hex blob 200k': 'a1b2'.repeat(50_000),
  'dotted blob 100k': 'a.'.repeat(50_000) + '@x',
  'repeated names 200k': 'Jean Dupont Marie Curie '.repeat(8_000),
  'unterminated keys': '-----BEGIN PRIVATE KEY-----'.repeat(5_000),
  'url prefixes': 'http://a:'.repeat(20_000),
};

for (const [name, text] of Object.entries(cases)) {
  test(`perf: ${name} analysed in under 5s`, async () => {
    const t0 = performance.now();
    const r = await analyze(text, { skipNer: true });
    expect(r.error).toBeUndefined();
    expect(performance.now() - t0).toBeLessThan(5000);
  }, 30_000);
}
