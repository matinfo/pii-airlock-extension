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

/**
 * The container that owns a composer and its send button: the enclosing form,
 * else a few ancestors up. Send-button lookups are limited to this scope so a
 * generic selector like `button[type=submit]` can't match an unrelated button
 * elsewhere on the page.
 */
export function composerScope(composer: HTMLElement | null): ParentNode {
  if (!composer) return document;
  const form = composer.closest('form');
  if (form) return form;
  let el: HTMLElement = composer;
  for (let i = 0; i < 3 && el.parentElement && el.parentElement !== document.body; i++) {
    el = el.parentElement;
  }
  return el;
}

/** querySelector limited to the composer's scope. */
export function queryInScope<T extends HTMLElement = HTMLElement>(
  composer: HTMLElement | null,
  selector: string,
): T | null {
  return composerScope(composer).querySelector<T>(selector);
}

/** textarea / text input: read via `.value`, never innerText (which is empty). */
export function isTextControl(el: HTMLElement): el is HTMLTextAreaElement | HTMLInputElement {
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
}

/** Set a text control's value in a way React-style frameworks notice. */
export function setTextControl(el: HTMLTextAreaElement | HTMLInputElement, text: string): void {
  const proto = el instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, text);
  else el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
