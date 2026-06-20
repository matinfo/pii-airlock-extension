/**
 * Send intercept pipeline.
 *
 * Attaches to a composer element and intercepts all send actions:
 *   - Enter keydown (without Shift)
 *   - Send button click
 *   - Paste / drop (scan, don't block — warn if PII found after paste)
 *
 * Key invariant: on detection error → block in strict mode, never silent pass.
 */

import type { ChatAdapter } from './adapters/types';
import { analyze } from './detection/engine';
import { BrowserMapping } from './mapping';
import { currentSettings } from './policy';
import { showBanner, showModal, showPill, dismissBanner } from './ui/components';

export class SendInterceptor {
  private mapping = new BrowserMapping();
  private composer: HTMLElement;
  private adapter: ChatAdapter;
  private _active = true;

  // Keep references for cleanup
  private _onKeydown: (e: KeyboardEvent) => void;
  private _onButtonClick: (e: MouseEvent) => void;
  private _onPaste: (e: ClipboardEvent) => void;

  constructor(composer: HTMLElement, adapter: ChatAdapter) {
    this.composer = composer;
    this.adapter = adapter;

    this._onKeydown = this.handleKeydown.bind(this);
    this._onButtonClick = this.handleButtonClick.bind(this);
    this._onPaste = this.handlePaste.bind(this);

    composer.addEventListener('keydown', this._onKeydown, true);
    composer.addEventListener('paste', this._onPaste, true);

    // Also intercept the send button
    const btn = adapter.findSendButton();
    if (btn) {
      btn.addEventListener('click', this._onButtonClick, true);
    }
  }

  private async handleKeydown(e: KeyboardEvent): Promise<void> {
    if (!this._active) return;
    // Enter without Shift = send
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    await this.evaluate();
  }

  private async handleButtonClick(e: MouseEvent): Promise<void> {
    if (!this._active) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    await this.evaluate();
  }

  private handlePaste(e: ClipboardEvent): void {
    if (!this._active) return;
    // Don't block paste — scan asynchronously and show pill/banner after
    const pasted = e.clipboardData?.getData('text/plain') ?? '';
    if (!pasted.trim()) return;

    analyze(pasted, { skipNlp: false }).then((result) => {
      if (result.decision === 'allow' || result.decision === 'notify') return;
      showBanner(result.detections, result.topTier === 'high', ({ action }) => {
        if (action === 'scrub') {
          const current = this.adapter.getText(this.composer);
          const scrubbed = this.mapping.scrub(current, result.detections);
          this.adapter.setText(this.composer, scrubbed);
          showPill(result.detections.length);
        }
      });
    }).catch(() => { /* paste scan failures are non-fatal */ });
  }

  private async evaluate(): Promise<void> {
    const text = this.adapter.getText(this.composer);

    if (!text.trim()) {
      // Empty message — allow
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
        // Silent pill, send immediately
        showPill(detections.length);
        this.adapter.triggerSend(this.composer);
        break;

      case 'warn':
        showBanner(detections, false, ({ action }) => {
          if (action === 'scrub') {
            const scrubbed = this.mapping.scrub(text, detections);
            this.adapter.setText(this.composer, scrubbed);
            showPill(detections.length);
            this.adapter.triggerSend(this.composer);
          } else if (action === 'send') {
            this.adapter.triggerSend(this.composer);
          }
          // 'edit' → do nothing, user fixes the message
        });
        break;

      case 'auto_scrub': {
        const scrubbed = this.mapping.scrub(text, detections);
        this.adapter.setText(this.composer, scrubbed);
        showPill(detections.length);
        this.adapter.triggerSend(this.composer);
        break;
      }

      case 'block':
        showModal(detections, ({ action }) => {
          if (action === 'scrub') {
            const scrubbed = this.mapping.scrub(text, detections);
            this.adapter.setText(this.composer, scrubbed);
            showPill(detections.length);
            this.adapter.triggerSend(this.composer);
          }
          // 'edit' → do nothing
        });
        break;
    }
  }

  destroy(): void {
    this._active = false;
    dismissBanner();
    this.composer.removeEventListener('keydown', this._onKeydown, true);
    this.composer.removeEventListener('paste', this._onPaste, true);
    const btn = this.adapter.findSendButton();
    btn?.removeEventListener('click', this._onButtonClick, true);
    this.mapping.clear();
  }
}
