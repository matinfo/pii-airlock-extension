import { describe, it, expect, beforeEach } from 'bun:test';
import { tierOf, getDecision, applySettings, DEFAULT_SETTINGS } from '../lib/policy';

// Reset to defaults before each test to avoid cross-test pollution
beforeEach(() => applySettings(DEFAULT_SETTINGS));

// ── tierOf ────────────────────────────────────────────────────────────────────

describe('tierOf', () => {
  it('classifies high-risk entities', () => {
    const high = ['EMAIL_ADDRESS', 'PHONE_NUMBER', 'CREDIT_CARD', 'IBAN_CODE',
                  'SSN', 'IP_ADDRESS', 'CRYPTO', 'SECRET_KEY'];
    for (const e of high) expect(tierOf(e)).toBe('high');
  });

  it('classifies medium-risk entities', () => {
    for (const e of ['PERSON', 'LOCATION', 'ORG']) {
      expect(tierOf(e)).toBe('medium');
    }
  });

  it('classifies low-risk entities', () => {
    expect(tierOf('DATE_OF_BIRTH')).toBe('low');
  });

  it('defaults unknown types to medium (conservative)', () => {
    expect(tierOf('UNKNOWN_THING')).toBe('medium');
  });
});

// ── getDecision (strict mode — default) ──────────────────────────────────────

describe('getDecision — strict mode (default)', () => {
  const makeDetection = (entityType: string) => ({
    entityType, start: 0, end: 5, score: 0.9, value: 'x', source: 'regex' as const,
  });

  it('returns allow when no detections', () => {
    expect(getDecision([])).toBe('allow');
  });

  it('returns block for high-risk', () => {
    expect(getDecision([makeDetection('EMAIL_ADDRESS')])).toBe('block');
    expect(getDecision([makeDetection('CREDIT_CARD')])).toBe('block');
  });

  it('returns auto_scrub for medium-risk', () => {
    expect(getDecision([makeDetection('PERSON')])).toBe('auto_scrub');
    expect(getDecision([makeDetection('LOCATION')])).toBe('auto_scrub');
  });

  it('returns warn for low-risk', () => {
    expect(getDecision([makeDetection('DATE_OF_BIRTH')])).toBe('warn');
  });

  it('picks most restrictive when mixed tiers present', () => {
    // high + low → block (most restrictive)
    expect(getDecision([makeDetection('EMAIL_ADDRESS'), makeDetection('DATE_OF_BIRTH')])).toBe('block');
    // medium + low → auto_scrub
    expect(getDecision([makeDetection('PERSON'), makeDetection('DATE_OF_BIRTH')])).toBe('auto_scrub');
  });
});

// ── getDecision (permissive mode) ─────────────────────────────────────────────

describe('getDecision — permissive mode', () => {
  const makeDetection = (entityType: string) => ({
    entityType, start: 0, end: 5, score: 0.9, value: 'x', source: 'regex' as const,
  });

  beforeEach(() => applySettings({ mode: 'permissive' }));

  it('returns auto_scrub for high-risk', () => {
    expect(getDecision([makeDetection('EMAIL_ADDRESS')])).toBe('auto_scrub');
  });

  it('returns warn for medium-risk', () => {
    expect(getDecision([makeDetection('PERSON')])).toBe('warn');
  });

  it('returns notify for low-risk', () => {
    expect(getDecision([makeDetection('DATE_OF_BIRTH')])).toBe('notify');
  });
});

// ── overrides ─────────────────────────────────────────────────────────────────

describe('per-entity overrides', () => {
  const makeDetection = (entityType: string) => ({
    entityType, start: 0, end: 5, score: 0.9, value: 'x', source: 'regex' as const,
  });

  it('override takes precedence over matrix', () => {
    applySettings({ overrides: { EMAIL_ADDRESS: 'warn' } });
    // Normally strict → block, but override says warn
    expect(getDecision([makeDetection('EMAIL_ADDRESS')])).toBe('warn');
  });

  it('override for one type does not affect other types', () => {
    applySettings({ overrides: { EMAIL_ADDRESS: 'allow' } });
    // PHONE_NUMBER still follows matrix (block in strict)
    expect(getDecision([makeDetection('PHONE_NUMBER')])).toBe('block');
  });

  it('most restrictive wins even with overrides', () => {
    // EMAIL overridden to 'warn', PERSON natural 'auto_scrub' → auto_scrub wins
    applySettings({ overrides: { EMAIL_ADDRESS: 'warn' } });
    expect(
      getDecision([makeDetection('EMAIL_ADDRESS'), makeDetection('PERSON')])
    ).toBe('auto_scrub');
  });
});
