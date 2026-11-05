/** Adapter for gemini.google.com. */

import type { ChatAdapter } from './types';
import { replaceContentEditable } from './dom';

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
    // aria-label is localised ("Envoyer un message", "Nachricht senden"…), so the
    // arrow icon is the locale-independent anchor. Mic/stop use other icons.
    return (
      document.querySelector<HTMLElement>('button:has([data-mat-icon-name="arrow_upward"])') ??
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
    // Gemini uses a Quill editor with its own internal model — innerText
    // mutation does not commit and leaks the original on send. See dom.ts.
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
