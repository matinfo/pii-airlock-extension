/** Generic heuristic adapter — works on any site with a chat-like composer. */

import type { ChatAdapter } from './types';

/** Score a candidate composer element 0–6. ≥ 4 = treat as chat composer. */
function scoreComposer(el: Element): number {
  let score = 0;
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role') ?? '';
  const placeholder = (el.getAttribute('placeholder') ?? '').toLowerCase();
  const rect = el.getBoundingClientRect();

  // Is it a real text input?
  if (tag === 'textarea') score += 2;
  else if (el.getAttribute('contenteditable') === 'true' || role === 'textbox') score += 2;
  else return 0;

  // Large enough to be a chat input?
  if (rect.width > 200 && rect.height > 30) score += 1;

  // Placeholder hints at chat
  const chatWords = ['message', 'ask', 'type here', 'prompt', 'chat', 'send', 'write', 'question'];
  if (chatWords.some((w) => placeholder.includes(w))) score += 2;

  // Nearby send button?
  const parent = el.parentElement;
  if (parent) {
    const hasButton = parent.querySelector('button, [role="button"], input[type="submit"]');
    if (hasButton) score += 1;
  }

  return score;
}

export const genericAdapter: ChatAdapter = {
  name: 'generic',

  findComposer(): HTMLElement | null {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        'textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"]',
      ),
    );

    let best: HTMLElement | null = null;
    let bestScore = 3; // minimum threshold

    for (const el of candidates) {
      const s = scoreComposer(el);
      if (s > bestScore) {
        bestScore = s;
        best = el;
      }
    }

    return best;
  },

  findSendButton(): HTMLElement | null {
    // Generic: look for a submit-like button near the composer
    const composer = this.findComposer();
    if (!composer) return null;

    const parent = composer.closest('form') ?? composer.parentElement;
    if (!parent) return null;

    const btn = parent.querySelector<HTMLElement>(
      'button[type="submit"], button[aria-label*="Send" i], button[aria-label*="Submit" i], input[type="submit"]',
    );
    return btn ?? null;
  },

  getText(composer: HTMLElement): string {
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      return composer.value;
    }
    return composer.innerText ?? '';
  },

  setText(composer: HTMLElement, text: string): void {
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value',
      )?.set ?? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      nativeInputValueSetter?.call(composer, text);
      composer.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // contenteditable
      composer.innerText = text;
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      // Place cursor at end
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(composer);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  },

  triggerSend(composer: HTMLElement): void {
    // Try send button first
    const btn = this.findSendButton();
    if (btn) {
      btn.click();
      return;
    }
    // Fallback: dispatch Enter keydown on composer
    composer.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
    );
  },
};
