/** Shared DOM helpers for adapters. */

/**
 * Replace all text in a rich contenteditable editor (ProseMirror, Quill,
 * Lexical, Draft, etc.).
 *
 * These editors keep their own internal document model and serialise from it
 * on send. Mutating `innerHTML`/`innerText` directly changes the visible DOM
 * but NOT that model — and the editor's mutation observer often reverts the
 * change — so the original text is still sent. That is a PII leak: the message
 * looks scrubbed while the raw value goes out.
 *
 * Routing the replacement through `execCommand('insertText')` fires the native
 * beforeinput/input events the editor listens for, committing the new text to
 * its internal state. `execCommand` is deprecated but remains the reliable
 * cross-editor path; callers must still verify the composer post-condition
 * before sending (see SendInterceptor.doScrubAndSend) in case it no-ops.
 */
export function replaceContentEditable(composer: HTMLElement, text: string): void {
  composer.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(composer);
  sel?.removeAllRanges();
  sel?.addRange(range);

  const inserted = document.execCommand('insertText', false, text);
  if (!inserted) {
    // Fallback: a cancelable beforeinput the editor can act on.
    composer.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertReplacementText',
        data: text,
      }),
    );
  }
}
