/** Adapter for chat.mistral.ai (Le Chat). Composer is a ProseMirror contenteditable. */

import type { ChatAdapter } from './types';
import { queryInScope, replaceContentEditable } from './dom';

export const mistralAdapter: ChatAdapter = {
  name: 'mistral',

  findComposer(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('[data-composer-editor] .ProseMirror[contenteditable="true"]') ??
      document.querySelector<HTMLElement>('.ProseMirror[contenteditable="true"]') ??
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
      queryInScope(c, 'button[type="submit"]:not([hidden])') ??
      queryInScope(c, 'button[aria-label*="Send" i]') ??
      queryInScope(c, 'button[data-testid*="send" i]') ??
      null
    );
  },

  getText(composer: HTMLElement): string {
    if (composer.isContentEditable) return composer.innerText ?? '';
    return (composer as HTMLTextAreaElement).value ?? composer.innerText ?? '';
  },

  setText(composer: HTMLElement, text: string): void {
    if (composer.isContentEditable) {
      replaceContentEditable(composer, text);
      return;
    }
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
