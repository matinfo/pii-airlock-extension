/**
 * Send intercept pipeline.
 *
 * Attaches to a composer element and intercepts all send actions:
 *   - Enter keydown (without Shift)
 *   - Send button click (document-level capture so React remounts don't drop it)
 *   - Paste / drop (scan asynchronously; warn/offer scrub after paste)
 *
 * Key invariants:
 *   - On detection error → block in strict mode, never silent pass-through.
 *   - Button listener uses document-level capture so it survives SPA re-renders.
 *   - scrubCount is reported via onScrub callback — caller owns storage writes.
 */

import type { ChatAdapter } from './adapters/types';
import { analyze } from './detection/engine';
import { BrowserMapping } from './mapping';
import { currentSettings } from './policy';
import { showBanner, showModal, showPill, dismissBanner } from './ui/components';

export interface InterceptorOptions {
  /** Called with the number of items scrubbed after each successful scrub. */
  onScrub?: (count: number) => void;
}

export class SendInterceptor {
  private mapping = new BrowserMapping();
  private composer: HTMLElement;
  private adapter: ChatAdapter;
  private _active = true;
  /** True while WE are programmatically sending, so our own capture
   *  listeners don't re-intercept the synthetic click/keydown (which would
   *  loop or block the real send). */
  private _sending = false;
  private _onScrub?: (n: number) => void;

  // Bound handlers — stored for cleanup
  private _onKeydown: (e: KeyboardEvent) => void;
  private _onDocClick: (e: MouseEvent) => void;
  private _onPaste: (e: ClipboardEvent) => void;

  constructor(composer: HTMLElement, adapter: ChatAdapter, opts: InterceptorOptions = {}) {
    this.composer = composer;
    this.adapter = adapter;
    this._onScrub = opts.onScrub;

    this._onKeydown = this.handleKeydown.bind(this);
    this._onDocClick = this.handleDocClick.bind(this);
    this._onPaste = this.handlePaste.bind(this);

    // Keydown MUST be on document at capture phase, NOT on the composer.
    // When the composer is the event target, capture/bubble collapses and
    // listeners fire in *registration order* — the page's editor (ProseMirror,
    // Quill, Lexical) registered its Enter-to-send handler first (at app boot,
    // before our content script), so a composer-level listener would lose the
    // race and the raw text would send before we ever see it. A capture-phase
    // listener on an ancestor (document) runs before ANY target-level listener,
    // regardless of registration order. Same reason the click handler is here.
    document.addEventListener('keydown', this._onKeydown, true);
    composer.addEventListener('paste', this._onPaste, true);

    // Document-level click capture: survives React remounting the send button.
    // We re-query findSendButton() on every click to always target the live DOM.
    document.addEventListener('click', this._onDocClick, true);
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  private handleKeydown(e: KeyboardEvent): void {
    if (!this._active || this._sending) return;
    // Enter without Shift = send intent
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey) return;
    // Document-level listener: only act when the keystroke is inside our
    // composer (ignore Enter in other inputs, our own modal/banner, etc.).
    const target = e.target as Node | null;
    if (!(target instanceof Node)) return;
    if (target !== this.composer && !this.composer.contains(target)) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    void this.evaluate();
  }

  private handleDocClick(e: MouseEvent): void {
    if (!this._active || this._sending) return;
    // Re-query each time — the button may have been remounted by the SPA
    const btn = this.adapter.findSendButton();
    if (!btn) return;
    const target = e.target as Node;
    if (btn !== target && !btn.contains(target)) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    void this.evaluate();
  }

  private handlePaste(e: ClipboardEvent): void {
    if (!this._active) return;
    const pasted = e.clipboardData?.getData('text/plain') ?? '';
    if (!pasted.trim()) return;

    // Don't block paste — scan asynchronously and surface a warning after
    analyze(pasted, { skipNlp: false }).then((result) => {
      if (result.decision === 'allow' || result.decision === 'notify') return;
      showBanner(result.detections, result.topTier === 'high', ({ action }) => {
        if (action === 'scrub') {
          const current = this.adapter.getText(this.composer);
          const scrubbed = this.mapping.scrub(current, result.detections);
          this.adapter.setText(this.composer, scrubbed);
          const n = result.detections.length;
          showPill(n);
          this._onScrub?.(n);
        }
      });
    }).catch(() => { /* paste scan failures are non-fatal */ });
  }

