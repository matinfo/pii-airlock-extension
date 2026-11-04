/**
 * Download the bundled NER model + onnxruntime WASM into public/ so the
 * extension runs fully offline (invariant #3 — no remote model/WASM fetch).
 *
 * Run once before building:  bun run fetch:ner
 *
 * Outputs:
 *   public/models/Xenova/bert-base-multilingual-cased-ner-hrl/...  (ONNX + tokenizer)
 *   public/wasm/ort-wasm-simd-threaded.jsep.wasm  (+ siblings)
 *
 * The model dir layout MUST match what transformers expects from
 * env.localModelPath: <localModelPath>/<modelId>/onnx/model_quantized.onnx etc.
 */

import { mkdir, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_ID = 'Xenova/bert-base-multilingual-cased-ner-hrl';
const HF_BASE = `https://huggingface.co/${MODEL_ID}/resolve/main`;

// Quantized (int8) files keep the bundle ~107MB instead of ~700MB.
const MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model_quantized.onnx',
];

async function get(remotePath: string, dest: string): Promise<void> {
  const url = `${HF_BASE}/${remotePath}`;
  process.stdout.write(`↓ ${remotePath} … `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await mkdir(dirname(dest), { recursive: true });
  await Bun.write(dest, res);
  console.log('ok');
}

async function copyWasm(): Promise<void> {
  // onnxruntime-web ships the .wasm binaries inside the transformers package.
  const src = join(ROOT, 'node_modules/@huggingface/transformers/dist');
  const dst = join(ROOT, 'public/wasm');
  if (!existsSync(src)) throw new Error(`transformers dist not found at ${src}`);
  await rm(dst, { recursive: true, force: true });
  await mkdir(dst, { recursive: true });
  // Copy every .wasm + the matching .mjs glue files.
  const glob = new Bun.Glob('*.{wasm,mjs}');
  for await (const f of glob.scan({ cwd: src })) {
    await cp(join(src, f), join(dst, f));
  }
  console.log(`✓ wasm → public/wasm`);
}

async function main() {
  const modelDir = join(ROOT, 'public/models', MODEL_ID);
  for (const f of MODEL_FILES) await get(f, join(modelDir, f));
  await copyWasm();
  console.log('\nNER assets ready. Build will bundle public/ into the extension.');
}

main().catch((e) => {
  console.error('\nfetch-ner-assets failed:', e.message);
  process.exit(1);
});
