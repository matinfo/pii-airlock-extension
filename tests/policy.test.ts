import { describe, it, expect, beforeEach } from 'bun:test';
import { tierOf, getDecision, applySettings, currentSettings, isActive, DEFAULT_SETTINGS } from '../lib/policy';

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

// ── getDecision ───────────────────────────────────────────────────────────────

const det = (entityType: string) => ({
  entityType, start: 0, end: 5, score: 0.9, value: 'x', source: 'regex' as const,
});

describe('getDecision — auto mode (default)', () => {
  it('allow when nothing detected', () => {
    expect(getDecision([])).toBe('allow');
  });

  it('structured data, names and DOB are scrubbed without asking', () => {
    for (const t of ['EMAIL_ADDRESS', 'CREDIT_CARD', 'SECRET_KEY', 'PERSON', 'DATE_OF_BIRTH', 'FR_NIR']) {
      expect(getDecision([det(t)])).toBe('auto_scrub');
    }
  });

  it('LOCATION, ORG and private IPs are notify-only (too common in prose)', () => {
    for (const t of ['LOCATION', 'ORG', 'IP_ADDRESS_PRIVATE']) {
      expect(getDecision([det(t)])).toBe('notify');
    }
  });

  it('most restrictive wins', () => {
    expect(getDecision([det('LOCATION'), det('EMAIL_ADDRESS')])).toBe('auto_scrub');
  });
});

describe('modes', () => {
  it('review: scrub-set becomes an ask, notify-only stays notify', () => {
    applySettings({ mode: 'review' });
    expect(getDecision([det('EMAIL_ADDRESS')])).toBe('warn');
    expect(getDecision([det('LOCATION')])).toBe('notify');
  });

  it('off: everything allowed, isActive false', () => {
    applySettings({ mode: 'off' });
    expect(getDecision([det('EMAIL_ADDRESS'), det('PERSON')])).toBe('allow');
    expect(isActive()).toBe(false);
  });

  it('legacy strict/permissive values map to auto', () => {
    applySettings({ mode: 'strict' });
    expect(currentSettings().mode).toBe('auto');
    applySettings({ mode: 'permissive' });
    expect(currentSettings().mode).toBe('auto');
  });

  it('site off and pause disable protection, then it resumes', () => {
    applySettings({ siteOff: true });
    expect(isActive()).toBe(false);
    applySettings({ siteOff: false, pausedUntil: 1000 });
    expect(isActive(999)).toBe(false);
    expect(isActive(1000)).toBe(true);
  });
});

describe('per-entity overrides', () => {
  it('override beats the mode', () => {
    applySettings({ overrides: { EMAIL_ADDRESS: 'warn' } });
    expect(getDecision([det('EMAIL_ADDRESS')])).toBe('warn');
    applySettings({ overrides: { EMAIL_ADDRESS: 'allow' } });
    expect(getDecision([det('EMAIL_ADDRESS')])).toBe('allow');
  });

  it('override for one type does not affect others', () => {
    applySettings({ overrides: { EMAIL_ADDRESS: 'allow' } });
    expect(getDecision([det('PHONE_NUMBER')])).toBe('auto_scrub');
  });

  it('a notify-only type can be forced to scrub', () => {
    applySettings({ overrides: { LOCATION: 'auto_scrub' } });
    expect(getDecision([det('LOCATION')])).toBe('auto_scrub');
  });
});
