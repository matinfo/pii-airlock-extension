/**
 * Policy engine — maps detected PII entities to decisions.
 *
 * Modes:
 *   auto    (default)  structured data + names are replaced silently; places,
 *                      organisations and private IPs are only noticed.
 *   review             the same set is shown in a panel before sending.
 *   off                nothing is checked.
 *
 * Per-entity overrides (Options) win over the mode. Per-site off and a timed
 * pause live here too, so every caller asks one place whether to act at all.
 */

import type { Detection, Decision, RiskTier } from './detection/types';

// ---------------------------------------------------------------------------
// Entity → risk tier mapping
// ---------------------------------------------------------------------------

const HIGH_RISK = new Set([
  'EMAIL_ADDRESS',
  'PHONE_NUMBER',
  'CREDIT_CARD',
  'IBAN_CODE',
  'SSN',
  'IP_ADDRESS',
  'CRYPTO',
  'SECRET_KEY',
  'FR_NIR',
  'CH_AHV',
  'FR_SIRET',
  'FR_SIREN',
  'DE_TAX_ID',
  'DE_TAX_NUMBER',
  'IT_VAT_CODE',
]);

/** Medium tier = names/places/orgs (kept for the options table). */
const MEDIUM_RISK = new Set(['PERSON', 'LOCATION', 'ORG']);

const LOW_RISK = new Set(['DATE_OF_BIRTH', 'IP_ADDRESS_PRIVATE']);

/**
 * Entities that are informational only by default: far too common in ordinary
 * prose ("capital of France", "compare Google and Microsoft") to rewrite or
 * interrupt. Users can still force a decision with a per-entity override.
 */
const NOTIFY_ONLY = new Set(['LOCATION', 'ORG', 'IP_ADDRESS_PRIVATE']);
/** Subset of NOTIFY_ONLY that shows no notice at all. */
const QUIET = new Set(['LOCATION', 'ORG']);

export function isQuiet(entityType: string): boolean {
  return QUIET.has(entityType);
}

export function tierOf(entityType: string): RiskTier {
  if (HIGH_RISK.has(entityType)) return 'high';
  if (MEDIUM_RISK.has(entityType)) return 'medium';
  if (LOW_RISK.has(entityType)) return 'low';
  // Unknown entity types default to medium (conservative)
  return 'medium';
}

// ---------------------------------------------------------------------------
// Settings (read from storage; defaults applied here)
// ---------------------------------------------------------------------------

export type Mode = 'auto' | 'review' | 'off';

export interface PolicySettings {
  mode: Mode;
  /** Per-entity overrides: entityType → decision (wins over the mode). */
  overrides: Record<string, Decision>;
  /** This site is switched off by the user. */
  siteOff: boolean;
  /** Epoch ms until which protection is paused (0 = not paused). */
  pausedUntil: number;
}

export const DEFAULT_SETTINGS: PolicySettings = {
  mode: 'auto',
  overrides: {},
  siteOff: false,
  pausedUntil: 0,
};

let _settings: PolicySettings = DEFAULT_SETTINGS;

/** Accepts the pre-1.0 `strict` / `permissive` values and maps them to `auto`. */
function normalizeMode(m: unknown): Mode {
  return m === 'review' || m === 'off' ? m : 'auto';
}

export function applySettings(s: Partial<Omit<PolicySettings, 'mode'>> & { mode?: string }): void {
  const next = { ..._settings, ...s } as PolicySettings;
  next.mode = normalizeMode(s.mode ?? _settings.mode);
  _settings = next;
}

export function currentSettings(): PolicySettings {
  return _settings;
}

/** False when protection is off, switched off for this site, or paused. */
export function isActive(now: number = Date.now()): boolean {
  return _settings.mode !== 'off' && !_settings.siteOff && now >= _settings.pausedUntil;
}

// ---------------------------------------------------------------------------
// Decision matrix
// ---------------------------------------------------------------------------

function decisionFromMode(mode: Mode): Decision {
  if (mode === 'off') return 'allow';
  return mode === 'review' ? 'warn' : 'auto_scrub';
}

/**
 * Compute the overall policy decision for a set of detections.
 * Returns the most restrictive decision across all detected entities.
 */
export function getDecision(detections: Detection[]): Decision {
  if (detections.length === 0) return 'allow';

  const order: Decision[] = ['block', 'auto_scrub', 'warn', 'notify', 'allow'];
  let worst: Decision = 'allow';

  for (const d of detections) {
    const decision = decisionFor(d);
    if (order.indexOf(decision) < order.indexOf(worst)) {
      worst = decision;
    }
  }

  return worst;
}

/** Decision for a single detection (override, else tier × mode). */
export function decisionFor(d: Detection): Decision {
  if (_settings.mode === 'off') return 'allow';
  const override = _settings.overrides[d.entityType];
  if (override) return override;
  if (NOTIFY_ONLY.has(d.entityType)) return 'notify';
  return decisionFromMode(_settings.mode);
}

/** True when this detection must be replaced before the text may leave. */
export function mustScrub(d: Detection): boolean {
  const dec = decisionFor(d);
  return dec === 'block' || dec === 'auto_scrub' || dec === 'warn';
}
