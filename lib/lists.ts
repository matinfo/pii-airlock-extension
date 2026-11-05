/**
 * User allow / deny lists.
 *   allow: values the user never wants touched ("Always allow").
 *   deny:  values that are always scrubbed, with the entity type they get
 *          ("Always scrub"), found by word-aware literal match.
 *
 * Kept in storage.local (never sync: these are the user's own sensitive values)
 * and loaded into this module by the content script. Pure; no browser APIs.
 */
import type { Detection } from './detection/types';

export interface DenyEntry {
  value: string;
  type: string;
}
export interface Lists {
  allow: string[];
  deny: DenyEntry[];
}

export const EMPTY_LISTS: Lists = { allow: [], deny: [] };
export const MAX_LIST_ENTRIES = 500;

export const MAX_VALUE_LENGTH = 200;

/**
 * Normalise a user-typed list value, or return null if it must be refused:
 * collapses whitespace, needs 2..200 chars and at least one letter or digit.
 * Punctuation-only or one-letter entries would otherwise match (and replace)
 * every "." or standalone "a" in the user's messages.
 */
export function cleanListValue(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.replace(/\s+/g, ' ').trim();
  if (v.length < 2 || v.length > MAX_VALUE_LENGTH) return null;
  return /[\p{L}\p{N}]/u.test(v) ? v : null;
}

let _lists: Lists = EMPTY_LISTS;

const norm = (v: string) => v.normalize('NFKC').trim().toLowerCase();

export function setLists(l: Partial<Lists> | undefined): void {
  _lists = {
    allow: [...new Set((l?.allow ?? []).map((v) => cleanListValue(v)).filter((v): v is string => !!v).map(norm))].slice(0, MAX_LIST_ENTRIES),
    deny: (l?.deny ?? [])
      .filter((e) => e && typeof e.type === 'string' && cleanListValue(e.value))
      .map((e) => ({ type: e.type, value: cleanListValue(e.value)! }))
      .slice(0, MAX_LIST_ENTRIES),
  };
}

export function getLists(): Lists {
  return _lists;
}

const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Literal, word-aware matches of every deny entry. Score 1 so they win overlaps. */
export function denyHits(text: string): Detection[] {
  const out: Detection[] = [];
  for (const e of _lists.deny) {
    const v = e.value.trim();
    const pre = /^[\p{L}\p{N}]/u.test(v) ? '(?<![\\p{L}\\p{N}])' : '';
    const post = /[\p{L}\p{N}]$/u.test(v) ? '(?![\\p{L}\\p{N}])' : '';
    const re = new RegExp(pre + escapeRe(v) + post, 'giu');
    for (const m of text.matchAll(re)) {
      out.push({
        entityType: e.type,
        start: m.index!,
        end: m.index! + m[0].length,
        score: 1,
        value: m[0],
        source: 'regex',
      });
    }
  }
  return out;
}

/** Drop detections whose value the user has allowed. */
export function dropAllowed(detections: Detection[]): Detection[] {
  if (_lists.allow.length === 0) return detections;
  const allowed = new Set(_lists.allow);
  return detections.filter((d) => !allowed.has(norm(d.value)));
}
