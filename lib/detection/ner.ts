/**
 * Layer 3 — Transformer NER via @huggingface/transformers (ONNX/WASM).
 *
 * Catches what compromise (L2) misses: novel surnames and non-English given
 * names ("Jean", "Élodie", "Dupont-Lachapelle") that have no entry in any
 * lexicon. The model reads grammatical context, not a name list, so it scores
 * PERSON spans ~0.9 — above compromise's 0.75 — and wins the overlap dedupe.
 *
 * Heavy: ~170 MB int8 model, ~150–300ms/message on WASM. Runs OUT of the
 * content script (offscreen document on Chrome MV3, background on Firefox).
 * Lazy-loaded on first call; the pipeline is cached for the worker lifetime.
 *
 * Opt-in: the model is not packaged. It is downloaded by the user's explicit
 * choice (lib/ner-model.ts) and until then this layer is a silent no-op.
 * Invariant #3: text never leaves the device; see configureNerEnv.
 *
 * Fail-open: any load/inference error returns [] — the regex (L1) and
 * compromise (L2) layers still run. Strict-mode fail-closed is enforced one
 * level up in engine.ts.
 */

import type { Detection } from './types';
import { NER_MODEL_ID } from '../ner-manifest';

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

const MODEL = NER_MODEL_ID;

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
 * Whether a host has configured transformers (cache-only, no network). Until
 * this is true the real pipeline is NEVER built, which keeps non-host contexts
 * (tests, content script) as no-ops.
 */
let envConfigured = false;

/**
 * Override the NER runner — used by tests to avoid loading the model.
 * Pass null to reset back to the real transformers pipeline.
 */
export function __setNerRunner(fn: NerRunner | null): void {
  injectedRunner = fn;
  runnerPromise = null;
}

/**
 * Point transformers at the user-installed model + packaged WASM runtime.
 *
 * Invariant #3 (reworded): the user's TEXT never leaves the device. The model
 * file is the only thing ever fetched, once, by explicit opt-in, from a pinned
 * revision with SHA-256 verification (lib/ner-model.ts). Inside the pipeline all
 * network access is disabled: the model is served from the verified Cache API
 * store and `env.fetch` rejects, so a cache miss fails open instead of
 * reaching out. `wasm` URLs are extension URLs for the PACKAGED ORT runtime.
 */
export async function configureNerEnv(wasm: { mjs: string; wasm: string }): Promise<void> {
  const { env } = await import('@huggingface/transformers');
  const { makeModelCache } = await import('../ner-model');
  // transformers refuses to start with both disabled. Remote stays "allowed"
  // only on paper: the cache answers first and env.fetch below can never succeed.
  env.allowRemoteModels = true;
  env.allowLocalModels = false;
  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.customCache = makeModelCache();
  env.fetch = () => Promise.reject(new Error('network disabled for NER'));
  // The runtime is packaged and loaded straight from its extension URLs. The
  // default "pre-load into cache" step would go through env.fetch above, fail,
  // and log a scary (but harmless) warning on every start.
  env.useWasmCache = false;
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = wasm;
    env.backends.onnx.wasm.numThreads = 1; // no cross-origin isolation in extensions
  }
  envConfigured = true;
}

async function buildDefaultRunner(): Promise<NerRunner> {
  const { pipeline } = await import('@huggingface/transformers');
  const pipe = await pipeline('token-classification', MODEL, { device: 'wasm', dtype: 'q8' });
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
    // The model sometimes tags a hyphen/apostrophe inside a name as O, so the
    // wordpiece index skips one. Bridge that only across a bare connector.
    const bridged =
      cur !== null && t.index === cur.index + 2 && /^[-'’.]$/.test(text.slice(cur.end, at));
    if (cur && bi === 'I' && cur.type === type && (t.index === cur.index + 1 || bridged)) {
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

/** Last failure message, for diagnostics (never contains user text). */
export let lastNerError: string | null = null;

let installedAt = 0;
let installed = false;
/** Cheap gate so an un-downloaded model costs one cache lookup per few seconds. */
async function modelInstalled(): Promise<boolean> {
  if (installed) return true;
  if (Date.now() - installedAt < 3000) return false;
  installedAt = Date.now();
  const { isInstalled } = await import('../ner-model');
  installed = await isInstalled();
  return installed;
}

/** Forget the cached install state (after download or removal). */
export function resetNerState(): void {
  installed = false;
  installedAt = 0;
  runnerPromise = null;
}

/** Null when no runner is available (env not configured, no test injection). */
function getRunner(): Promise<NerRunner> | null {
  if (injectedRunner) return Promise.resolve(injectedRunner);
  if (!envConfigured) return null;
  if (!runnerPromise) {
    runnerPromise = buildDefaultRunner();
    // Don't cache a failure: the user may install the model later.
    runnerPromise.catch(() => { runnerPromise = null; });
  }
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
    if (!injectedRunner && !(envConfigured && (await modelInstalled()))) return [];
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
    lastNerError = null;
    return out;
  } catch (e) {
    lastNerError = e instanceof Error ? e.message : String(e);
    console.warn('[pii-airlock] names model unavailable:', e);
    return [];
  }
}
