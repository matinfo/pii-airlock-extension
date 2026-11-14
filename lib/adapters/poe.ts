/** Adapter for poe.com: React-controlled growing textarea, send button `data-button-send`. */

import type { ChatAdapter } from './types';
import { queryInScope, setTextControl, isTextControl } from './dom';

export const poeAdapter: ChatAdapter = {
  name: 'poe',

  findComposer(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('textarea[class*="GrowingTextArea_textArea"]') ??
      document.querySelector<HTMLElement>('[class*="ChatMessageInputContainer"] textarea') ??
      null
    );
  },

  findSendButton(composer?: HTMLElement): HTMLElement | null {
    const c = composer ?? this.findComposer();
    return (
      queryInScope(c, 'button[data-button-send="true"]') ??
      queryInScope(c, 'button[aria-label="Send message" i]') ??
      null
    );
  },

  getText(composer: HTMLElement): string {
    return isTextControl(composer) ? composer.value : composer.innerText ?? '';
  },

  setText(composer: HTMLElement, text: string): void {
    if (isTextControl(composer)) setTextControl(composer, text);
  },

  triggerSend(composer: HTMLElement): void {
    const btn = this.findSendButton(composer);
    if (btn) { btn.click(); return; }
    composer.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
    );
  },
};
