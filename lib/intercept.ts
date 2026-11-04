/**
 * Send guard: a stateless, event-time interceptor.
 *
 * Instead of binding to one composer element (which leaves gaps whenever an SPA
 * remounts the composer, or when an "edit message" box appears), a single set of
 * document-level CAPTURE listeners resolves the composer and send button from
 * each event as it happens:
 *   - keydown Enter (incl. Ctrl/Cmd+Enter; not Shift/Alt+Enter; not IME)
 *   - click on a send button that lives in the composer's own scope
 *   - submit of a form that contains an editable with text
 *   - paste / drop into an editable (scanned, user can scrub in place)
 *
 * Capture on `document` runs before ANY target-level listener, regardless of
 * registration order. That matters: the page's editor (ProseMirror, Lexical,
 * Quill) registered its Enter-to-send handler at boot, before this script.
 *
 * Invariants:
 *   - Detection failure never leads to a silent send, and never to a scrub of
 *     nothing: the user may only edit, or explicitly "send unscanned".
 *   - Never send while the live composer still holds a value we meant to scrub.
 *   - One evaluation at a time (`_busy`): repeat Enter/click while analysing or
 *     while a dialog is open is swallowed, never sent.
 *   - Text is re-read right before scrubbing; if it changed since analysis it is
 *     analysed again, so a stale snapshot never overwrites newer typing.
 */

import type { ChatAdapter } from './adapters/types';
import { composerScope, isTextControl, setTextControl } from './adapters/dom';
import { analyze } from './detection/engine';
import type { Detection, DetectionResult } from './detection/types';
import { BrowserMapping } from './mapping';
import { isQuiet, mustScrub } from './policy';
import {
  UI_HOST_ID,
  dismissBanner,
  isBannerOpen,
  showBanner,
  showModal,
  showPill,
} from './ui/components';

export interface GuardOptions {
  /** Called with the number of items scrubbed after each successful scrub. */
  onScrub?: (count: number) => void;
  /** Detection function. Injectable so tests can simulate engine failure. */
  analyze?: typeof analyze;
}

type Origin =
  | { kind: 'key'; event: KeyboardEvent }
  | { kind: 'click'; target: HTMLElement }
  | { kind: 'submit'; form: HTMLFormElement };

interface Ctx {
  editable: HTMLElement;
  origin: Origin;
}

const EDITABLE_SEL = '[contenteditable]:not([contenteditable="false"])';
const SEND_LABEL_RE = /\b(send|submit|envoyer|senden|invia|enviar|ask)\b/i;
const MAX_RETRIES = 3;

/** Resolve the editable element an event came from, or null. */
function editableFrom(e: Event): HTMLElement | null {
  let rich: HTMLElement | null = null;
  for (const n of e.composedPath()) {
    if (!(n instanceof HTMLElement)) continue;
    if (n.id === UI_HOST_ID) return null; // our own UI
    if (n instanceof HTMLTextAreaElement) return rich ?? n;
    if (n.matches(EDITABLE_SEL)) rich = n; // keep climbing → outermost editing host
  }
  return rich;
}

/** Closest ancestor-or-self button-like element of a click target. */
function buttonFrom(e: Event): HTMLElement | null {
  for (const n of e.composedPath()) {
    if (!(n instanceof HTMLElement)) continue;
    if (n.id === UI_HOST_ID) return null;
    if (n.matches('button, [role="button"], input[type="submit"]')) return n;
  }
  return null;
}

const frame = () =>
  new Promise<void>((r) => {
    // rAF is paused in background tabs: never let it stall the pipeline.
    const t = setTimeout(r, 120);
    requestAnimationFrame(() => { clearTimeout(t); r(); });
  });

/** Word-aware presence check, so a short value isn't "found" inside another word. */
export function containsValue(haystack: string, value: string): boolean {
  if (!value) return false;
  const esc = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pre = /^[\p{L}\p{N}]/u.test(value) ? '(?<![\\p{L}\\p{N}])' : '';
  const post = /[\p{L}\p{N}]$/u.test(value) ? '(?![\\p{L}\\p{N}])' : '';
  return new RegExp(pre + esc + post, 'u').test(haystack);
}

