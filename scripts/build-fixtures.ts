import { mkdirSync } from 'node:fs';
export async function buildFixtures(): Promise<string> {
  mkdirSync('e2e/.dist', { recursive: true });
  const r = await Bun.build({
    entrypoints: ['e2e/fixtures/pm-app.ts'],
    outdir: 'e2e/.dist',
    target: 'browser',
  });
  if (!r.success) throw new Error(r.logs.join('\n'));
  return 'e2e/.dist/pm-app.js';
}

if (import.meta.main) console.log('built', await buildFixtures());
