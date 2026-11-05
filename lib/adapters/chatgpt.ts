/** Adapter for chatgpt.com and chat.openai.com. */

import type { ChatAdapter } from './types';
import { replaceContentEditable } from './dom';

export const chatgptAdapter: ChatAdapter = {
  name: 'chatgpt',

  findComposer(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('#prompt-textarea') ??
      document.querySelector<HTMLElement>('[data-testid="prompt-textarea"]') ??
      document.querySelector<HTMLElement>('div[contenteditable="true"].ProseMirror') ??
      // Logged-out chatgpt.com: a plain textarea, no ProseMirror.
      document.querySelector<HTMLElement>('textarea#mobile-composer-prompt') ??
      document.querySelector<HTMLElement>('textarea[name="prompt"]') ??
      null
    );
  },

  findSendButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('[data-testid="send-button"]') ??
      document.querySelector<HTMLElement>('button[aria-label="Send prompt"]') ??
      document.querySelector<HTMLElement>('button[aria-label*="Send" i]') ??
      null
    );
  },

  getText(composer: HTMLElement): string {
    if (composer instanceof HTMLTextAreaElement) return composer.value;
    return composer.innerText ?? '';
  },

  setText(composer: HTMLElement, text: string): void {
    // ChatGPT uses ProseMirror — innerHTML mutation does not commit to its
    // internal state and leaks the original text on send. See dom.ts.
    replaceContentEditable(composer, text);
  },

  triggerSend(): void {
    const btn = this.findSendButton();
    if (btn) {
      btn.click();
      return;
    }
    const composer = this.findComposer();
    composer?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
    );
  },
};
