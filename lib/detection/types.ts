/** Shared types for the PII detection pipeline. */

/** A single detected PII span in source text. */
export interface Detection {
  entityType: string;   // e.g. 'EMAIL_ADDRESS', 'PERSON'
  start: number;        // char offset in source text
  end: number;          // exclusive char offset
  score: number;        // 0–1 confidence
  value: string;        // the matched text slice
  source: 'regex' | 'nlp';
}

/** Risk classification of a detected entity. */
export type RiskTier = 'high' | 'medium' | 'low';

/** Policy decision for a given send attempt. */
export type Decision = 'allow' | 'notify' | 'warn' | 'auto_scrub' | 'block';

/** Result of running the full detection engine on a string. */
export interface DetectionResult {
  detections: Detection[];
  topTier: RiskTier | null;   // highest tier found, or null if nothing found
  decision: Decision;          // computed by policy engine
}

/** A stable token replacing a PII span, e.g. "<EMAIL_ADDRESS_1>". */
export type Token = string;
