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
]);

const MEDIUM_RISK = new Set(['PERSON', 'LOCATION', 'ORG']);

const LOW_RISK = new Set(['DATE_OF_BIRTH']);

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
    const override = _settings.overrides[d.entityType];
    const decision = override ?? decisionFromTier(tierOf(d.entityType), _settings.mode);
    if (order.indexOf(decision) < order.indexOf(worst)) {
      worst = decision;
    }
  }

  return worst;
}
