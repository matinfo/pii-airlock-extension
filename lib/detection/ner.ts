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

/**
 * Raw transformers.js token-classification output. transformers.js has NO
 * aggregation and NO offsets: one item per wordpiece, BIO-tagged, `##`-prefixed
 * continuations. (Captured from the real model; see tests/fixtures/ner-real.ts.)
 */
export interface NerToken {
  entity: string; // 'B-PER' | 'I-PER' | 'B-LOC' | ... | 'O'
  score: number;
  index: number;  // wordpiece position in the sequence
  word: string;   // wordpiece, '##' for continuations
}

/** A merged entity with char offsets into the text that was classified. */
export interface NerEntity {
  entity_group: string; // 'PER' | 'LOC' | 'ORG' | 'MISC'
  score: number;
  start: number;
  end: number;
}

/** A function that runs the model on text and returns raw tokens. */
export type NerRunner = (text: string) => Promise<NerToken[]>;

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
  const pipe = await pipeline('token-classification', MODEL);
  return async (text: string) => (await pipe(text)) as unknown as NerToken[];
}

/**
 * Merge wordpiece tokens into entities with char offsets.
 *
 * Offsets are recovered by walking a cursor through `text` and locating each
 * wordpiece (case-insensitive, `##` stripped) at or after the cursor. A token
 * that cannot be located (e.g. [UNK]) ends the current entity and is skipped.
 * An entity continues on `I-X` of the same type at the next wordpiece index;
 * anything else (B-X, a type change, a gap) starts a new one.
 */
export function mergeTokens(text: string, tokens: NerToken[]): NerEntity[] {
  const lower = text.toLowerCase();
  const out: NerEntity[] = [];
  let cursor = 0;
  let cur: { type: string; start: number; end: number; scores: number[]; index: number } | null = null;
  const flush = () => {
    if (cur) {
      out.push({
        entity_group: cur.type,
        start: cur.start,
        end: cur.end,
        score: cur.scores.reduce((a, b) => a + b, 0) / cur.scores.length,
      });
    }
    cur = null;
  };
  for (const t of tokens) {
    const m = /^([BI])-(.+)$/.exec(t.entity);
    const piece = t.word.startsWith('##') ? t.word.slice(2) : t.word;
    const cont = t.word.startsWith('##');
    // O tokens are not emitted, so a new entity may sit anywhere ahead. A
    // continuation must be (near) adjacent, a word start must start a word.
    let at = -1;
    if (piece) {
      for (let from = cursor; ; ) {
        at = lower.indexOf(piece.toLowerCase(), from);
        if (at < 0 || cont || at === 0 || !/^[\p{L}\p{N}]/u.test(piece) || !/[\p{L}\p{N}]/u.test(text[at - 1]!)) break;
        from = at + 1;
      }
    }
    if (at < 0 || (cont || (cur && t.index === cur.index + 1)) && at - cursor > 8) {
      flush();
      if (at >= 0 && !cont) cursor = at + piece.length;
      continue;
    }
    const end = at + piece.length;
    cursor = end;
    if (!m) { flush(); continue; }
    const [, bi, type] = m;
    if (cur && bi === 'I' && cur.type === type && t.index === cur.index + 1) {
      cur.end = end;
      cur.scores.push(t.score);
      cur.index = t.index;
    } else {
      flush();
      cur = { type, start: at, end, scores: [t.score], index: t.index };
    }
  }
  flush();
  return out;
}

/** ~Window of chars per model call (512 wordpieces ≈ 1.5–2k chars). */
export const CHUNK_CHARS = 1200;
export const CHUNK_OVERLAP = 200;

/** Split into overlapping windows on whitespace; returns [offset, slice] pairs. */
export function chunkText(text: string): Array<[number, string]> {
  if (text.length <= CHUNK_CHARS) return [[0, text]];
  const chunks: Array<[number, string]> = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_CHARS, text.length);
    if (end < text.length) {
      const ws = text.lastIndexOf(' ', end);
      const nl = text.lastIndexOf('\n', end);
      const cut = Math.max(ws, nl);
      if (cut > start + CHUNK_CHARS / 2) end = cut;
    }
    chunks.push([start, text.slice(start, end)]);
    if (end >= text.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
    // Begin the next window at a word boundary so we don't split a name.
    const sp = text.indexOf(' ', start);
    if (sp >= 0 && sp < end) start = sp + 1;
  }
  return chunks;
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
    const out: Detection[] = [];
    for (const [offset, piece] of chunkText(text)) {
      for (const e of mergeTokens(piece, await run(piece))) {
        const entityType = LABEL_MAP[e.entity_group];
        if (!entityType || e.score < MIN_SCORE) continue;
        const start = e.start + offset;
        const end = e.end + offset;
        // Overlapping windows see the same entity twice: keep one.
        if (out.some((o) => o.entityType === entityType && o.start < end && start < o.end)) continue;
        out.push({
          entityType,
          start,
          end,
          score: e.score,
          value: text.slice(start, end),
          source: 'ner',
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}
