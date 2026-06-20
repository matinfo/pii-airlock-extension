/**
 * Adapter registry — resolves the best adapter for the current page hostname.
 */

import type { ChatAdapter } from './types';
import { chatgptAdapter } from './chatgpt';
import { claudeAdapter } from './claude';
import { geminiAdapter } from './gemini';
import { copilotAdapter } from './copilot';
import { perplexityAdapter } from './perplexity';
import { genericAdapter } from './generic';

const NAMED: Array<{ hosts: string[]; adapter: ChatAdapter }> = [
  { hosts: ['chatgpt.com', 'chat.openai.com'], adapter: chatgptAdapter },
  { hosts: ['claude.ai'], adapter: claudeAdapter },
  { hosts: ['gemini.google.com'], adapter: geminiAdapter },
  { hosts: ['copilot.microsoft.com'], adapter: copilotAdapter },
  { hosts: ['perplexity.ai'], adapter: perplexityAdapter },
];

/** Return the best adapter for the current page. Never returns null. */
export function resolveAdapter(): ChatAdapter {
  const host = location.hostname;
  for (const { hosts, adapter } of NAMED) {
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      return adapter;
    }
  }
  return genericAdapter;
}
