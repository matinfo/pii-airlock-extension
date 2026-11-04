/** Adapter for mistral.ai/chat. */

import type { ChatAdapter } from './types';
import { queryInScope } from './dom';

export const mistralAdapter: ChatAdapter = {
  name: 'mistral',

  findComposer(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('textarea[data-testid*="chat" i]') ??
      document.querySelector<HTMLElement>('[class*="ChatInput"] textarea') ??
      document.querySelector<HTMLElement>('[class*="chat"] textarea') ??
      document.querySelector<HTMLElement>('textarea[placeholder*="Ask"]') ??
      document.querySelector<HTMLElement>('textarea[placeholder*="Message"]') ??
      document.querySelector<HTMLElement>('textarea') ??
      null
    );
  },

  findSendButton(composer?: HTMLElement): HTMLElement | null {
    const c = composer ?? this.findComposer();
    return (
      queryInScope(c, 'button[type="submit"]') ??
      queryInScope(c, 'button[aria-label*="Send" i]') ??
      queryInScope(c, 'button[data-testid*="send" i]') ??
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
