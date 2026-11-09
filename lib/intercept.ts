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
import { composerScope, isTextControl, pasteReplace, setTextControl } from './adapters/dom';
import { analyze } from './detection/engine';
import type { Detection, DetectionResult } from './detection/types';
import { BrowserMapping } from './mapping';
import { isActive, currentSettings, mustScrub } from './policy';
import { getLists, setLists, type Lists } from './lists';
import { t } from './i18n';
import { UI_HOST_ID, shield, showModal, type PanelItem } from './ui/components';

export interface GuardOptions {
  /** Called with the number of items scrubbed after each successful scrub. */
  onScrub?: (count: number) => void;
  /** Called when the user edits their allow / deny lists from the panel. */
  onListChange?: (lists: Lists) => void;
  /** Detection function. Injectable so tests can simulate engine failure. */
  analyze?: typeof analyze;
  /** Token store shared with the page restorer. Defaults to a private one. */
  mapping?: BrowserMapping;
}

type Origin =
  | { kind: 'key'; event: KeyboardEvent }
  /** `replay`: the button was not a recognised send button; re-issue ITS click, not the adapter's send. */
  | { kind: 'click'; target: HTMLElement; replay?: boolean }
  | { kind: 'submit'; form: HTMLFormElement };

interface Ctx {
  editable: HTMLElement;
  origin: Origin;
}

const EDITABLE_SEL = '[contenteditable]:not([contenteditable="false"])';
/**
 * Editables that are plumbing, not composers. Quill (Gemini) parks focus in a
 * hidden `.ql-clipboard` while it processes a paste and fires `input` there; that
 * event would hijack the live scan and read an empty node, hiding the chip.
 */
const PLUMBING_SEL = '.ql-clipboard';
/**
 * Send-button labels are localised by the chat sites. Covers the interface
 * languages of the extension (EN FR DE ES IT) plus PT and NL; the arrow icon
 * check in isSendButton is the language-independent backstop.
 */
const SEND_LABEL_RE =
  /\b(send|submit|ask|envoyer|envoi|senden|absenden|abschicken|enviar|mandar|invia|inviare|manda|verzenden|versturen)\b/i;
const MAX_RETRIES = 3;

/** Interface languages whose send buttons were verified live; the unknown-button net skips them. */
const WELL_TESTED_LANGS = new Set(['en', 'fr']);

/** Language of the chat page (its own <html lang>, else the browser's), e.g. "fr". */
export function pageLanguage(): string {
  const raw = document.documentElement.lang || (typeof navigator !== 'undefined' ? navigator.language : '') || 'en';
  return raw.toLowerCase().split(/[-_]/)[0] || 'en';
}