export class SendGuard {
  private mapping = new BrowserMapping();
  private adapter: ChatAdapter;
  private _onScrub?: (n: number) => void;
  private analyze: typeof analyze;
  private _installed = false;
  /** True while WE re-issue the user's send, so our own listeners let it pass. */
  private _sending = false;
  /** One evaluation at a time. */
  private _busy = false;
  /** An intent that arrived while a banner was open; replayed once it closes. */
  private _pending: Ctx | null = null;

  private _onKeydown = (e: KeyboardEvent) => this.handleKeydown(e);
  private _onClick = (e: MouseEvent) => this.handleClick(e);
  private _onSubmit = (e: Event) => this.handleSubmit(e);
  private _onPaste = (e: ClipboardEvent) => this.handlePaste(e, e.clipboardData);
  private _onDrop = (e: DragEvent) => this.handlePaste(e, e.dataTransfer);

  constructor(adapter: ChatAdapter, opts: GuardOptions = {}) {
    this.adapter = adapter;
    this._onScrub = opts.onScrub;
    this.analyze = opts.analyze ?? analyze;
  }

  install(): void {
    if (this._installed) return;
    this._installed = true;
    document.addEventListener('keydown', this._onKeydown, true);
    document.addEventListener('click', this._onClick, true);
    document.addEventListener('submit', this._onSubmit, true);
    document.addEventListener('paste', this._onPaste, true);
    document.addEventListener('drop', this._onDrop, true);
  }

  destroy(): void {
    if (!this._installed) return;
    this._installed = false;
    dismissBanner();
    document.removeEventListener('keydown', this._onKeydown, true);
    document.removeEventListener('click', this._onClick, true);
    document.removeEventListener('submit', this._onSubmit, true);
    document.removeEventListener('paste', this._onPaste, true);
    document.removeEventListener('drop', this._onDrop, true);
    this.mapping.clear();
  }

  /** Wipe the in-memory token mapping (popup "clear" button). */
  clearMapping(): void {
    this.mapping.clear();
  }

  // ---------------------------------------------------------------------------
  // Event handlers (all resolve their targets from the event itself)
  // ---------------------------------------------------------------------------

  private handleKeydown(e: KeyboardEvent): void {
    if (this._sending) return;
    if (e.key !== 'Enter') return;
    // Shift/Alt+Enter = newline. IME confirmation (CJK) is not a send; keyCode
    // 229 covers browsers that fire keydown after compositionend.
    if (e.shiftKey || e.altKey || e.isComposing || e.keyCode === 229) return;
    const editable = editableFrom(e);
    if (!editable) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    this.start({ editable, origin: { kind: 'key', event: e } });
  }

  private handleClick(e: MouseEvent): void {
    if (this._sending) return;
    const btn = buttonFrom(e);
    if (!btn) return;
    const composer = this.adapter.findComposer();
    if (!composer || !this.isSendButton(btn, composer)) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    this.start({ editable: composer, origin: { kind: 'click', target: btn } });
  }

  private handleSubmit(e: Event): void {
    if (this._sending) return;
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    const editable =
      form.querySelector<HTMLElement>('textarea') ??
      form.querySelector<HTMLElement>(EDITABLE_SEL);
    if (!editable) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    this.start({ editable, origin: { kind: 'submit', form } });
  }

  /** A button is a send button if it sits in the composer's scope AND looks like one. */
  private isSendButton(btn: HTMLElement, composer: HTMLElement): boolean {
    const known = this.adapter.findSendButton(composer);
    if (known && (known === btn || known.contains(btn))) return true;
    const scope = composerScope(composer);
    if (scope === document || !scope.contains(btn)) return false;
    if (btn.matches('button[type="submit"], input[type="submit"]')) return true;
    const label = `${btn.getAttribute('aria-label') ?? ''} ${btn.getAttribute('data-testid') ?? ''} ${btn.title}`;
    return SEND_LABEL_RE.test(label);
  }

