/**
 * Layer 1: rule-table detection of structured PII and secrets.
 *
 * Synchronous, no network, always on. Every rule is a pattern plus an optional
 * validator (checksum / shape) and an optional context veto, so ordinary text
 * ("version 1.2.3.4", "12:30:45", "secret santa", a 10-digit order number) does
 * not trigger it. Rules mirror pii_scrub/recognizers.py; keep the two in step.
 *
 * Phones go through libphonenumber-js (real numbering plans) instead of
 * routing a regex by detected language, which missed any phone number written
 * inside a sentence of another language.
 */

import { findPhoneNumbersInText, type CountryCode } from 'libphonenumber-js/max';
import type { Detection } from './types';

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const digitsOf = (s: string) => s.replace(/\D/g, '');

function luhn(num: string): boolean {
  const digits = digitsOf(num);
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** ISO 13616: move first 4 chars to the end, letters → 10..35, mod 97 == 1. */
function validIban(match: string): boolean {
  const raw = match.replace(/\s/g, '').toUpperCase();
  if (raw.length < 15 || raw.length > 34) return false;
  const moved = raw.slice(4) + raw.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const c of v) rem = (rem * 10 + (c.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

/** Swiss AHV/AVS (756.xxxx.xxxx.xx): EAN-13 check digit. */
function validAhv(match: string): boolean {
  const d = digitsOf(match);
  if (d.length !== 13) return false;
  let total = 0;
  for (let i = 0; i < 12; i++) total += (d.charCodeAt(i) - 48) * (i % 2 ? 3 : 1);
  return (10 - (total % 10)) % 10 === d.charCodeAt(12) - 48;
}

/** French NIR: 13 chars + 2-digit key = 97 - (n mod 97). Corsica 2A/2B → 19/18. */
function validNir(match: string): boolean {
  const raw = match.replace(/\s/g, '').toUpperCase();
  let body = raw.slice(0, 13);
  const key = raw.slice(13);
  if (body.slice(5, 7) === '2A') body = body.replace('2A', '19');
  else if (body.slice(5, 7) === '2B') body = body.replace('2B', '18');
  if (!/^\d{13}$/.test(body)) return false;
  return Number(key) === 97 - Number(BigInt(body) % 97n);
}

/** German Steuer-IdNr: 11 digits, ISO 7064 MOD 11,10. */
function validSteuerId(match: string): boolean {
  const d = digitsOf(match);
  if (d.length !== 11 || d[0] === '0') return false;
  let product = 10;
  for (let i = 0; i < 10; i++) {
    let sum = (d.charCodeAt(i) - 48 + product) % 10;
    if (sum === 0) sum = 10;
    product = (2 * sum) % 11;
  }
  const check = 11 - product;
  return d.charCodeAt(10) - 48 === (check === 10 ? 0 : check);
}

const validLuhnDigits = (m: string) => luhn(digitsOf(m));

function shannon(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** A value after `password=` etc. Reject placeholders and degenerate strings. */
function plausibleSecretValue(v: string): boolean {
  if (v.length < 8) return false;
  if (/^(?:x+|\*+|\.+|-+|_+|<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|your[_-].*|example.*|changeme|placeholder.*)$/i.test(v)) {
    return false;
  }
  return shannon(v) >= 2.0;
}

function validIpv4(m: string): boolean {
  const o = m.split('.').map(Number);
  return o.length === 4 && o.every((n) => n >= 0 && n <= 255) && !o.every((n) => n === 0);
}

/** Real IPv6 grammar. Rejects times like 12:30:45 and "a::b" style identifiers. */
function validIpv6(m: string): boolean {
  if ((m.match(/::/g) ?? []).length > 1 || m.includes(':::')) return false;
  const hexDigits = m.replace(/:/g, '');
  if (hexDigits.length < 3 || !/^[0-9a-f]+$/i.test(hexDigits)) return false;
  const groups = m.split(':');
  const compressed = m.includes('::');
  const nonEmpty = groups.filter((g) => g !== '');
  if (nonEmpty.some((g) => g.length > 4)) return false;
  if (compressed) return nonEmpty.length <= 7;
  return groups.length === 8 && groups.every((g) => g.length >= 1);
}

function isPrivateIpv4(m: string): boolean {
  const [a, b] = m.split('.').map(Number) as [number, number];
  return (
    a === 10 || a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

// ---------------------------------------------------------------------------
// Rule table
// ---------------------------------------------------------------------------

interface Rule {
  entity: string;
  /** Needs the `g` and `d` flags when `group` > 0. */
  re: RegExp;
  score?: number;
  validate?: (value: string) => boolean;
  /** Return true to discard the hit (looks at surrounding text). */
  veto?: (text: string, start: number, end: number) => boolean;
  /** Capture group to report (0 = whole match). */
  group?: number;
  /** Override the entity type per hit (e.g. private vs public IP). */
  classify?: (value: string) => string;
}

const before = (text: string, start: number, n = 24) => text.slice(Math.max(0, start - n), start);

const VERSION_CTX = /(?:\b(?:v|ver|version|release|build|rev|revision|python|node|java|go)\s*\.?\s*|\bv)$/i;

const RULES: Rule[] = [
  // --- contact ---------------------------------------------------------------
  {
    entity: 'EMAIL_ADDRESS',
    re: /(?<![\w.+-])[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])/gd,
    score: 0.95,
  },
  // International format in any language (+XX ...). libphonenumber also finds
  // these when valid; this catches fictional/invalid-but-plausible numbers.
  {
    entity: 'PHONE_NUMBER',
    re: /(?<![\w+])\+\d{1,3}(?:[ .\-]?\(?\d{1,4}\)?){2,5}(?![\w])/gd,
    score: 0.7,
    validate: (m) => digitsOf(m).length >= 8 && digitsOf(m).length <= 15,
  },
  // US/CA formatted numbers. Separators or parens are REQUIRED: a bare 10-digit
  // run ("order number 1234567890") is not a phone number.
  {
    entity: 'PHONE_NUMBER',
    re: /(?<![\w+])(?:\(\d{3}\)[ .\-]?\d{3}[ .\-]\d{4}|\d{3}[ .\-]\d{3}[ .\-]\d{4})(?![\w])/gd,
    score: 0.75,
  },

  // --- financial ---------------------------------------------------------------
  {
    entity: 'CREDIT_CARD',
    re: /(?<![\w-])(?:\d[ -]?){12,18}\d(?![\w-])/gd,
    score: 0.95,
    validate: (m) => {
      const d = digitsOf(m);
      return d.length >= 13 && d.length <= 19 && luhn(d);
    },
  },
  {
    entity: 'IBAN_CODE',
    re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/gd,
    score: 0.95,
    validate: validIban,
  },
  { entity: 'SSN', re: /\b(?!000|666|9\d\d)\d{3}[- ](?!00)\d{2}[- ](?!0000)\d{4}\b/gd, score: 0.85 },

  // --- national identifiers ------------------------------------------------------
  {
    entity: 'FR_NIR',
    re: /(?<![\w])[12378] ?\d{2} ?(?:0[1-9]|1[0-2]|[2-9]\d) ?(?:\d{2}|2[AB]) ?\d{3} ?\d{3} ?\d{2}(?![\w])/gid,
    score: 0.95,
    validate: validNir,
  },
  {
    entity: 'CH_AHV',
    re: /(?<![\w.])756[ .\-]?\d{4}[ .\-]?\d{4}[ .\-]?\d{2}(?![\w])/gd,
    score: 0.95,
    validate: validAhv,
  },
  {
    entity: 'FR_SIRET',
    re: /(?<![\w])\d{3} ?\d{3} ?\d{3} ?\d{5}(?![\w])/gd,
    score: 0.85,
    validate: validLuhnDigits,
  },
  {
    entity: 'FR_SIREN',
    re: /\bSIREN\b\W{0,5}(\d{3} ?\d{3} ?\d{3})(?![\w])/gid,
    score: 0.85,
    validate: validLuhnDigits,
    group: 1,
  },
  {
    entity: 'DE_TAX_ID',
    re: /\b(?:Steuer-?ID|Steuer-?Identifikationsnummer|IdNr\.?)[^\d\n]{0,25}?(\d{2} ?\d{3} ?\d{3} ?\d{3})(?![\w])/gid,
    score: 0.85,
    validate: validSteuerId,
    group: 1,
  },
  {
    entity: 'DE_TAX_NUMBER',
    re: /\bSteuernummer[^\d\n]{0,25}?(\d{2,3}\/\d{3}\/\d{4,5}|\d{10,13})(?![\w])/gid,
    score: 0.85,
    group: 1,
  },
  { entity: 'IT_VAT_CODE', re: /(?<![\w])IT ?\d{11}(?![\w])/gd, score: 0.95, validate: validLuhnDigits },
  {
    entity: 'IT_VAT_CODE',
    re: /\b(?:Partita ?IVA|P\.? ?IVA)[^\d\n]{0,15}(\d{11})(?![\w])/gid,
    score: 0.9,
    validate: validLuhnDigits,
    group: 1,
  },

  // --- network -----------------------------------------------------------------
  {
    entity: 'IP_ADDRESS',
    re: /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w]|\.\d)/gd,
    score: 0.8,
    validate: validIpv4,
    veto: (text, start) => VERSION_CTX.test(before(text, start)),
    classify: (v) => (isPrivateIpv4(v) ? 'IP_ADDRESS_PRIVATE' : 'IP_ADDRESS'),
  },
  {
    entity: 'IP_ADDRESS',
    re: /(?<![\w:.])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gid,
    score: 0.8,
    validate: validIpv6,
  },

  // --- crypto ------------------------------------------------------------------
  { entity: 'CRYPTO', re: /\b(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{39,59})\b/gd, score: 0.85 },
  { entity: 'CRYPTO', re: /\b0x[a-fA-F0-9]{40}\b/gd, score: 0.9 },

  // --- secrets (real formats first; generic assignment last) ----------------------
  { entity: 'SECRET_KEY', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]{0,16000}?-----END [A-Z ]*PRIVATE KEY-----/gd, score: 1 },
  { entity: 'SECRET_KEY', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gd, score: 1 },
  { entity: 'SECRET_KEY', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_\w{40,})/gd, score: 1 },
  { entity: 'SECRET_KEY', re: /\bglpat-[A-Za-z0-9_\-]{20,}/gd, score: 1 },
  { entity: 'SECRET_KEY', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/gd, score: 1 },
  { entity: 'SECRET_KEY', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_\-]{20,}/gd, score: 1 },
  { entity: 'SECRET_KEY', re: /\bAIza[0-9A-Za-z_\-]{35}\b/gd, score: 1 },
  { entity: 'SECRET_KEY', re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{20,}/gd, score: 1 },
  { entity: 'SECRET_KEY', re: /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/gd, score: 0.95 },
  { entity: 'SECRET_KEY', re: /\bBearer\s+([A-Za-z0-9._~+/=-]{16,})/gd, score: 0.9, group: 1 },
  // Password in a URL: scheme://user:PASSWORD@host
  // Anchored at the start of the scheme and length-bounded: otherwise a long run of
  // letters is re-scanned from every position (quadratic on pasted blobs).
  { entity: 'SECRET_KEY', re: /(?<![a-z0-9+.\-])[a-z][a-z0-9+.\-]{0,31}:\/\/[^/\s:@]+:([^/\s@]{3,})@/gid, score: 0.97, group: 1 },
  // key = value / key: value. Only the value is reported, only if plausible.
  // "token limit" or "secret santa" have no assignment, so never match.
  {
    entity: 'SECRET_KEY',
    re: /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|token)\b["']?\s*[:=]\s*["']?([^\s"'`,;]{8,})/gid,
    score: 0.9,
    group: 1,
    validate: plausibleSecretValue,
  },

  // --- other ---------------------------------------------------------------------
  {
    entity: 'DATE_OF_BIRTH',
    re: /\b(?:dob|date of birth|born|birthday|date de naissance|geburtsdatum|nato il)[:\s]+(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2})\b/gid,
    score: 0.8,
    group: 1,
  },
];

// ---------------------------------------------------------------------------
// Phones via libphonenumber-js
// ---------------------------------------------------------------------------

const BASE_REGIONS: CountryCode[] = ['CH', 'FR', 'DE', 'GB', 'US', 'IT', 'ES'];
const PHONE_WORDS =
  /(?:tel|t[eé]l[eé]?phone|phone|call|mobile|cell|fax|whatsapp|natel|handy|telefon|rufnummer|appel|appelle|rappel|llama|chiama|telefono|portable|contact)\W{0,12}$/i;

/** Regions to try: the browser's own locales first, then a Western-Europe/US base. */
function phoneRegions(): CountryCode[] {
  const set = new Set<CountryCode>();
  try {
    for (const l of navigator.languages ?? [navigator.language]) {
      const region = l.split('-')[1]?.toUpperCase();
      if (region && /^[A-Z]{2}$/.test(region)) set.add(region as CountryCode);
    }
  } catch { /* no navigator */ }
  for (const r of BASE_REGIONS) set.add(r);
  return [...set];
}

const DATE_LIKE = /^(?:\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[-./]\d{1,2}[-./]\d{2,4})$/;
const DOTTED_QUAD = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function detectPhones(text: string): Detection[] {
  const out = new Map<string, Detection>();
  for (const region of phoneRegions()) {
    let found;
    try {
      found = findPhoneNumbersInText(text, region);
    } catch {
      continue;
    }
    for (const f of found) {
      const value = text.slice(f.startsAt, f.endsAt);
      // A bare digit run ("1234567890") is only a phone if the text says so.
      const bare = /^\d+$/.test(value);
      if (bare && !PHONE_WORDS.test(before(text, f.startsAt, 30))) continue;
      // libphonenumber is lenient about separators: dates and dotted quads
      // ("2024-01-15", "192.168.1.10") are not phone numbers.
      if (DATE_LIKE.test(value) || DOTTED_QUAD.test(value)) continue;
      const key = `${f.startsAt}:${f.endsAt}`;
      if (!out.has(key)) {
        out.set(key, {
          entityType: 'PHONE_NUMBER',
          start: f.startsAt,
          end: f.endsAt,
          score: 0.8,
          value,
          source: 'regex',
        });
      }
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run all regex rules on `text`.
 * The `lang` argument is accepted for API compatibility but no longer routes
 * anything: phone detection is region-based and works for text in any language.
 */
export function detectRegex(text: string, _lang?: string): Detection[] {
  const results: Detection[] = [];

  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags);
    for (const m of text.matchAll(re)) {
      const g = rule.group ?? 0;
      const value = m[g];
      if (!value) continue;
      const span = (m as RegExpMatchArray & { indices?: Array<[number, number]> }).indices?.[g];
      const start = span ? span[0] : m.index! + m[0].indexOf(value);
      const end = start + value.length;
      if (rule.validate && !rule.validate(value)) continue;
      if (rule.veto?.(text, start, end)) continue;
      results.push({
        entityType: rule.classify ? rule.classify(value) : rule.entity,
        start,
        end,
        score: rule.score ?? 0.9,
        value,
        source: 'regex',
      });
    }
  }

  // A span another rule already explains (IP, AVS, NIR, ...) is not also a phone.
  const structured = results.filter((r) => r.entityType !== 'PHONE_NUMBER');
  for (const p of detectPhones(text)) {
    if (!structured.some((r) => p.start < r.end && p.end > r.start)) results.push(p);
  }
  return dedupeExact(results);
}

/** Identical spans reported by several rules: keep one, highest score. */
function dedupeExact(items: Detection[]): Detection[] {
  const best = new Map<string, Detection>();
  for (const d of items) {
    const key = `${d.start}:${d.end}`;
    const cur = best.get(key);
    if (!cur || d.score > cur.score) best.set(key, d);
  }
  return [...best.values()].sort((a, b) => a.start - b.start);
}
