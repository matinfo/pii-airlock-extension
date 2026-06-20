/** Adapter for character.ai (character.ai/chat/). */

import type { ChatAdapter } from './types';

export const characterAdapter: ChatAdapter = {
  name: 'character.ai',

  findComposer(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('div[name="human_turn_editor"] textarea') ??
      document.querySelector<HTMLElement>('textarea[placeholder*="Message"]') ??
      document.querySelector<HTMLElement>('textarea[placeholder*="Talk"]') ??
      document.querySelector<HTMLElement>('[data-testid="user-input"]') ??
      // Newer UI: contenteditable in chat form
      document.querySelector<HTMLElement>('[contenteditable="true"][data-slate-editor]') ??
      null
    );
  },

  findSendButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('button[type="submit"][form]') ??
      document.querySelector<HTMLElement>('button[aria-label*="Send" i]') ??
      document.querySelector<HTMLElement>('button[class*="send" i]') ??
      null
    );
  },

  getText(composer: HTMLElement): string {
    if (composer instanceof HTMLTextAreaElement) return composer.value;
    return composer.innerText ?? '';
  },

  setText(composer: HTMLElement, text: string): void {
    if (composer instanceof HTMLTextAreaElement) {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, 'value',
      )?.set;
      nativeSetter?.call(composer, text);
    } else {
      composer.innerText = text;
    }
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
