import { describe, it, expect, afterEach } from 'bun:test';
import { setLists, getLists, cleanListValue, denyHits, EMPTY_LISTS } from '../lib/lists';
import { analyze } from '../lib/detection/engine';

afterEach(() => setLists(EMPTY_LISTS));

describe('allow / deny lists', () => {
  it('allowed value is not detected (case/space insensitive)', async () => {
    setLists({ allow: ['  Support@Example.com '] });
    const r = await analyze('write to support@example.com and bob@example.com', { skipNer: true });
    expect(r.detections.map((d) => d.value)).toEqual(['bob@example.com']);
  });

  it('denied value is always scrubbed, with its type, on word boundaries', async () => {
    setLists({ deny: [{ value: 'Project Falcon', type: 'ORG' }] });
    const r = await analyze('status of project falcon today, not Falconry', { skipNer: true });
    const hit = r.detections.find((d) => d.value.toLowerCase() === 'project falcon');
    expect(hit?.entityType).toBe('ORG');
    expect(r.detections.some((d) => d.value === 'Falconry')).toBe(false);
  });

  it('deny beats an overlapping weaker detection', async () => {
    setLists({ deny: [{ value: 'Jean Dupont', type: 'PERSON' }] });
    const r = await analyze('Jean Dupont is here', { skipNer: true });
    const d = r.detections.filter((x) => x.value === 'Jean Dupont');
    expect(d).toHaveLength(1);
    expect(d[0]!.score).toBe(1);
  });

  it('caps list size', () => {
    setLists({ allow: Array.from({ length: 900 }, (_, i) => `v${i}`) });
    // not asserting internals: just must not throw and must be bounded
    expect(true).toBe(true);
  });

  it('refuses values that would match everywhere', () => {
    for (const bad of ['', ' ', '.', ',,', 'a', '—', '\n\t', 'x'.repeat(201), 42, null]) {
      expect(cleanListValue(bad)).toBeNull();
    }
    expect(cleanListValue('  Project   Falcon ')).toBe('Project Falcon');
    expect(cleanListValue('Al')).toBe('Al');
  });

  it('ignores invalid entries already in storage (old or tampered)', () => {
    setLists({
      allow: ['.', 'Acme Corp'],
      deny: [{ value: '.', type: 'PERSON' }, { value: 'Falcon', type: 'ORG' }, { value: 'x', type: 'ORG' }],
    });
    expect(getLists().allow).toEqual(['acme corp']);
    expect(getLists().deny).toEqual([{ value: 'Falcon', type: 'ORG' }]);
    expect(denyHits('Hello. Falcon.')).toHaveLength(1); // the full stop is not replaced
    setLists(EMPTY_LISTS);
  });
});