  // ---------------------------------------------------------------------------
  // Core evaluation pipeline
  // ---------------------------------------------------------------------------

  private async evaluate(): Promise<void> {
    const text = this.adapter.getText(this.composer);

    if (!text.trim()) {
      void this.programmaticSend();
      return;
    }

    const result = await analyze(text);
    const { decision, detections } = result;

    switch (decision) {
      case 'allow':
        void this.programmaticSend();
        break;

      case 'notify':
        showPill(detections.length);
        void this.programmaticSend();
        break;

      case 'warn':
        showBanner(detections, false, ({ action }) => {
          if (action === 'scrub') {
            void this.doScrubAndSend(text, detections);
          } else if (action === 'send') {
            void this.programmaticSend();
          }
          // 'edit' → do nothing, user corrects the message
        });
        break;

      case 'auto_scrub':
        await this.doScrubAndSend(text, detections);
        break;

      case 'block':
        showModal(detections, ({ action }) => {
          if (action === 'scrub') {
            void this.doScrubAndSend(text, detections);
          }
          // 'edit' → do nothing
        });
        break;
    }
  }

  private async doScrubAndSend(
    text: string,
    detections: import('./detection/types').Detection[],
  ): Promise<void> {
    const scrubbed = this.mapping.scrub(text, detections);
    this.adapter.setText(this.composer, scrubbed);

    // CRITICAL invariant (#1/#3): never send if the live composer still holds
    // raw PII. Some editors (ProseMirror/Lexical) keep an internal document and
    // may ignore a programmatic setText — the message would *look* scrubbed but
    // send the original. Verify the replacement actually committed before send.
    // Wait a frame so the editor can process the input event, then re-read.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const after = this.adapter.getText(this.composer);
    const leaked = detections.filter((d) => after.includes(d.value));

    if (leaked.length > 0) {
      // Scrub did not commit — fail closed. Do NOT send. Tell the user.
      console.error(
        '[pii-airlock] scrub failed to commit to the composer; blocking send to prevent leak',
        leaked.map((d) => d.entityType),
      );
      showModal(detections, () => {
        /* user must edit/clear manually — never auto-send raw PII */
      });
      return;
    }

    const n = detections.length;
    showPill(n);
    this._onScrub?.(n);
    await this.programmaticSend();
  }

  /**
   * Trigger send programmatically with the re-entrancy guard set, so our own
   * capture-phase keydown/click listeners don't intercept the synthetic event
   * (which would loop, or preventDefault the real send).
   *
   * After a programmatic setText, editors (ProseMirror/Quill) re-render and
   * briefly DISABLE their send button, so a synchronous button click no-ops and
   * the scrubbed message never sends. Poll a few frames for the button to enable
   * before triggering. Falls back to the adapter's Enter-dispatch when there is
   * no button to inspect.
   */
  private async programmaticSend(): Promise<void> {
    this._sending = true;
    try {
      for (let i = 0; i < 10; i++) {
        const btn = this.adapter.findSendButton();
        if (!btn) break; // no button → adapter uses Enter fallback
        const disabled =
          (btn as HTMLButtonElement).disabled ||
          btn.getAttribute('aria-disabled') === 'true';
        if (!disabled) break; // ready to click
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      this.adapter.triggerSend(this.composer);
    } finally {
      this._sending = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  destroy(): void {
    this._active = false;
    dismissBanner();
    document.removeEventListener('keydown', this._onKeydown, true);
    this.composer.removeEventListener('paste', this._onPaste, true);
    document.removeEventListener('click', this._onDocClick, true);
    this.mapping.clear();
  }
}
