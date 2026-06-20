import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'PII Airlock',
    description: 'Automatically detects and scrubs PII from AI chat inputs before you send',
    action: {
      default_title: 'PII Airlock',
    },
  },
});
