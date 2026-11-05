/** Runtime message types shared by content script, background and popup. */
export const MSG = {
  /** content → background: add `count` to the lifetime scrub counter. */
  SCRUBBED: 'PII_SCRUBBED',
  /** content → background: composer found / lost on this page. */
  HEALTH: 'PII_HEALTH',
  /** popup → content: report protection status of this tab. */
  STATUS: 'PII_STATUS',
  /** options → hosts: model installed/removed; drop cached NER state. */
  NER_RESET: 'pii-airlock:ner:reset',
  /** popup → content: wipe in-memory token mapping. */
  PANIC_CLEAR: 'PANIC_CLEAR',
} as const;
