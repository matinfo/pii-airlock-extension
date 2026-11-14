/**
 * Adapter for Infomaniak Euria (euria.infomaniak.com). kSuite shows it at
 * ksuite.infomaniak.com/<accountId>/euria inside an iframe of this host, so the
 * content script runs in frames for it (see FRAMED_HOSTS in entrypoints/content.ts).
 * Composer: React textarea inside [data-testid="main-prompt"]; send is
 * button[type=submit] (aria-label is localised: "Envoyer", "Send", …).
 */

import type { ChatAdapter } from './types';
import { queryInScope, setTextControl, isTextControl } from './dom';

export const euriaAdapter: ChatAdapter = {
  name: 'euria',

  findComposer(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-testid="main-prompt"] textarea');
  },

  findSendButton(composer?: HTMLElement): HTMLElement | null {
    const c = composer ?? this.findComposer();
    if (!c) return null;
    return queryInScope(c, 'button[type="submit"]');
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
