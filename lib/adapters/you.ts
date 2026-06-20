/** Adapter for you.com AI chat. */

import type { ChatAdapter } from './types';

export const youAdapter: ChatAdapter = {
  name: 'you.com',

  findComposer(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('textarea[data-testid="search-input"]') ??
      document.querySelector<HTMLElement>('[class*="SearchInput"] textarea') ??
      document.querySelector<HTMLElement>('textarea[placeholder*="Ask"]') ??
      document.querySelector<HTMLElement>('textarea[placeholder*="Search"]') ??
      document.querySelector<HTMLElement>('[id*="search-input" i]') ??
      null
    );
  },

  findSendButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('button[aria-label*="Search" i]') ??
      document.querySelector<HTMLElement>('button[aria-label*="Send" i]') ??
      document.querySelector<HTMLElement>('button[type="submit"]') ??
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
