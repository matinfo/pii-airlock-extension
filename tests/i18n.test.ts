import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { t, entityLabel } from '../lib/i18n';

const load = (l: string) => JSON.parse(readFileSync(`public/_locales/${l}/messages.json`, 'utf8')) as Record<string, { message: string; placeholders?: object }>;
const en = load('en');

describe('i18n catalogues', () => {
  for (const lang of ['fr', 'de']) {
    it(`${lang} has exactly the same keys and placeholders as en`, () => {
      const c = load(lang);
      expect(Object.keys(c).sort()).toEqual(Object.keys(en).sort());
      for (const k of Object.keys(en)) {
        expect(Object.keys(c[k]!.placeholders ?? {}).sort()).toEqual(Object.keys(en[k]!.placeholders ?? {}).sort());
        expect(c[k]!.message.trim()).not.toBe('');
      }
    });
  }

  it('every t("key") used in source exists in en', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
      }
    };
    ['lib', 'entrypoints'].forEach(walk);
    const missing: string[] = [];
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\bt\(\s*["'`]([A-Za-z_]+)["'`]/g)) {
        if (!en[m[1]!]) missing.push(`${f}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('t() substitutes placeholders in the fallback catalogue', () => {
    expect(t('toastMany', 3)).toBe('3 items replaced');
    expect(t('popPaused', '10:30')).toBe('Paused until 10:30');
  });

  it('entityLabel falls back to a readable name for unknown types', () => {
    expect(entityLabel('EMAIL_ADDRESS')).toBe('Email address');
    expect(entityLabel('SOME_NEW_THING')).toBe('Some new thing');
  });
});