/** Resolve the editable element an event came from, or null. */
function editableFrom(e: Event): HTMLElement | null {
  let rich: HTMLElement | null = null;
  for (const n of e.composedPath()) {
    if (!(n instanceof HTMLElement)) continue;
    if (n.id === UI_HOST_ID) return null; // our own UI
    if (n.matches(PLUMBING_SEL)) return null;
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
  private mapping: BrowserMapping;
  private adapter: ChatAdapter;
  private _onScrub?: (n: number) => void;
  private analyze: typeof analyze;
  private _installed = false;
  /** True while WE re-issue the user's send, so our own listeners let it pass. */
  private _sending = false;
  /** One evaluation at a time. */
  private _busy = false;
  private _onListChange?: (l: Lists) => void;
  /** Items the user unticked for the current message (type|value keys). */
  private excluded = new Set<string>();
  private scanSeq = 0;
  /** Items the last live scan wants replaced (0 = clean or unknown). */
  private pendingItems = 0;
  /** An edit happened and its scan has not finished yet. */
  private scanQueued = false;
  private scanTimer: ReturnType<typeof setTimeout> | undefined;
  private liveEditable: HTMLElement | null = null;

  private _onKeydown = (e: KeyboardEvent) => this.handleKeydown(e);
  private _onClick = (e: MouseEvent) => this.handleClick(e);
  private _onSubmit = (e: Event) => this.handleSubmit(e);
  private _onInput = (e: Event) => this.scheduleScan(editableFrom(e));
  private _onPaste = (e: ClipboardEvent) => this.scheduleScan(editableFrom(e));
  private _onDrop = (e: DragEvent) => this.scheduleScan(editableFrom(e));
  // Clearing the box (select-all + Delete, Cut, a script wiping it) does not
  // always fire `input` on rich editors; without a rescan the tab keeps
  // advertising replacements for text that is gone.
  private _onCut = (e: ClipboardEvent) => this.scheduleScan(editableFrom(e));
  private _onKeyup = (e: KeyboardEvent) => {
    if (e.key === 'Backspace' || e.key === 'Delete') this.scheduleScan(editableFrom(e));
  };
  private watcher: MutationObserver | undefined;
  private watched: HTMLElement | null = null;

  /** Rescan whenever the live editable's content changes, whatever the cause. */
  private watch(editable: HTMLElement): void {
    if (this.watched === editable || isTextControl(editable)) return;
    this.watcher?.disconnect();
    this.watched = editable;
    this.watcher ??= new MutationObserver(() => {
      if (this.watched?.isConnected) this.scheduleScan(this.watched);
    });
    this.watcher.observe(editable, { childList: true, characterData: true, subtree: true });
  }

  constructor(adapter: ChatAdapter, opts: GuardOptions = {}) {
    this.adapter = adapter;
    this._onScrub = opts.onScrub;
    this._onListChange = opts.onListChange;
    this.analyze = opts.analyze ?? analyze;
    this.mapping = opts.mapping ?? new BrowserMapping();
  }

  install(): void {
    if (this._installed) return;
    this._installed = true;
    window.addEventListener('keydown', this._onKeydown, true);
    window.addEventListener('click', this._onClick, true);
    window.addEventListener('submit', this._onSubmit, true);
    window.addEventListener('paste', this._onPaste, true);
    window.addEventListener('drop', this._onDrop, true);
    window.addEventListener('cut', this._onCut, true);
    window.addEventListener('keyup', this._onKeyup, true);
    window.addEventListener('input', this._onInput, true);
    shield.init(() => this.anchor(), {
      onToggle: (key, checked) => { if (checked) this.excluded.delete(key); else this.excluded.add(key); },
      onAllow: (item) => this.allowValue(item),
      onAlways: (item) => this.alwaysScrub(item),
      onScrubNow: () => { if (this.liveEditable) void this.scrubInPlace(this.liveEditable); },
    });
  }

  destroy(): void {
    if (!this._installed) return;
    this._installed = false;
    clearTimeout(this.scanTimer);
    shield.destroy();
    window.removeEventListener('input', this._onInput, true);
    window.removeEventListener('keydown', this._onKeydown, true);
    window.removeEventListener('click', this._onClick, true);
    window.removeEventListener('submit', this._onSubmit, true);
    window.removeEventListener('paste', this._onPaste, true);
    window.removeEventListener('drop', this._onDrop, true);
    window.removeEventListener('cut', this._onCut, true);
    window.removeEventListener('keyup', this._onKeyup, true);
    this.watcher?.disconnect(); this.watched = null;
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
    if (this._sending || !isActive()) return;
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
    if (this._sending || !isActive()) return;
    const btn = buttonFrom(e);
    if (!btn) return;
    const composer = this.adapter.findComposer();
    if (!composer) return;
    const known = this.isSendButton(btn, composer);
    // Safety net for send buttons we cannot recognise (translated or redesigned
    // UI): any plain button in the composer's own container, clicked while the box
    // may hold PII, is checked first and then re-clicked. A real send goes through;
    // a toggle or attach button just works as before, after the check.
    if (!known && !this.maybeUnknownSend(btn, composer)) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    this.start({ editable: composer, origin: { kind: 'click', target: btn, replay: !known } });
  }

  private handleSubmit(e: Event): void {
    if (this._sending || !isActive()) return;
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

  /** Buttons that open menus or toggle state are never a send action. */
  private static readonly NOT_SEND =
    '[aria-haspopup]:not([aria-haspopup="false"]), [aria-expanded], [aria-pressed], [role="menuitem"], [role="tab"], [role="switch"], [role="combobox"], a[href]';

  private maybeUnknownSend(btn: HTMLElement, composer: HTMLElement): boolean {
    // A fallback for languages we have not verified; in English and French the
    // known-button path is trusted, so ordinary buttons are never second-guessed.
    if (WELL_TESTED_LANGS.has(pageLanguage())) return false;
    if (btn.matches(SendGuard.NOT_SEND) || btn.closest(SendGuard.NOT_SEND)) return false;
    const scope = composerScope(composer);
    if (scope === document || !scope.contains(btn) || composer.contains(btn)) return false;
    if (!this.read(composer).trim()) return false;
    // PII known from the live scan, or the scan has not caught up with the last edit.
    return this.pendingItems > 0 || this.scanQueued;
  }

  /** A button is a send button if it sits in the composer's scope AND looks like one. */
  private isSendButton(btn: HTMLElement, composer: HTMLElement): boolean {
    const known = this.adapter.findSendButton(composer);
    if (known && (known === btn || known.contains(btn))) return true;
    const scope = composerScope(composer);
    if (scope === document || !scope.contains(btn)) return false;
    if (btn.matches('button[type="submit"], input[type="submit"]')) return true;
    const label = `${btn.getAttribute('aria-label') ?? ''} ${btn.getAttribute('data-testid') ?? ''} ${btn.title}`;
    if (SEND_LABEL_RE.test(label)) return true;
    // Language-independent: the "arrow up" / "send" icon most chat UIs use.
    return !!btn.querySelector('[data-mat-icon-name="arrow_upward"], [data-mat-icon-name="send"], [data-icon="arrow-up"], [data-icon="send"]');
  }

  // ---------------------------------------------------------------------------
  // Live scan: keeps the chip current while the user types, pastes or drops.
  // Regex + compromise only (fast); the names model joins at send time.
  // ---------------------------------------------------------------------------

  private anchor() {
    const composer = this.liveEditable?.isConnected ? this.liveEditable : this.adapter.findComposer();
    if (!composer) return null;
    return { composer, sendButton: this.adapter.findSendButton(composer), frame: this.adapter.findFrame?.(composer) ?? null };
  }

  private scheduleScan(editable: HTMLElement | null): void {
    if (!editable) return;
    // While a send is being evaluated/performed our own writes fire input events;
    // a scan then would re-draw the chip over a message that is already leaving.
    if (this._busy || this._sending) return;
    this.liveEditable = editable;
    this.watch(editable);
    this.scanQueued = true;
    clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(() => void this.scan(editable), 350);
  }

  private keyOf = (d: Pick<Detection, 'entityType' | 'value'>) => `${d.entityType}|${d.value.toLowerCase()}`;

  private toItem(d: Detection, token?: string): PanelItem {
    return {
      key: this.keyOf(d),
      entityType: d.entityType,
      value: d.value,
      token,
      checked: !this.excluded.has(this.keyOf(d)),
    };
  }

  private async scan(editable: HTMLElement): Promise<void> {
    const seq = ++this.scanSeq;
    if (!isActive()) {
      this.pendingItems = 0; this.scanQueued = false;
      const s = currentSettings();
      const paused = s.mode !== 'off' && !s.siteOff;
      shield.setProtection(paused ? 'paused' : null);
      shield.render({ items: [], notices: [], mode: 'auto', paused });
      return;
    }
    const text = this.read(editable);
    if (!text.trim()) {
      this.pendingItems = 0; this.scanQueued = false;
      this.excluded.clear(); shield.render({ items: [], notices: [], mode: 'auto', paused: false }); return;
    }
    const r = await this.analyze(text, { skipNer: true });
    if (seq !== this.scanSeq || r.error || this._busy) return;
    const state = this.chipState(r.detections);
    this.pendingItems = state.items.length;
    this.scanQueued = false;
    shield.render(state);
  }

  private chipState(detections: Detection[]) {
    const seen = new Set<string>();
    const uniq = (list: Detection[]) => list.filter((d) => !seen.has(this.keyOf(d)) && seen.add(this.keyOf(d)));
    const mode = currentSettings().mode === 'review' ? 'review' as const : 'auto' as const;
    return {
      items: uniq(detections.filter(mustScrub)).map((d) => this.toItem(d)),
      notices: uniq(detections.filter((d) => !mustScrub(d) && d.entityType !== 'LOCATION' && d.entityType !== 'ORG')).map((d) => this.toItem(d)),
      mode,
      paused: false,
    };
  }

  private persistLists(l: Lists): void {
    setLists(l);
    this._onListChange?.(getLists());
  }

  private allowValue(item: PanelItem): void {
    const cur = getLists();
    this.persistLists({ allow: [...cur.allow, item.value], deny: cur.deny.filter((e) => e.value.toLowerCase() !== item.value.toLowerCase()) });
    this.excluded.delete(item.key);
    if (this.liveEditable) void this.scan(this.liveEditable);
  }

  private alwaysScrub(item: PanelItem): void {
    const cur = getLists();
    this.persistLists({ allow: cur.allow.filter((v) => v !== item.value.toLowerCase()), deny: [...cur.deny, { value: item.value, type: item.entityType }] });
    if (this.liveEditable) void this.scan(this.liveEditable);
  }

  // ---------------------------------------------------------------------------
  // Pipeline
  // ---------------------------------------------------------------------------

  private start(ctx: Ctx): void {
    // Re-entrant intents (double Enter, click during analysis, Enter while the
    // review panel is open) are swallowed. The listener already prevented the
    // default.
    if (this._busy) return;
    this._busy = true;
    void this.evaluate(ctx)
      .catch((err) => {
        console.error('[pii-airlock] send pipeline error — message NOT sent:', err);
      })
      .finally(() => { this._busy = false; });
  }

  private async evaluate(ctx: Ctx): Promise<void> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const text = this.read(ctx.editable);
      if (!text.trim()) { await this.send(ctx); return; }

      // A slow send-time check (names model) shows "Checking…" on the tab.
      const checking = setTimeout(() => shield.setChecking(true), 150);
      let result: DetectionResult;
      try {
        result = await this.analyze(text);
      } finally {
        clearTimeout(checking);
        shield.setChecking(false);
      }
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

    this.nerNote = result.nerTimedOut ? t('namesSkipped') : null;
    shield.skipNote = this.nerNote;

    switch (decision) {
      case 'allow':
      case 'notify': // noticed-only items stay visible in the chip; nothing to do at send
        await this.send(ctx);
        return 'done';

      case 'warn': {
        // Review mode: show exactly what will change, let the user adjust.
        const state = this.chipState(detections);
        const action = await shield.reviewBeforeSend(state);
        if (action === 'cancel') return 'done';
        return this.scrubAndSend(ctx, text, detections);
      }

      default: // 'auto_scrub' | 'block' (legacy override): scrub silently, then tell
        return this.scrubAndSend(ctx, text, detections);
    }
  }

  private nerNote: string | null = null;

  /** error / scrub-failed dialog. Only `error` may end in an explicit raw send. */
  private async failure(
    ctx: Ctx,
    kind: 'error' | 'scrub-failed',
    detections: Detection[],
  ): Promise<void> {
    const action = await showModal(kind, detections.map((d) => d.entityType));
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
    const toScrub = detections.filter(mustScrub).filter((d) => !this.excluded.has(this.keyOf(d)));
    if (toScrub.length === 0) { this.afterSend(); await this.send(ctx); return 'done'; }

    // Offsets are only valid for the analysed text. A dialog may have been open
    // while the user kept typing: re-analyse instead of clobbering their edits.
    if (this.read(ctx.editable) !== analysed) return 'retry';

    const ok = await this.commitScrub(ctx.editable, analysed, toScrub);
    if (!ok) {
      console.error('[pii-airlock] scrub did not commit to the composer; send blocked');
      await this.failure(ctx, 'scrub-failed', toScrub);
      return 'done';
    }
    this._onScrub?.(toScrub.length);
    this.afterSend(toScrub);
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
    const tokens = toScrub.map((d) => this.mapping.tokenFor(d.entityType, d.value));
    // Committed = no raw value left AND every token present (an editor that
    // silently truncates the write would otherwise "pass" by losing the text).
    const committed = () => {
      const after = this.read(editable);
      return !toScrub.some((d) => containsValue(after, d.value)) && tokens.every((t) => after.includes(t));
    };
    this.write(editable, scrubbed);
    await frame();
    if (committed()) return true;
    if (isTextControl(editable)) return false;
    await pasteReplace(editable, scrubbed);
    await frame();
    return committed();
  }

  /** Paste banner "Scrub now": analyse the CURRENT full composer text and scrub it. */
  private async scrubInPlace(editable: HTMLElement): Promise<void> {
    for (let i = 0; i < MAX_RETRIES; i++) {
      const text = this.read(editable);
      const r = await this.analyze(text);
      if (r.error) return;
      if (this.read(editable) !== text) continue;
      const toScrub = r.detections.filter(mustScrub).filter((d) => !this.excluded.has(this.keyOf(d)));
      if (toScrub.length === 0) return;
      if (await this.commitScrub(editable, text, toScrub)) {
        this._onScrub?.(toScrub.length);
        this.afterSend(toScrub, false);
        void this.scan(editable);
      } else {
        await showModal('scrub-failed', toScrub.map((d) => d.entityType));
      }
      return;
    }
  }

  /** Toast the replacements (distinct values) and reset the per-message state. */
  private afterSend(scrubbed: Detection[] = [], clear = true): void {
    const seen = new Set<string>();
    const items = scrubbed
      .filter((d) => !seen.has(this.keyOf(d)) && seen.add(this.keyOf(d)))
      .map((d) => this.toItem(d, this.mapping.tokenFor(d.entityType, d.value)));
    // The note after a send is optional (Settings); an explicit "Replace now" always confirms.
    if (!clear || currentSettings().confirmAfterSend) shield.toast(items, this.nerNote);
    if (clear) {
      // Drop any scan still pending or in flight: it describes the sent message.
      clearTimeout(this.scanTimer);
      this.scanSeq++;
      this.pendingItems = 0;
      this.scanQueued = false;
      this.excluded.clear();
      shield.render({ items: [], notices: [], mode: 'auto', paused: false });
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
      } else if (ctx.origin.kind === 'click' && ctx.origin.replay) {
        ctx.origin.target.click(); // not a known send button: replay exactly what the user clicked
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
