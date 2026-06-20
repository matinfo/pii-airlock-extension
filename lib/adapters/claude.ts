/** Adapter for claude.ai. */

import type { ChatAdapter } from './types';

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
    composer.innerHTML = `<p>${text.replace(/\n/g, '</p><p>')}</p>`;
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    // Move cursor to end
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(composer);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
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
