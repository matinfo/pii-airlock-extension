import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { BrowserMapping } from '../lib/mapping';

describe('BrowserMapping', () => {
  let m: BrowserMapping;

  beforeEach(() => { m = new BrowserMapping(); });
  afterEach(() => { m.clear(); });

  // ── tokenFor ───────────────────────────────────────────────────────────────

  describe('tokenFor', () => {
    it('mints a token with correct format', () => {
      const t = m.tokenFor('EMAIL_ADDRESS', 'a@b.com');
      expect(t).toBe('<EMAIL_ADDRESS_1>');
    });

    it('returns same token for same (type, value)', () => {
      const t1 = m.tokenFor('EMAIL_ADDRESS', 'a@b.com');
      const t2 = m.tokenFor('EMAIL_ADDRESS', 'a@b.com');
      expect(t1).toBe(t2);
    });

    it('increments counter per entity type', () => {
      const t1 = m.tokenFor('EMAIL_ADDRESS', 'a@b.com');
      const t2 = m.tokenFor('EMAIL_ADDRESS', 'b@c.com');
      expect(t1).toBe('<EMAIL_ADDRESS_1>');
      expect(t2).toBe('<EMAIL_ADDRESS_2>');
    });

    it('keeps counters separate per type', () => {
      m.tokenFor('EMAIL_ADDRESS', 'a@b.com');
      const t = m.tokenFor('PHONE_NUMBER', '+1234567890');
      expect(t).toBe('<PHONE_NUMBER_1>');
    });
  });

  // ── restore ────────────────────────────────────────────────────────────────

  describe('restore', () => {
    it('restores a single token', () => {
      m.tokenFor('EMAIL_ADDRESS', 'alice@x.com');
      const out = m.restore('send to <EMAIL_ADDRESS_1> please');
      expect(out).toBe('send to alice@x.com please');
    });

    it('restores multiple tokens in same string', () => {
      m.tokenFor('EMAIL_ADDRESS', 'alice@x.com');
      m.tokenFor('PHONE_NUMBER', '555-1234');
      const out = m.restore('email <EMAIL_ADDRESS_1>, phone <PHONE_NUMBER_1>');
      expect(out).toBe('email alice@x.com, phone 555-1234');
    });

    it('leaves unknown tokens unchanged', () => {
      const out = m.restore('keep <UNKNOWN_TOKEN_99> as-is');
      expect(out).toBe('keep <UNKNOWN_TOKEN_99> as-is');
    });

    it('restores same token appearing twice', () => {
      m.tokenFor('EMAIL_ADDRESS', 'x@y.com');
      const out = m.restore('<EMAIL_ADDRESS_1> and <EMAIL_ADDRESS_1>');
      expect(out).toBe('x@y.com and x@y.com');
    });
  });

  // ── scrub ──────────────────────────────────────────────────────────────────

  describe('scrub', () => {
    it('replaces detected span with token', () => {
      const text = 'my email is alice@example.com ok';
      const detections = [{
        entityType: 'EMAIL_ADDRESS', start: 12, end: 29,
        score: 0.95, value: 'alice@example.com', source: 'regex' as const,
      }];
      const out = m.scrub(text, detections);
      expect(out).toBe('my email is <EMAIL_ADDRESS_1> ok');
    });

    it('handles overlapping-safe right-to-left replacement', () => {
      const text = 'a@b.com and c@d.com';
      const detections = [
        { entityType: 'EMAIL_ADDRESS', start: 0, end: 7, score: 0.95, value: 'a@b.com', source: 'regex' as const },
        { entityType: 'EMAIL_ADDRESS', start: 12, end: 19, score: 0.95, value: 'c@d.com', source: 'regex' as const },
      ];
      const out = m.scrub(text, detections);
      expect(out).toBe('<EMAIL_ADDRESS_1> and <EMAIL_ADDRESS_2>');
    });

    it('scrub then restore round-trips correctly', () => {
      const original = 'my email alice@x.com is important';
      const detections = [{
        entityType: 'EMAIL_ADDRESS', start: 9, end: 20,
        score: 0.95, value: 'alice@x.com', source: 'regex' as const,
      }];
      const scrubbed = m.scrub(original, detections);
      const restored = m.restore(scrubbed);
      expect(restored).toBe(original);
    });
  });

  // ── clear ──────────────────────────────────────────────────────────────────

  describe('clear', () => {
    it('resets size to 0', () => {
      m.tokenFor('EMAIL_ADDRESS', 'x@y.com');
      expect(m.size).toBe(1);
      m.clear();
      expect(m.size).toBe(0);
    });

    it('re-mints tokens from 1 after clear', () => {
      m.tokenFor('EMAIL_ADDRESS', 'x@y.com');
      m.clear();
      const t = m.tokenFor('EMAIL_ADDRESS', 'other@z.com');
      expect(t).toBe('<EMAIL_ADDRESS_1>');
    });

    it('does not restore after clear', () => {
      m.tokenFor('EMAIL_ADDRESS', 'x@y.com');
      m.clear();
      const out = m.restore('<EMAIL_ADDRESS_1>');
      // Token unknown after clear — leaves as-is
      expect(out).toBe('<EMAIL_ADDRESS_1>');
    });
  });
});
