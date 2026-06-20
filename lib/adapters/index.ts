/**
 * Adapter registry — resolves the best adapter for the current page hostname.
 */

import type { ChatAdapter } from './types';
import { chatgptAdapter } from './chatgpt';
import { claudeAdapter } from './claude';
import { geminiAdapter } from './gemini';
import { copilotAdapter } from './copilot';
import { perplexityAdapter } from './perplexity';
import { poeAdapter } from './poe';
import { characterAdapter } from './character';
import { mistralAdapter } from './mistral';
import { huggingfaceAdapter } from './huggingface';
import { youAdapter } from './you';
import { genericAdapter } from './generic';

const NAMED: Array<{ hosts: string[]; adapter: ChatAdapter }> = [
  { hosts: ['chatgpt.com', 'chat.openai.com'], adapter: chatgptAdapter },
  { hosts: ['claude.ai'],                      adapter: claudeAdapter },
  { hosts: ['gemini.google.com'],              adapter: geminiAdapter },
  { hosts: ['copilot.microsoft.com'],          adapter: copilotAdapter },
  { hosts: ['perplexity.ai'],                  adapter: perplexityAdapter },
  { hosts: ['poe.com'],                        adapter: poeAdapter },
  { hosts: ['character.ai'],                   adapter: characterAdapter },
  { hosts: ['mistral.ai'],                     adapter: mistralAdapter },
  { hosts: ['huggingface.co'],                 adapter: huggingfaceAdapter },
  { hosts: ['you.com'],                        adapter: youAdapter },
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