  private handlePaste(e: ClipboardEvent | DragEvent, data: DataTransfer | null): void {
    const editable = editableFrom(e);
    if (!editable) return;
    const pasted = data?.getData('text/plain') ?? '';
    if (!pasted.trim()) return;

    // Never block paste. Scan the pasted text; if it is sensitive, offer to
    // scrub IN PLACE — by re-analysing the whole composer, because offsets from
    // the pasted snippet mean nothing in the full text.
    void this.analyze(pasted)
      .then(async (r) => {
        if (r.error || r.decision === 'allow' || r.decision === 'notify') return;
        if (!r.detections.some(mustScrub)) return;
        const action = await showBanner(r.detections, r.topTier === 'high', 'paste');
        if (action === 'scrub') await this.scrubInPlace(editable);
      })
      .catch(() => { /* paste scan failures are non-fatal: send path re-checks everything */ });
  }

  // ---------------------------------------------------------------------------
  // Pipeline
  // ---------------------------------------------------------------------------

  private start(ctx: Ctx): void {
    // Re-entrant intents (double Enter, click during analysis, Enter while a
    // dialog is open) are swallowed. The listener already prevented the default.
    if (this._busy) {
      // A non-modal banner is waiting on the user. Pressing Enter again means
      // "I fixed it, try again": close the banner and re-run on the new text.
      if (isBannerOpen()) { this._pending = ctx; dismissBanner(); }
      return;
    }
    this._busy = true;
    void this.evaluate(ctx)
      .catch((err) => {
        console.error('[pii-airlock] send pipeline error — message NOT sent:', err);
      })
      .finally(() => {
        this._busy = false;
        const next = this._pending;
        this._pending = null;
        if (next) this.start(next);
      });
  }

  private async evaluate(ctx: Ctx): Promise<void> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const text = this.read(ctx.editable);
      if (!text.trim()) { await this.send(ctx); return; }

      const result = await this.analyze(text);
      // Typing continued during analysis → this result describes old text.
      if (this.read(ctx.editable) !== text) continue;

