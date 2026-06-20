/** Adapter for poe.com. */

import type { ChatAdapter } from './types';

export const poeAdapter: ChatAdapter = {
  name: 'poe',

  findComposer(): HTMLElement | null {
    return (
      // Main chat input — Poe uses a growing textarea
      document.querySelector<HTMLElement>('textarea[class*="GrowingTextArea"]') ??
      document.querySelector<HTMLElement>('[class*="ChatMessageInputContainer"] textarea') ??
      document.querySelector<HTMLElement>('textarea[placeholder*="Talk"]') ??
      document.querySelector<HTMLElement>('textarea[placeholder*="Message"]') ??
      null
    );
  },

  findSendButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('button[class*="SendButton"]') ??
      document.querySelector<HTMLElement>('[class*="ChatMessageInputContainer"] button[type="submit"]') ??
      document.querySelector<HTMLElement>('button[aria-label*="Send" i]') ??
      null
    );
  },

  getText(composer: HTMLElement): string {
    return (composer as HTMLTextAreaElement).value ?? composer.innerText ?? '';
  },

  setText(composer: HTMLElement, text: string): void {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, 'value',
    )?.set;
    nativeSetter?.call(composer, text);
    composer.dispatchEvent(new Event('input', { bubbles: true }));
  },

  triggerSend(composer: HTMLElement): void {
    const btn = this.findSendButton();
    if (btn) { btn.click(); return; }
    composer.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
    );
  },
};
