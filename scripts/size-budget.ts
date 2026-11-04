/**
 * Fails when a built extension exceeds its size budget.
 * The NER model is never packaged (fetched opt-in), so the base package must stay small.
 * Phase 0 budget is loose because the model is still bundled when present locally;
 * CI builds without it. Tighten to 5 MB once Phase 3 lands.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BUDGET_MB = Number(process.env.SIZE_BUDGET_MB ?? 5);

function dirSize(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    total += s.isDirectory() ? dirSize(p) : s.size;
  }
  return total;
}

let failed = false;
for (const target of ['chrome-mv3', 'firefox-mv2']) {
  const dir = join('.output', target);
  try {
    const mb = dirSize(dir) / 1024 / 1024;
    const ok = mb <= BUDGET_MB;
    console.log(`${target}: ${mb.toFixed(2)} MB (budget ${BUDGET_MB} MB) ${ok ? 'ok' : 'OVER'}`);
    if (!ok) failed = true;
  } catch {
    console.log(`${target}: not built, skipped`);
  }
}
process.exit(failed ? 1 : 0);
