/**
 * BrowserMapping — in-memory reversible PII token store.
 *
 * Identical semantics to pii_scrub/mapping.py:
 *   - deterministic: same (entityType, value) always produces same token
 *   - stable token format: <ENTITY_TYPE_N>
 *   - restore() replaces all known tokens back to original values
 *
 * Lives in the content script's memory. The only copy kept elsewhere is
 * `storage.session` (RAM, dropped when the browser closes), saved per tab via the
 * background so a page reload does not renumber tokens. Never storage.local/sync.
 * Cleared on explicit panic-clear from the popup.
 */

// Models often echo `<PERSON_1>` as `[PERSON_1]`, so both bracket styles are
// accepted on the way back; lookup always uses the canonical `<…>` form.
const TOKEN_RE = /<([A-Z][A-Z0-9_]*_\d+)>|\[([A-Z][A-Z0-9_]*_\d+)\]/g;

export class BrowserMapping {
  private valueToToken = new Map<string, string>(); // "john@x.com" → "<EMAIL_ADDRESS_1>"
  private tokenToValue = new Map<string, string>(); // "<EMAIL_ADDRESS_1>" → "john@x.com"
  private counters = new Map<string, number>();       // "EMAIL_ADDRESS" → 1

  /** Fired after the mapping changed (new token, import or clear). */
  onChange?: () => void;

  /** Return existing token for (type, value), or mint a new one. */
  tokenFor(entityType: string, value: string): string {
    const key = `${entityType}||${value}`;
    const existing = this.valueToToken.get(key);
    if (existing !== undefined) return existing;

    const idx = (this.counters.get(entityType) ?? 0) + 1;
    this.counters.set(entityType, idx);
    const token = `<${entityType}_${idx}>`;
    this.valueToToken.set(key, token);
    this.tokenToValue.set(token, value);
    this.onChange?.();
    return token;
  }

  /** Original value for a known token, else undefined. */
  valueOf(token: string): string | undefined {
    return this.tokenToValue.get(token);
  }

  /** Snapshot as [type, value, token] triples, for persistence. */
  entries(): Array<[string, string, string]> {
    const out: Array<[string, string, string]> = [];
    for (const [key, token] of this.valueToToken) {
      const i = key.indexOf('||');
      out.push([key.slice(0, i), key.slice(i + 2), token]);
    }
    return out;
  }

  /** Merge a saved snapshot. Tokens minted locally win; counters move past imports. */
  load(entries: Array<[string, string, string]>): void {
    for (const [type, value, token] of entries) {
      const key = `${type}||${value}`;
      if (this.valueToToken.has(key) || this.tokenToValue.has(token)) continue;
      this.valueToToken.set(key, token);
      this.tokenToValue.set(token, value);
      const n = Number(/_(\d+)>$/.exec(token)?.[1]);
      if (n > (this.counters.get(type) ?? 0)) this.counters.set(type, n);
    }
  }

  /** Replace every known token in `text` with its original value. */
  restore(text: string): string {
    return text.replace(TOKEN_RE, (match, angle?: string, square?: string) =>
      this.tokenToValue.get(`<${angle ?? square}>`) ?? match);
  }

  /**
   * Scrub `text`: replace all detected spans with tokens.
   * Tokens are assigned in left-to-right text order so numbering is predictable
   * (e.g. first email → EMAIL_ADDRESS_1, second → EMAIL_ADDRESS_2).
   * Replacement is done right-to-left to preserve char offsets.
   */
  scrub(text: string, detections: import('./detection/types').Detection[]): string {
    const sorted = [...detections].sort((a, b) => a.start - b.start);
    // Pre-assign tokens left-to-right so numbers match text order
    for (const d of sorted) this.tokenFor(d.entityType, d.value);
    // Replace right-to-left to keep earlier offsets valid
    let out = text;
    for (const d of [...sorted].reverse()) {
      const token = this.tokenFor(d.entityType, d.value);
      out = out.slice(0, d.start) + token + out.slice(d.end);
    }
    return out;
  }

  get size(): number {
    return this.tokenToValue.size;
  }

  clear(): void {
    this.valueToToken.clear();
    this.tokenToValue.clear();
    this.counters.clear();
    this.onChange?.();
  }
}
