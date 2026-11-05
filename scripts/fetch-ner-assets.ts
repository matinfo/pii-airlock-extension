/**
 * Prepare the NER runtime for packaging.
 *
 *   bun run fetch:ner            copy the ORT WASM runtime into public/wasm (packaged)
 *   bun run fetch:ner --model    ALSO download the pinned model into .cache/ner-model
 *                                (dev/e2e only; never under public/, never packaged)
 *
 * The runtime (code) ships in the extension. The model (data) is never packaged:
 * users download it on opt-in. Fails loudly if the runtime files are missing so
 * a build can't ship a NER layer that silently cannot start.
 */
import { mkdir, cp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NER_FILES, nerFileUrl } from '../lib/ner-manifest';
import { sha256 } from '../lib/ner-model';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RUNTIME_FILES = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

export async function copyRuntime(): Promise<void> {
  const src = join(ROOT, 'node_modules/onnxruntime-web/dist');
  const dst = join(ROOT, 'public/wasm');
  await rm(dst, { recursive: true, force: true });
  await mkdir(dst, { recursive: true });
  for (const f of RUNTIME_FILES) {
    if (!existsSync(join(src, f))) throw new Error(`missing ${f} in ${src} (run bun install)`);
    await cp(join(src, f), join(dst, f));
  }
  console.log(`✓ ORT runtime → public/wasm (${RUNTIME_FILES.join(', ')})`);
}

async function fetchModel(): Promise<void> {
  const dir = join(ROOT, '.cache/ner-model');
  for (const f of NER_FILES) {
    const dest = join(dir, f.path);
    if (existsSync(dest) && (await sha256(new Uint8Array(await readFile(dest)))) === f.sha256) {
      console.log(`= ${f.path} (cached)`);
      continue;
    }
    process.stdout.write(`↓ ${f.path} … `);
    const res = await fetch(nerFileUrl(f.path));
    if (!res.ok) throw new Error(`${res.status} ${f.path}`);
    const data = new Uint8Array(await res.arrayBuffer());
    if ((await sha256(data)) !== f.sha256) throw new Error(`checksum mismatch: ${f.path}`);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, data);
    console.log('ok');
  }
}

if (import.meta.main) {
  try {
    await copyRuntime();
    if (process.argv.includes('--model')) await fetchModel();
  } catch (e) {
    console.error('fetch-ner-assets failed:', (e as Error).message);
    process.exit(1);
  }
}
