/** Adapter for gemini.google.com. */

import type { ChatAdapter } from './types';

export const geminiAdapter: ChatAdapter = {
  name: 'gemini',

  findComposer(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('.ql-editor[contenteditable="true"]') ??
      document.querySelector<HTMLElement>('rich-textarea [contenteditable="true"]') ??
      document.querySelector<HTMLElement>('[data-placeholder][contenteditable="true"]') ??
      null
    );
  },

  findSendButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('button[aria-label="Send message"]') ??
      document.querySelector<HTMLElement>('button.send-button') ??
      document.querySelector<HTMLElement>('button[data-mat-icon-name="send"]') ??
      null
    );
  },

  getText(composer: HTMLElement): string {
    return composer.innerText ?? '';
  },

  setText(composer: HTMLElement, text: string): void {
    // Quill editor: set innerText and dispatch events
    composer.innerText = text;
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
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
