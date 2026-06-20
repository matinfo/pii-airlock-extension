/**
 * Locale-specific phone detection tests.
 *
 * Verifies that detectRegex() correctly identifies local national phone
 * formats (without a +XX country code prefix) when lang is provided.
 * The universal international pattern (+XX ...) is always active regardless
 * of locale — these tests focus on the local-format extras.
 */

import { describe, it, expect } from 'bun:test';
import { detectRegex } from '../../lib/detection/regex';

function hasPhone(text: string, lang: string) {
  return detectRegex(text, lang).some((d) => d.entityType === 'PHONE_NUMBER');
}

function noPhone(text: string, lang: string) {
  return !detectRegex(text, lang).some((d) => d.entityType === 'PHONE_NUMBER');
}

// ── Universal (international format) — always detected regardless of lang ────

describe('Universal phone (+ prefix)', () => {
  it('detects +33 French mobile', () => expect(hasPhone('+33 6 12 34 56 78', 'en')).toBe(true));
  it('detects +49 German mobile', () => expect(hasPhone('+49 176 12345678', 'en')).toBe(true));
  it('detects +44 UK number',     () => expect(hasPhone('+44 7911 123456', 'en')).toBe(true));
  it('detects +1 US number',      () => expect(hasPhone('+1 555 867 5309', 'en')).toBe(true));
});

// ── French local format ───────────────────────────────────────────────────────

describe('French local phone (lang=fr)', () => {
  it('detects mobile with spaces: 06 12 34 56 78', () =>
    expect(hasPhone('call me at 06 12 34 56 78', 'fr')).toBe(true));

  it('detects mobile compact: 0612345678', () =>
    expect(hasPhone('tel: 0612345678', 'fr')).toBe(true));

  it('detects mobile with dots: 06.12.34.56.78', () =>
    expect(hasPhone('06.12.34.56.78', 'fr')).toBe(true));

  it('detects landline: 01 23 45 67 89', () =>
    expect(hasPhone('fixe: 01 23 45 67 89', 'fr')).toBe(true));

  it('does NOT detect French local format when lang=en', () =>
    // Universal pattern won't match bare French local format
    expect(hasPhone('06 12 34 56 78', 'en')).toBe(false));
});

// ── German local format ───────────────────────────────────────────────────────

describe('German local phone (lang=de)', () => {
  it('detects mobile: 0176 12345678', () =>
    expect(hasPhone('Handy: 0176 12345678', 'de')).toBe(true));

  it('detects mobile: 015712345678', () =>
    expect(hasPhone('015712345678', 'de')).toBe(true));

  it('detects Berlin landline: 030 12345678', () =>
    expect(hasPhone('Festnetz: 030 12345678', 'de')).toBe(true));
});

// ── UK local format ───────────────────────────────────────────────────────────

describe('UK local phone (lang=gb)', () => {
  it('detects mobile: 07911 123456', () =>
    expect(hasPhone('call 07911 123456', 'gb')).toBe(true));

  it('detects Glasgow landline: 0141 234 5678', () =>
    expect(hasPhone('0141 234 5678', 'gb')).toBe(true));
});

// ── Spanish local format ──────────────────────────────────────────────────────

describe('Spanish local phone (lang=es)', () => {
  it('detects mobile: 612 345 678', () =>
    expect(hasPhone('llama al 612 345 678', 'es')).toBe(true));

  it('detects landline: 912 345 678', () =>
    expect(hasPhone('912 345 678', 'es')).toBe(true));
});

// ── Italian local format ──────────────────────────────────────────────────────

describe('Italian local phone (lang=it)', () => {
  it('detects mobile: 347 123 4567', () =>
    expect(hasPhone('cellulare: 347 123 4567', 'it')).toBe(true));
});

// ── Portuguese local format ───────────────────────────────────────────────────

describe('Portuguese local phone (lang=pt)', () => {
  it('detects mobile: 912 345 678', () =>
    expect(hasPhone('telemovel: 912 345 678', 'pt')).toBe(true));
});

// ── Dutch local format ────────────────────────────────────────────────────────

describe('Dutch local phone (lang=nl)', () => {
  it('detects mobile: 06 12345678', () =>
    expect(hasPhone('bel: 06 12345678', 'nl')).toBe(true));
});

// ── Span correctness ──────────────────────────────────────────────────────────

describe('Locale phone span correctness', () => {
  it('French: start/end slice equals matched value', () => {
    const text = 'mon numéro: 06 12 34 56 78 merci';
    const detections = detectRegex(text, 'fr').filter((d) => d.entityType === 'PHONE_NUMBER');
    for (const d of detections) {
      expect(text.slice(d.start, d.end)).toBe(d.value);
    }
    expect(detections.length).toBeGreaterThan(0);
  });

  it('German: start/end slice equals matched value', () => {
    const text = 'Ruf mich an: 0176 12345678 bitte';
    const detections = detectRegex(text, 'de').filter((d) => d.entityType === 'PHONE_NUMBER');
    for (const d of detections) {
      expect(text.slice(d.start, d.end)).toBe(d.value);
    }
    expect(detections.length).toBeGreaterThan(0);
  });
});
