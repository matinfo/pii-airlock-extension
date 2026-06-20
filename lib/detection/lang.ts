/**
 * Layer 1.5 — Language detection via franc-min.
 *
 * Detects the dominant language of a text snippet and returns a BCP-47
 * language code (e.g. "en", "fr", "de"). Used to route phone number and
 * date patterns to locale-specific variants.
 *
 * franc-min covers ~82 languages with a ~85KB bundle footprint.
 */

import { franc } from 'franc-min';

const SUPPORTED = new Set(['en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'ja', 'zh']);

/**
 * Detect language of `text`. Returns a BCP-47 code or "en" as fallback.
 * Falls back to `navigator.language` if franc is uncertain (score < threshold).
 */
export function detectLanguage(text: string): string {
  if (!text || text.trim().length < 10) {
    return navigatorLang();
  }

  try {
    const detected = franc(text, { minLength: 10 });
    // franc returns ISO 639-3; map common ones to BCP-47
    const mapped = iso3ToBcp47(detected);
    return SUPPORTED.has(mapped) ? mapped : navigatorLang();
  } catch {
    return navigatorLang();
  }
}

function navigatorLang(): string {
  try {
    const lang = navigator.language?.split('-')[0] ?? 'en';
    return SUPPORTED.has(lang) ? lang : 'en';
  } catch {
    return 'en';
  }
}

const ISO3_MAP: Record<string, string> = {
  eng: 'en', fra: 'fr', deu: 'de', spa: 'es', ita: 'it',
  por: 'pt', nld: 'nl', pol: 'pl', rus: 'ru', jpn: 'ja',
  cmn: 'zh', zho: 'zh',
};

function iso3ToBcp47(code: string): string {
  return ISO3_MAP[code] ?? code.slice(0, 2);
}
