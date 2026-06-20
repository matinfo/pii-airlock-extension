/**
 * Layer 1 — Regex-based structured PII detection.
 *
 * Covers entities that have well-defined machine-readable formats.
 * Runs synchronously in ~0ms. Never makes network calls.
 *
 * Entity types returned are intentionally compatible with the pii-airlock
 * Python token format so mappings can be shared when the optional enhanced
 * mode is active.
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
  // Reset lastIndex in case the regex is reused
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
// Patterns
// ---------------------------------------------------------------------------

// Email — RFC 5321 practical subset
const RE_EMAIL = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

// Phone — international formats: +33 6 12 34 56 78, (555) 867-5309, etc.
const RE_PHONE =
  /(?<!\d)(\+?1[\s.\-]?)?(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})(?!\d)|(\+\d{1,3}[\s.\-]?\(?\d+\)?(?:[\s.\-]?\d{2,}){2,})(?!\d)/g;

// Credit/debit card — 13–19 digits, groups of 4, passes Luhn
const RE_CARD = /\b(?:\d[ \-]?){13,19}\b/g;

// IBAN — ISO 13616: country code (2 letters) + 2 check digits + up to 30 alphanumeric
const RE_IBAN = /\b[A-Z]{2}\d{2}[ A-Z0-9]{10,30}\b/g;

// US Social Security Number
const RE_SSN = /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g;

// IPv4
const RE_IPV4 =
  /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;

// IPv6 (abbreviated forms)
const RE_IPV6 = /\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b/g;

// Bitcoin address (legacy P2PKH / P2SH and bech32)
const RE_BTC =
  /\b(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{39,59})\b/g;

// Ethereum address
const RE_ETH = /\b0x[a-fA-F0-9]{40}\b/g;

// Secret keys / tokens — common prefixes that leak credentials.
// Keyword patterns capture the VALUE too (e.g. "Bearer <token>", "password: <value>")
// so the entire secret is replaced, not just the keyword prefix.
const RE_SECRET =
  /(?:^|[\s"'`=:])(?:(?:Bearer)\s+\S{8,}|(?:token|password|passwd|secret|api[_-]?key)[=:\s]+\S{4,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36}|ghs_[A-Za-z0-9]{36}|glpat-[A-Za-z0-9\-]{20,}|eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)/gim;

// Date of birth — contextual: only when near a DOB-related label
const RE_DOB_LABEL =
  /\b(?:dob|date of birth|born|birthday)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})\b/gi;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function detectRegex(text: string): Detection[] {
  const results: Detection[] = [];

  results.push(...findAll(text, new RegExp(RE_EMAIL.source, 'g'), 'EMAIL_ADDRESS'));
  results.push(...findAll(text, new RegExp(RE_PHONE.source, 'g'), 'PHONE_NUMBER'));
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

  // SECRET_KEY: trim leading separator from match
  const secretPattern = new RegExp(RE_SECRET.source, 'gim');
  secretPattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = secretPattern.exec(text)) !== null) {
    const raw = m[0];
    // Trim leading whitespace/quotes/separators so the token covers only the secret value
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

  // DATE_OF_BIRTH — only when preceded by label
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
