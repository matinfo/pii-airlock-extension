/**
 * i18n: browser.i18n with an English fallback bundled from the `en` catalogue,
 * so unit tests (no browser APIs) and missing keys still render real text.
 */
import en from '../public/_locales/en/messages.json';

type Catalogue = Record<
  string,
  { message: string; placeholders?: Record<string, { content: string }> }
>;
const EN = en as Catalogue;

function api(): { getMessage?: (k: string, s?: string | string[]) => string } | undefined {
  const g = globalThis as { browser?: { i18n?: unknown }; chrome?: { i18n?: unknown } };
  return (g.browser?.i18n ?? g.chrome?.i18n) as ReturnType<typeof api>;
}

/** Translate `key`. `subs` fill $1.. placeholders in order. */
export function t(key: string, subs?: string | number | Array<string | number>): string {
  const list = subs === undefined ? [] : (Array.isArray(subs) ? subs : [subs]).map(String);
  try {
    const got = api()?.getMessage?.(key, list);
    if (got) return got;
  } catch { /* fall through to the bundled catalogue */ }
  const entry = EN[key];
  if (!entry) return key;
  let msg = entry.message;
  for (const [name, ph] of Object.entries(entry.placeholders ?? {})) {
    const idx = Number(/^\$(\d)$/.exec(ph.content)?.[1] ?? 0) - 1;
    msg = msg.replaceAll(`$${name}$`, list[idx] ?? '');
  }
  return msg;
}

/** Friendly label for an entity type, e.g. EMAIL_ADDRESS → "Email address". */
export function entityLabel(type: string): string {
  const key = `ent_${type}`;
  const got = t(key);
  if (got !== key) return got;
  return type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, ' ');
}
