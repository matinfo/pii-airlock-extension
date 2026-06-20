/** Shared interface for all site adapters. */

export interface ChatAdapter {
  /** Human-readable name for logging/debugging. */
  name: string;

  /**
   * Find the active chat composer element on the current page.
   * Returns null if the page doesn't match or the composer hasn't mounted yet.
   */
  findComposer(): HTMLElement | null;

  /**
   * Find the send button associated with the composer.
   * Returns null if not determinable (keyboard-only intercept is used instead).
   */
  findSendButton(): HTMLElement | null;

  /**
   * Read the current text content from the composer element.
   */
  getText(composer: HTMLElement): string;

  /**
   * Write scrubbed text back into the composer element.
   * Must preserve cursor position as much as possible.
   */
  setText(composer: HTMLElement, text: string): void;

  /**
   * Programmatically trigger send after scrubbing.
   * Called after setText() when auto_scrub decision is taken.
   */
  triggerSend(composer: HTMLElement): void;
}
