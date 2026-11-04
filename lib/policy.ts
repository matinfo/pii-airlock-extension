/**
 * Policy engine — maps detected PII entities to risk tiers and decisions.
 *
 * Default policy matrix:
 *
 *   Tier      strict mode     permissive mode
 *   ────────────────────────────────────────
 *   high    → block           auto_scrub
 *   medium  → auto_scrub      warn
 *   low     → warn            notify
 *   none    → allow           allow
 *
 * Users can override the mode in Options (stored in browser.storage.sync).
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

export interface PolicySettings {
  mode: 'strict' | 'permissive';
  /** Per-entity overrides: entityType → decision (overrides matrix) */
  overrides: Record<string, Decision>;
}

export const DEFAULT_SETTINGS: PolicySettings = {
  mode: 'strict',
  overrides: {},
};

let _settings: PolicySettings = DEFAULT_SETTINGS;

export function applySettings(s: Partial<PolicySettings>): void {
  _settings = { ...DEFAULT_SETTINGS, ..._settings, ...s };
}

export function currentSettings(): PolicySettings {
  return _settings;
}

// ---------------------------------------------------------------------------
// Decision matrix
// ---------------------------------------------------------------------------

function decisionFromTier(tier: RiskTier, mode: 'strict' | 'permissive'): Decision {
  if (tier === 'high') return mode === 'strict' ? 'block' : 'auto_scrub';
  if (tier === 'medium') return mode === 'strict' ? 'auto_scrub' : 'warn';
  // low
  return mode === 'strict' ? 'warn' : 'notify';
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
  const override = _settings.overrides[d.entityType];
  if (override) return override;
  if (NOTIFY_ONLY.has(d.entityType)) return 'notify';
  return decisionFromTier(tierOf(d.entityType), _settings.mode);
}

/** True when this detection must be replaced before the text may leave. */
export function mustScrub(d: Detection): boolean {
  const dec = decisionFor(d);
  return dec === 'block' || dec === 'auto_scrub' || dec === 'warn';
}
