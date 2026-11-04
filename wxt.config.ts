import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      if (manifest.options_ui) manifest.options_ui.open_in_tab = true;
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
    permissions: ['storage', 'tabs'],
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
