/**
 * BrowserMapping — in-memory reversible PII token store.
 *
 * Identical semantics to pii_scrub/mapping.py:
 *   - deterministic: same (entityType, value) always produces same token
 *   - stable token format: <ENTITY_TYPE_N>
 *   - restore() replaces all known tokens back to original values
 *
 * Never written to chrome.storage or any persistent medium.
 * One instance per content-script context (i.e. per page session).
 * Cleared on page unload or explicit panic-clear from popup.
 */

const TOKEN_RE = /<([A-Z][A-Z0-9_]*)_(\d+)>/g;

export class BrowserMapping {
  private valueToToken = new Map<string, string>(); // "john@x.com" → "<EMAIL_ADDRESS_1>"
  private tokenToValue = new Map<string, string>(); // "<EMAIL_ADDRESS_1>" → "john@x.com"
  private counters = new Map<string, number>();       // "EMAIL_ADDRESS" → 1

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
    return token;
  }

  /** Replace every known token in `text` with its original value. */
  restore(text: string): string {
    return text.replace(TOKEN_RE, (match) => this.tokenToValue.get(match) ?? match);
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
  }
}
