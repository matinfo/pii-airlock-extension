/** Adapter for huggingface.co/chat. */

import type { ChatAdapter } from './types';

export const huggingfaceAdapter: ChatAdapter = {
  name: 'huggingface',

  findComposer(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('textarea[placeholder*="Ask"]') ??
      document.querySelector<HTMLElement>('[class*="chat"] textarea') ??
      document.querySelector<HTMLElement>('form textarea') ??
      document.querySelector<HTMLElement>('textarea[placeholder*="Message"]') ??
      null
    );
  },

  findSendButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('form button[type="submit"]') ??
      document.querySelector<HTMLElement>('button[aria-label*="Send" i]') ??
      document.querySelector<HTMLElement>('button[aria-label*="submit" i]') ??
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
