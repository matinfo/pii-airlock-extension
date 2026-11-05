/** Adapter for copilot.microsoft.com and copilot.cloud.microsoft (Microsoft 365 Copilot). */

import type { ChatAdapter } from './types';
import { replaceContentEditable, queryInScope } from './dom';

export const copilotAdapter: ChatAdapter = {
  name: 'copilot',

  findComposer(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('#userInput') ??
      document.querySelector<HTMLElement>('textarea[placeholder*="Message"]') ??
      document.querySelector<HTMLElement>('textarea[aria-label*="chat" i]') ??
      // copilot.cloud.microsoft: rich contenteditable textbox instead of a textarea.
      document.querySelector<HTMLElement>('#m365-chat-editor-target-element') ??
      document.querySelector<HTMLElement>('[role="textbox"][contenteditable="true"]') ??
      null
    );
  },

  findSendButton(composer?: HTMLElement): HTMLElement | null {
    const c = composer ?? this.findComposer();
    return (
      queryInScope(c, 'button[aria-label*="Submit" i]') ??
      queryInScope(c, 'button[aria-label*="Send" i]') ??
      queryInScope(c, 'button[type="submit"]') ??
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
      // contenteditable: route through the editor so it commits. See dom.ts.
      replaceContentEditable(composer, text);
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
