/**
 * Layer 3 — Transformer NER via @huggingface/transformers (ONNX/WASM).
 *
 * Catches what compromise (L2) misses: novel surnames and non-English given
 * names ("Jean", "Élodie", "Dupont-Lachapelle") that have no entry in any
 * lexicon. The model reads grammatical context, not a name list, so it scores
 * PERSON spans ~0.9 — above compromise's 0.75 — and wins the overlap dedupe.
 *
 * Heavy: ~107MB int8 model, ~150–300ms/message on WASM. Runs OUT of the
 * content script (offscreen document on Chrome MV3, background on Firefox).
 * Lazy-loaded on first call; the pipeline is cached for the worker lifetime.
 *
 * Invariant #3 (no network): the host MUST set env.allowRemoteModels=false and
 * env.localModelPath to the bundled models/ dir BEFORE the first detectNer call
 * (see configureNerEnv / the offscreen entrypoint). Model files ship inside the
 * extension; nothing is ever fetched from a remote CDN.
 *
 * Fail-open: any load/inference error returns [] — the regex (L1) and
 * compromise (L2) layers still run. Strict-mode fail-closed is enforced one
 * level up in engine.ts.
 */

import type { Detection } from './types';

/** HuggingFace token-classification output (aggregation_strategy: 'simple'). */
export interface NerEntity {
  entity_group: string; // 'PER' | 'LOC' | 'ORG' | 'MISC'
  score: number;        // 0–1
  word: string;
  start: number | null; // char offset in source text
  end: number | null;   // exclusive char offset
}

/** A function that runs NER on text and returns aggregated entities. */
export type NerRunner = (text: string) => Promise<NerEntity[]>;

const MODEL = 'Xenova/bert-base-multilingual-cased-ner-hrl';

/** Map model labels → our entity-type vocabulary. MISC is intentionally dropped. */
const LABEL_MAP: Record<string, string> = {
  PER: 'PERSON',
  LOC: 'LOCATION',
  ORG: 'ORG',
};

/** Reject low-confidence spans; PERSON typically scores >0.9. */
const MIN_SCORE = 0.5;

let runnerPromise: Promise<NerRunner> | null = null;
let injectedRunner: NerRunner | null = null;
/**
 * Whether a host has pointed transformers at the bundled local model. Until
 * this is true the real pipeline is NEVER built — guarantees no remote fetch
 * (invariant #3) and keeps non-host contexts (tests, content script) as no-ops.
 */
let envConfigured = false;

/**
 * Override the NER runner — used by tests to avoid loading the 107MB model.
 * Pass null to reset back to the real transformers pipeline.
 */
export function __setNerRunner(fn: NerRunner | null): void {
  injectedRunner = fn;
  runnerPromise = null;
}

/**
 * Point transformers at the bundled local model + WASM and forbid remote
 * fetches. MUST be called by the host (offscreen/background) before the first
 * detectNer. Both dirs are extension URLs from browser.runtime.getURL():
 *   - `modelDir`  e.g. getURL('models/')   → ONNX weights + tokenizer
 *   - `wasmDir`   e.g. getURL('wasm/')     → onnxruntime-web .wasm binaries
 *
 * Pinning wasmPaths is REQUIRED: transformers otherwise fetches the ORT WASM
 * from a CDN, which would breach invariant #3 (no network).
 */
export async function configureNerEnv(modelDir: string, wasmDir: string): Promise<void> {
  const { env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = modelDir;
  if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.wasmPaths = wasmDir;
  envConfigured = true;
}

async function buildDefaultRunner(): Promise<NerRunner> {
  const { pipeline } = await import('@huggingface/transformers');
  const pipe = await pipeline('token-classification', MODEL, {
    // @ts-expect-error aggregation_strategy is valid for token-classification
    aggregation_strategy: 'simple',
  });
  return async (text: string) => (await pipe(text)) as unknown as NerEntity[];
}

/** Null when no runner is available (env not configured, no test injection). */
function getRunner(): Promise<NerRunner> | null {
  if (injectedRunner) return Promise.resolve(injectedRunner);
  if (!envConfigured) return null;
  if (!runnerPromise) runnerPromise = buildDefaultRunner();
  return runnerPromise;
}

/**
 * Run transformer NER on `text`. Returns PERSON/LOCATION/ORG detections with
 * exact char offsets from the tokenizer. The model is multilingual, so unlike
 * compromise we do not gate on script — `lang` is accepted for signature
 * parity and future routing only.
 *
 * Never throws: on any error returns [] (fail-open).
 */
export async function detectNer(text: string, _lang: string): Promise<Detection[]> {
  if (!text.trim()) return [];
  try {
    const runner = getRunner();
    if (!runner) return []; // no model configured in this context — no-op
    const run = await runner;
    const entities = await run(text);
    const out: Detection[] = [];
    for (const e of entities) {
      const entityType = LABEL_MAP[e.entity_group];
      if (!entityType) continue;
      if (e.score < MIN_SCORE) continue;
      if (e.start == null || e.end == null || e.end <= e.start) continue;
      out.push({
        entityType,
        start: e.start,
        end: e.end,
        score: e.score,
        value: text.slice(e.start, e.end),
        source: 'ner',
      });
    }
    return out;
  } catch {
    return [];
  }
}
