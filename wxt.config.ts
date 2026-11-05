import { defineConfig } from 'wxt';
import { existsSync } from 'node:fs';
import { copyRuntime, RUNTIME_FILES } from './scripts/fetch-ner-assets';

/**
 * onnxruntime-web references its own .wasm via `new URL(…, import.meta.url)`,
 * which makes Vite emit a 27 MB copy into the package. We always set
 * `wasmPaths` to the single packaged runtime (public/wasm), so drop those.
 */
const dropOrtWasmAssets = {
  name: 'drop-ort-wasm-assets',
  generateBundle(_: unknown, bundle: Record<string, unknown>) {
    for (const name of Object.keys(bundle)) {
      if (/ort-wasm.*\.wasm$/.test(name)) delete bundle[name];
    }
  },
};

export default defineConfig({
  vite: () => ({ plugins: [dropOrtWasmAssets] }),
  modules: ['@wxt-dev/module-react'],
  hooks: {
    // The ORT WASM runtime is packaged; build fails if it cannot be provided.
    'build:before': async () => {
      if (!RUNTIME_FILES.every((f) => existsSync(`public/wasm/${f}`))) await copyRuntime();
    },
    'build:manifestGenerated': (_wxt, manifest) => {
      if (manifest.options_ui) manifest.options_ui.open_in_tab = true;
      // Firefox needs a stable add-on id (storage, AMO, fixed moz-extension UUID).
      if (manifest.manifest_version === 2) {
        (manifest as Record<string, unknown>).browser_specific_settings = {
          gecko: { id: 'pii-airlock@matinfo.dev' },
        };
      }
      // 'offscreen' is an MV3-only permission (Chrome/Edge). Firefox MV2 hosts
      // the NER model in its persistent background page instead.
      if (manifest.manifest_version === 3) {
        manifest.permissions = [...(manifest.permissions ?? []), 'offscreen'];
        // ESM service worker → Vite code-splits the dynamic transformers import
        // into a chunk that the Chrome background never loads (it forwards to
        // the offscreen doc). Keeps background.js small + kills the
        // import.meta-in-iife warning. (Firefox MV2 background stays iife and
        // inlines transformers — it genuinely hosts the model there.)
        if (manifest.background) {
          (manifest.background as { type?: string }).type = 'module';
        }
      }
    },
  },
  manifest: {
    name: 'PII Airlock',
    description: 'Automatically detects and scrubs PII from AI chat inputs before you send',
    // 'wasm-unsafe-eval' lets the packaged ORT runtime compile its .wasm. No
    // 'unsafe-eval', no remote script sources.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    permissions: ['storage'],
    host_permissions: [
      'https://chatgpt.com/*',
      'https://chat.openai.com/*',
      'https://claude.ai/*',
      'https://gemini.google.com/*',
      'https://copilot.microsoft.com/*',
      'https://perplexity.ai/*',
      'https://poe.com/*',
      'https://character.ai/*',
      'https://mistral.ai/*',
      'https://huggingface.co/*',
      'https://you.com/*',
    ],
    action: {
      default_title: 'PII Airlock',
    },
  },
});
