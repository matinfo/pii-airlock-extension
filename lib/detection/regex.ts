/**
 * Layer 1 — Regex-based structured PII detection.
 *
 * Covers entities that have well-defined machine-readable formats.
 * Runs synchronously in ~0ms. Never makes network calls.
 *
 * Entity types returned are intentionally compatible with the pii-airlock
 * Python token format so mappings can be shared when the optional enhanced
 * mode is active.
 *
 * The `lang` parameter enables locale-specific phone number patterns that
 * cover local (non-international) formats. The universal phone pattern
 * already handles +XX country-code prefixed numbers for all locales.
 */

import type { Detection } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function luhn(num: string): boolean {
  const digits = num.replace(/\D/g, '');
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function findAll(
  text: string,
  pattern: RegExp,
  entityType: string,
  validate?: (match: string) => boolean,
): Detection[] {
  const results: Detection[] = [];
  pattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const value = m[0];
    if (validate && !validate(value)) continue;
    results.push({
      entityType,
      start: m.index,
      end: m.index + value.length,
      score: 0.95,
      value,
      source: 'regex',
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Universal patterns (language-independent)
// ---------------------------------------------------------------------------

const RE_EMAIL = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

// International phone: +33 6 12 34 56 78, (555) 867-5309, +1 (800) 555-0100
// Also catches US-format without country code.
const RE_PHONE_INTL =
  /(?<!\d)(\+?1[\s.\-]?)?(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})(?!\d)|(\+\d{1,3}[\s.\-]?\(?\d+\)?(?:[\s.\-]?\d{2,}){2,})(?!\d)/g;

const RE_CARD = /\b(?:\d[ \-]?){13,19}\b/g;
const RE_IBAN = /\b[A-Z]{2}\d{2}[ A-Z0-9]{10,30}\b/g;
const RE_SSN  = /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g;

const RE_IPV4 =
  /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
const RE_IPV6 = /\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b/g;

const RE_BTC =
  /\b(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{39,59})\b/g;
const RE_ETH = /\b0x[a-fA-F0-9]{40}\b/g;

// Secret keys / tokens — captures keyword + value so the whole secret is replaced
const RE_SECRET =
  /(?:^|[\s"'`=:])(?:(?:Bearer)\s+\S{8,}|(?:token|password|passwd|secret|api[_-]?key)[=:\s]+\S{4,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36}|ghs_[A-Za-z0-9]{36}|glpat-[A-Za-z0-9\-]{20,}|eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)/gim;

const RE_DOB_LABEL =
  /\b(?:dob|date of birth|born|birthday)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})\b/gi;

// ---------------------------------------------------------------------------
// Locale-specific phone patterns
//
// These cover local national formats that do NOT use a + country code prefix.
// The universal RE_PHONE_INTL already catches international (+XX ...) forms
// across all locales — these patterns are additive, not replacements.
// ---------------------------------------------------------------------------

/**
 * Local phone number patterns keyed by BCP-47 language code.
 *
 * Each regex uses non-capturing groups for internal structure; the full match
 * is the PII span. All must have the `g` flag and no pre-existing `lastIndex`.
 */
const LOCALE_PHONE: Record<string, RegExp> = {
  // French: 10-digit numbers starting with 0, groups of 2
  // Covers: 06 12 34 56 78 (mobile), 01 23 45 67 89 (landline)
  fr: /(?<!\d)(0[1-9])(?:[\s.\-]?\d{2}){4}(?!\d)/g,

  // German: landlines (0XX/XXX) and mobiles (015x/016x/017x)
  // Covers: 0176 12345678, 030 12345678
  de: /(?<!\d)0(?:1[5-7]\d[\s\-]?\d{7}|\d{2,5}[\s\-\/]?\d{3,8})(?!\d)/g,

  // UK: 11-digit numbers starting with 0 — covers mobiles (07xxx) and landlines
  // Landlines: 0XX XXXX XXXX, 0XXX XXX XXXX, 0XXXX XXXXXX
  gb: /(?<!\d)0(?:7\d{3}[\s\-]?\d{6}|\d{3,4}[\s\-]?\d{3,4}[\s\-]?\d{3,4})(?!\d)/g,

  // Spanish: 9-digit numbers starting with 6 or 7 (mobile) or 8/9 (landline)
  // Covers: 612 345 678, 912 345 678
  es: /(?<!\d)[6-9]\d{2}[\s.\-]?\d{3}[\s.\-]?\d{3}(?!\d)/g,

  // Italian: 10-digit mobiles (3xx) and landlines (0xx)
  // Covers: 347 123 4567, 06 1234 5678
  it: /(?<!\d)(?:3\d{2}|0\d{1,3})[\s.\-]?\d{3,4}[\s.\-]?\d{4}(?!\d)/g,

  // Portuguese: 9-digit mobiles (9x) and landlines (2x)
  // Covers: 912 345 678, 21 234 5678
  pt: /(?<!\d)[29]\d{1,2}[\s.\-]?\d{3}[\s.\-]?\d{3,4}(?!\d)/g,

  // Dutch: 10-digit starting with 0 — mobiles (06) and landlines (0xx)
  // Covers: 06 12345678, 020 1234567
  nl: /(?<!\d)0(?:6[\s\-]?\d{8}|\d{2}[\s\-]?\d{7})(?!\d)/g,

  // Polish: 9-digit numbers (no leading 0), groups of 3
  // Covers: 512 345 678, 22 234 5678
  pl: /(?<!\d)(?:[45]\d{2}|[6789]\d{2}|[12]\d)[\s.\-]?\d{3}[\s.\-]?\d{3,4}(?!\d)/g,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run regex-based detection on `text`.
 *
 * @param text  The message text to scan.
 * @param lang  BCP-47 language code (e.g. "fr", "de") used to add locale-
 *              specific phone patterns on top of the universal pattern.
 *              Defaults to "en" (no locale-specific extras beyond universal).
 */
export function detectRegex(text: string, lang = 'en'): Detection[] {
  const results: Detection[] = [];

  results.push(...findAll(text, new RegExp(RE_EMAIL.source, 'g'), 'EMAIL_ADDRESS'));

  // Universal phone (international format / US format)
  results.push(...findAll(text, new RegExp(RE_PHONE_INTL.source, 'g'), 'PHONE_NUMBER'));

  // Locale-specific local phone format (e.g. French "06 12 34 56 78")
  const localPhoneRe = LOCALE_PHONE[lang];
  if (localPhoneRe) {
    results.push(...findAll(text, new RegExp(localPhoneRe.source, 'g'), 'PHONE_NUMBER'));
  }

  results.push(
    ...findAll(text, new RegExp(RE_CARD.source, 'g'), 'CREDIT_CARD', (v) =>
      luhn(v.replace(/\D/g, '')) && v.replace(/\D/g, '').length >= 13,
    ),
  );
  results.push(...findAll(text, new RegExp(RE_IBAN.source, 'g'), 'IBAN_CODE'));
  results.push(...findAll(text, new RegExp(RE_SSN.source, 'g'), 'SSN'));
  results.push(...findAll(text, new RegExp(RE_IPV4.source, 'g'), 'IP_ADDRESS'));
  results.push(...findAll(text, new RegExp(RE_IPV6.source, 'g'), 'IP_ADDRESS'));
  results.push(...findAll(text, new RegExp(RE_BTC.source, 'g'), 'CRYPTO'));
  results.push(...findAll(text, new RegExp(RE_ETH.source, 'g'), 'CRYPTO'));

  // SECRET_KEY: trim leading separator so the token covers only the secret value
  const secretPattern = new RegExp(RE_SECRET.source, 'gim');
  secretPattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = secretPattern.exec(text)) !== null) {
    const raw = m[0];
    const trimmed = raw.trimStart().replace(/^["'`=:\s]+/, '');
    const offset = raw.length - trimmed.length;
    results.push({
      entityType: 'SECRET_KEY',
      start: m.index + offset,
      end: m.index + raw.length,
      score: 0.9,
      value: trimmed,
      source: 'regex',
    });
  }

  // DATE_OF_BIRTH — only when preceded by a DOB label
  const dobPattern = new RegExp(RE_DOB_LABEL.source, 'gi');
  dobPattern.lastIndex = 0;
  while ((m = dobPattern.exec(text)) !== null) {
    const dateStr = m[1];
    const dateStart = m.index + m[0].indexOf(dateStr);
    results.push({
      entityType: 'DATE_OF_BIRTH',
      start: dateStart,
      end: dateStart + dateStr.length,
      score: 0.8,
      value: dateStr,
      source: 'regex',
    });
  }

  return results;
}
