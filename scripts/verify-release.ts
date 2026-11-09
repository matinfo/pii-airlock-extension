/**
 * Release gate. Usage: bun scripts/verify-release.ts [vX.Y.Z]
 * - tag (if given) must equal package.json version
 * - every built manifest (.output/*) must carry that version
 * - Firefox keeps its gecko id; MV3 builds keep the CSP + https-only hosts
 * - no permission outside the allow-list (new permission = store re-review + user warning)
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const tag = process.argv[2];
const errors: string[] = [];

if (tag && tag.replace(/^v/, '') !== pkg.version) {
  errors.push(`tag ${tag} != package.json version ${pkg.version}`);
}

const ALLOWED_PERMS = new Set(['storage', 'offscreen', 'scripting']);
const targets = ['chrome-mv3', 'edge-mv3', 'firefox-mv2'];

for (const t of targets) {
  const path = `.output/${t}/manifest.json`;
  if (!existsSync(path)) {
    errors.push(`${t}: missing ${path}`);
    continue;
  }
  const m = JSON.parse(readFileSync(path, 'utf8'));
  if (m.version !== pkg.version) errors.push(`${t}: manifest version ${m.version} != ${pkg.version}`);
  // MV2 lists host patterns inside `permissions`; split them out.
  for (const p of m.permissions ?? []) {
    if (!p.includes('://') && !ALLOWED_PERMS.has(p)) errors.push(`${t}: unexpected permission "${p}"`);
  }
  const hosts: string[] = m.host_permissions ?? m.permissions?.filter((p: string) => p.includes('://')) ?? [];
  for (const h of hosts) if (!h.startsWith('https://')) errors.push(`${t}: non-https host ${h}`);
  for (const cs of m.content_scripts ?? [])
    for (const h of cs.matches ?? []) if (!h.startsWith('https://')) errors.push(`${t}: non-https match ${h}`);
  const csp = JSON.stringify(m.content_security_policy ?? '');
  if (/unsafe-eval(?!')/.test(csp.replace(/wasm-unsafe-eval/g, '')) || /https?:\/\//.test(csp))
    errors.push(`${t}: CSP allows eval or remote sources`);
  if (t === 'firefox-mv2' && !m.browser_specific_settings?.gecko?.id) errors.push(`${t}: gecko id missing`);
}

// No model weights or maps may ship in any package.
for (const t of targets) {
  const dir = `.output/${t}`;
  if (!existsSync(dir)) continue;
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`],
    );
  for (const f of walk(dir)) if (/\.(onnx|map)$/.test(f)) errors.push(`${t}: forbidden file ${f}`);
}

if (errors.length) {
  console.error(errors.map((e) => `FAIL ${e}`).join('\n'));
  process.exit(1);
}
console.log(`release gate ok (v${pkg.version})`);
