/** Adapter for perplexity.ai. */

import type { ChatAdapter } from './types';

export const perplexityAdapter: ChatAdapter = {
  name: 'perplexity',

  findComposer(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('textarea[placeholder*="Ask" i]') ??
      document.querySelector<HTMLElement>('textarea[placeholder*="Search" i]') ??
      document.querySelector<HTMLElement>('textarea') ??
      null
    );
  },

  findSendButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('button[aria-label*="Submit" i]') ??
      document.querySelector<HTMLElement>('button[type="submit"]') ??
      null
    );
  },

  getText(composer: HTMLElement): string {
    if (composer instanceof HTMLTextAreaElement) return composer.value;
    return composer.innerText ?? '';
  },

  setText(composer: HTMLElement, text: string): void {
    if (composer instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value',
      )?.set;
      setter?.call(composer, text);
      composer.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      composer.innerText = text;
      composer.dispatchEvent(new Event('input', { bubbles: true }));
    }
  },

  triggerSend(): void {
    const btn = this.findSendButton();
    if (btn) { btn.click(); return; }
    const composer = this.findComposer();
    composer?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
    );
  },
};