      const next = await this.decide(ctx, text, result);
      if (next !== 'retry') return;
    }
    // The text never held still long enough to check. Fail closed.
    await this.failure(ctx, 'error', []);
  }

  private async decide(
    ctx: Ctx,
    text: string,
    result: DetectionResult,
  ): Promise<'done' | 'retry'> {
    const { decision, detections } = result;

    // Engine failure: detections are empty/untrustworthy. Scrubbing would scrub
    // NOTHING and then pass the leak check. Only Edit or explicit raw send.
    if (result.error) {
      await this.failure(ctx, 'error', []);
      return 'done';
    }

    switch (decision) {
      case 'allow':
        await this.send(ctx);
        return 'done';

      case 'notify':
        // honest wording (sent unchanged); stay silent for ubiquitous types
        if (detections.some((d) => !isQuiet(d.entityType))) showPill(detections.length, 'noticed');
        await this.send(ctx);
        return 'done';

      case 'warn': {
        const action = await showBanner(detections, false, 'send');
        if (action === 'scrub') return this.scrubAndSend(ctx, text, detections);
        if (action === 'send') await this.send(ctx);
        return 'done'; // 'edit' → user corrects the message
      }

      case 'auto_scrub':
        return this.scrubAndSend(ctx, text, detections);

      case 'block': {
        const action = await showModal('detected', detections);
        if (action === 'scrub') return this.scrubAndSend(ctx, text, detections);
        return 'done';
      }
    }
  }

  /** error / scrub-failed dialog. Only `error` may end in an explicit raw send. */
  private async failure(
    ctx: Ctx,
    kind: 'error' | 'scrub-failed',
    detections: Detection[],
  ): Promise<void> {
    const action = await showModal(kind, detections);
    if (action === 'send-unscanned') await this.send(ctx);
  }

  /**
   * Scrub the entities whose decision requires it (per-entity overrides are
   * honoured), verify it committed, then send.
   * Returns 'retry' when the text changed since it was analysed.
   */
  private async scrubAndSend(
    ctx: Ctx,
    analysed: string,
    detections: Detection[],
  ): Promise<'done' | 'retry'> {
    const toScrub = detections.filter(mustScrub);
    if (toScrub.length === 0) { await this.send(ctx); return 'done'; }

    // Offsets are only valid for the analysed text. A dialog may have been open
    // while the user kept typing: re-analyse instead of clobbering their edits.
    if (this.read(ctx.editable) !== analysed) return 'retry';

    const ok = await this.commitScrub(ctx.editable, analysed, toScrub);
    if (!ok) {
      console.error('[pii-airlock] scrub did not commit to the composer; send blocked');
      await this.failure(ctx, 'scrub-failed', toScrub);
      return 'done';
    }
    showPill(toScrub.length, 'scrubbed');
    this._onScrub?.(toScrub.length);
    await this.send(ctx);
    return 'done';
  }

  /**
   * Replace the spans, write to the editor, and verify the editor kept it.
   * Some editors (ProseMirror/Lexical) ignore programmatic writes; the message
   * would look scrubbed on screen yet send the original.
   */
  private async commitScrub(
    editable: HTMLElement,
    text: string,
    toScrub: Detection[],
  ): Promise<boolean> {
    const scrubbed = this.mapping.scrub(text, toScrub);
    this.write(editable, scrubbed);
    await frame();
    const after = this.read(editable);
    return !toScrub.some((d) => containsValue(after, d.value));
  }

  /** Paste banner "Scrub now": analyse the CURRENT full composer text and scrub it. */
  private async scrubInPlace(editable: HTMLElement): Promise<void> {
    for (let i = 0; i < MAX_RETRIES; i++) {
      const text = this.read(editable);
      const r = await this.analyze(text);
      if (r.error) return;
      if (this.read(editable) !== text) continue;
      const toScrub = r.detections.filter(mustScrub);
      if (toScrub.length === 0) return;
      if (await this.commitScrub(editable, text, toScrub)) {
        showPill(toScrub.length, 'scrubbed');
        this._onScrub?.(toScrub.length);
      } else {
        await showModal('scrub-failed', toScrub);
      }
      return;
    }
  }

  /**
   * Text controls (textarea/input) are handled here, not by the adapter: an
   * adapter's getText may use innerText (empty for a textarea), which made an
   * edit-message box look blank and sent its raw content.
   */
  private read(el: HTMLElement): string {
    return isTextControl(el) ? el.value : this.adapter.getText(el);
  }

  private write(el: HTMLElement, text: string): void {
    if (isTextControl(el)) setTextControl(el, text);
    else this.adapter.setText(el, text);
  }

  // ---------------------------------------------------------------------------
  // Re-issuing the user's send
  // ---------------------------------------------------------------------------

  /**
   * Re-issue the send with the re-entrancy guard set, so our capture listeners
   * don't intercept it again. Main composer: use the adapter (button click, with
   * a wait for the editor to re-enable it). Other editables (edit-message boxes)
   * and forms: replay the original gesture.
   */
  private async send(ctx: Ctx): Promise<void> {
    this._sending = true;
    try {
      const composer = this.adapter.findComposer();
      const isMain = !!composer && (composer === ctx.editable || composer.contains(ctx.editable));

      if (ctx.origin.kind === 'submit') {
        ctx.origin.form.requestSubmit();
      } else if (isMain) {
        await this.waitForSendButton(composer);
        this.adapter.triggerSend(composer);
      } else if (ctx.origin.kind === 'click') {
        ctx.origin.target.click();
      } else {
        const ev = ctx.origin.event;
        ctx.editable.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', ctrlKey: ev.ctrlKey, metaKey: ev.metaKey,
            bubbles: true, cancelable: true, composed: true,
          }),
        );
      }
    } finally {
      this._sending = false;
    }
  }

  /**
   * After a programmatic setText, editors re-render and briefly DISABLE their
   * send button, so an immediate click no-ops and the message never goes.
   * Poll a few frames for it to enable. No button → adapter uses its Enter path.
   */
  private async waitForSendButton(composer: HTMLElement): Promise<void> {
    for (let i = 0; i < 10; i++) {
      const btn = this.adapter.findSendButton(composer);
      if (!btn) return;
      const disabled =
        (btn as HTMLButtonElement).disabled || btn.getAttribute('aria-disabled') === 'true';
      if (!disabled) return;
      await frame();
    }
  }
}
