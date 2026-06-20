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

    composer.addEventListener('keydown', this._onKeydown, true);
    composer.addEventListener('paste', this._onPaste, true);

    // Document-level click capture: survives React remounting the send button.
    // We re-query findSendButton() on every click to always target the live DOM.
    document.addEventListener('click', this._onDocClick, true);
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  private async handleKeydown(e: KeyboardEvent): Promise<void> {
    if (!this._active) return;
    // Enter without Shift = send intent
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    await this.evaluate();
  }

  private handleDocClick(e: MouseEvent): void {
    if (!this._active) return;
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
      this.adapter.triggerSend(this.composer);
      return;
    }

    const result = await analyze(text);
    const { decision, detections } = result;

    switch (decision) {
      case 'allow':
        this.adapter.triggerSend(this.composer);
        break;

      case 'notify':
        showPill(detections.length);
        this.adapter.triggerSend(this.composer);
        break;

      case 'warn':
        showBanner(detections, false, ({ action }) => {
          if (action === 'scrub') {
            this.doScrubAndSend(text, detections);
          } else if (action === 'send') {
            this.adapter.triggerSend(this.composer);
          }
          // 'edit' → do nothing, user corrects the message
        });
        break;

      case 'auto_scrub':
        this.doScrubAndSend(text, detections);
        break;

      case 'block':
        showModal(detections, ({ action }) => {
          if (action === 'scrub') {
            this.doScrubAndSend(text, detections);
          }
          // 'edit' → do nothing
        });
        break;
    }
  }

  private doScrubAndSend(text: string, detections: import('./detection/types').Detection[]): void {
    const scrubbed = this.mapping.scrub(text, detections);
    this.adapter.setText(this.composer, scrubbed);
    const n = detections.length;
    showPill(n);
    this._onScrub?.(n);
    this.adapter.triggerSend(this.composer);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  destroy(): void {
    this._active = false;
    dismissBanner();
    this.composer.removeEventListener('keydown', this._onKeydown, true);
    this.composer.removeEventListener('paste', this._onPaste, true);
    document.removeEventListener('click', this._onDocClick, true);
    this.mapping.clear();
  }
}
