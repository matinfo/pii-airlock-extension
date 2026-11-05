/** Adapter for claude.ai. */

import type { ChatAdapter } from './types';
import { replaceContentEditable } from './dom';

export const claudeAdapter: ChatAdapter = {
  name: 'claude',

  findComposer(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('.ProseMirror[contenteditable="true"]') ??
      document.querySelector<HTMLElement>('[data-placeholder][contenteditable="true"]') ??
      null
    );
  },

  findSendButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('button[aria-label="Send message"]') ??
      document.querySelector<HTMLElement>('button[data-testid="send-button"]') ??
      null
    );
  },

  getText(composer: HTMLElement): string {
    return composer.innerText ?? '';
  },

  setText(composer: HTMLElement, text: string): void {
    // claude.ai uses ProseMirror — innerHTML mutation does not commit to its
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
