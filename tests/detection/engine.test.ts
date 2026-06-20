/**
 * Engine integration tests.
 *
 * Tests the full analyze() pipeline: regex detection + policy decision.
 * NLP layer is skipped (skipNlp: true) so tests run deterministically
 * without depending on compromise.js internals.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { analyze } from '../../lib/detection/engine';
import { applySettings, DEFAULT_SETTINGS } from '../../lib/policy';

// Reset policy before each test
beforeEach(() => applySettings(DEFAULT_SETTINGS));

// ── allow path ───────────────────────────────────────────────────────────────

describe('analyze: clean text', () => {
  it('returns allow for plain text', async () => {
    const r = await analyze('What is the capital of France?', { skipNlp: true });
    expect(r.decision).toBe('allow');
    expect(r.detections).toHaveLength(0);
    expect(r.topTier).toBeNull();
  });

  it('returns allow for empty string', async () => {
    const r = await analyze('', { skipNlp: true });
    expect(r.decision).toBe('allow');
  });
});

// ── high-risk: strict mode (default) ─────────────────────────────────────────

describe('analyze: high-risk PII (strict)', () => {
  it('blocks on email', async () => {
    const r = await analyze('my email is alice@example.com', { skipNlp: true });
    expect(r.decision).toBe('block');
    expect(r.topTier).toBe('high');
    expect(r.detections.some((d) => d.entityType === 'EMAIL_ADDRESS')).toBe(true);
  });

  it('blocks on phone number', async () => {
    const r = await analyze('call me at (555) 867-5309', { skipNlp: true });
    expect(r.decision).toBe('block');
    expect(r.topTier).toBe('high');
  });

  it('blocks on valid credit card', async () => {
    const r = await analyze('charge 4111 1111 1111 1111', { skipNlp: true });
    expect(r.decision).toBe('block');
    expect(r.topTier).toBe('high');
  });

  it('blocks on SSN', async () => {
    const r = await analyze('my ssn: 123-45-6789', { skipNlp: true });
    expect(r.decision).toBe('block');
  });

  it('blocks on secret key', async () => {
    const r = await analyze('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig', { skipNlp: true });
    expect(r.decision).toBe('block');
    expect(r.detections.some((d) => d.entityType === 'SECRET_KEY')).toBe(true);
  });

  it('blocks on IP address', async () => {
    const r = await analyze('connect to 192.168.1.100', { skipNlp: true });
    expect(r.decision).toBe('block');
    expect(r.topTier).toBe('high');
  });
});

// ── high-risk: permissive mode ────────────────────────────────────────────────

describe('analyze: high-risk PII (permissive)', () => {
  beforeEach(() => applySettings({ mode: 'permissive' }));

  it('auto_scrubs email instead of blocking', async () => {
    const r = await analyze('my email is alice@example.com', { skipNlp: true });
    expect(r.decision).toBe('auto_scrub');
    expect(r.topTier).toBe('high');
  });
});

// ── mixed tiers ───────────────────────────────────────────────────────────────

describe('analyze: most restrictive decision wins', () => {
  it('email + DOB → block (email wins)', async () => {
    const r = await analyze('email alice@x.com born DOB: 01/15/1985', { skipNlp: true });
    expect(r.decision).toBe('block');
  });
});

// ── Luhn rejection ────────────────────────────────────────────────────────────

describe('analyze: Luhn rejection', () => {
  it('does not flag invalid card number', async () => {
    // Last digit wrong — Luhn check fails
    const r = await analyze('card 4111 1111 1111 1112', { skipNlp: true });
    expect(r.detections.some((d) => d.entityType === 'CREDIT_CARD')).toBe(false);
  });
});

// ── span integrity ────────────────────────────────────────────────────────────

describe('analyze: detection span integrity', () => {
  it('all detection start/end slices match .value', async () => {
    const text = 'email alice@x.com, phone (555) 123-4567, ssn 123-45-6789';
    const r = await analyze(text, { skipNlp: true });
    for (const d of r.detections) {
      expect(text.slice(d.start, d.end)).toBe(d.value);
    }
  });

  it('no two detections overlap', async () => {
    const text = 'email alice@x.com phone (555) 123-4567';
    const r = await analyze(text, { skipNlp: true });
    const sorted = [...r.detections].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].start).toBeGreaterThanOrEqual(sorted[i - 1].end);
    }
  });
});

// ── per-entity override ───────────────────────────────────────────────────────

describe('analyze: per-entity overrides applied', () => {
  it('override email to allow skips it', async () => {
    applySettings({ overrides: { EMAIL_ADDRESS: 'allow' } });
    const r = await analyze('email alice@x.com', { skipNlp: true });
    // Only EMAIL found and it's overridden to allow → overall allow
    expect(r.decision).toBe('allow');
  });
});
