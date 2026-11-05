import { describe, it, expect, afterEach } from 'bun:test';
import { detectNerRemote, setNerTransport } from '../../lib/detection/ner-client';
import { analyze } from '../../lib/detection/engine';
import type { Detection } from '../../lib/detection/types';

afterEach(() => setNerTransport(async () => []));

const person = (text: string): Detection => ({
  entityType: 'PERSON', start: 0, end: 4, score: 0.99, value: text.slice(0, 4), source: 'ner',
});

describe('NER time budget', () => {
  it('returns model result when it answers in time', async () => {
    setNerTransport(async (t) => [person(t)]);
    const r = await detectNerRemote('Anna', 'en', 200);
    expect(r.timedOut).toBe(false);
    expect(r.detections).toHaveLength(1);
  });

  it('slow model: gives up at the budget, flags timedOut', async () => {
    setNerTransport(() => new Promise((res) => setTimeout(() => res([]), 500)));
    const t0 = Date.now();
    const r = await detectNerRemote('Anna', 'en', 50);
    expect(Date.now() - t0).toBeLessThan(300);
    expect(r).toEqual({ detections: [], timedOut: true });
  });

  it('transport rejection is fail-open, not a timeout', async () => {
    setNerTransport(async () => { throw new Error('boom'); });
    expect(await detectNerRemote('Anna', 'en', 50)).toEqual({ detections: [], timedOut: false });
  });

  it('engine still catches regex PII and reports nerTimedOut', async () => {
    setNerTransport(() => new Promise((res) => setTimeout(() => res([]), 2000)));
    const t0 = Date.now();
    const r = await analyze('mail me at anna@example.com');
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(r.detections.some((d) => d.entityType === 'EMAIL_ADDRESS')).toBe(true);
    expect(r.nerTimedOut).toBe(true);
  });
});
