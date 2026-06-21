import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      if (manifest.options_ui) manifest.options_ui.open_in_tab = true;
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
