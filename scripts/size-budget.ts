/**
 * Fails when a built extension exceeds its size budget.
 * The NER model is never packaged (fetched opt-in), so the base package must stay small.
 * Measured as the sum of per-file gzip sizes, which approximates the store zip
 * (the packaged ORT .wasm is ~14 MB raw but ~3.7 MB compressed).
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_MB = Number(process.env.SIZE_BUDGET_MB ?? 5);

function dirSize(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    total += s.isDirectory() ? dirSize(p) : gzipSync(readFileSync(p)).length;
  }
  return total;
}

let failed = false;
for (const target of ['chrome-mv3', 'firefox-mv2']) {
  const dir = join('.output', target);
  try {
    const mb = dirSize(dir) / 1024 / 1024;
    const ok = mb <= BUDGET_MB;
    console.log(`${target}: ${mb.toFixed(2)} MB gzipped (budget ${BUDGET_MB} MB) ${ok ? 'ok' : 'OVER'}`);
    if (!ok) failed = true;
  } catch {
    console.log(`${target}: not built, skipped`);
  }
}
process.exit(failed ? 1 : 0);
