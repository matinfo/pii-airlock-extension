/**
 * In-page UI: a status tab on the composer's border, a review panel, a post-send toast
 * and a modal for real failures. Everything lives in a closed shadow root and
 * is built with textContent only (values are user data, never HTML). Colours,
 * font and radius are sampled from the host page (see theme.ts), so the UI
 * reads as part of each chat instead of a foreign overlay.
 */

import { t, entityLabel } from '../i18n';
import { applyTheme, sampleTheme } from './theme';
import { locateFrame } from './frame';

/** Id of the shadow host; the send guard ignores events that originate here. */
export const UI_HOST_ID = 'pii-airlock-ui';

export interface PanelItem {
  key: string;
  entityType: string;
  value: string;
  /** Replacement token, known once scrubbed. */
  token?: string;
  checked: boolean;
}

export interface Anchor {
  composer: HTMLElement;
  sendButton: HTMLElement | null;
  /** Adapter override for the visible pill (see ChatAdapter.findFrame). */
  frame?: HTMLElement | null;
}

export interface ShieldHandlers {
  onToggle(key: string, checked: boolean): void;
  onAllow(item: PanelItem): void;
  onAlways(item: PanelItem): void;
  onScrubNow(): void;
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.ui { font: 13px/1.45 var(--font, system-ui, sans-serif); color: var(--fg); -webkit-font-smoothing: antialiased; }
.ui {
  --surface: color-mix(in srgb, var(--fg) 4%, var(--bg));
  --hover: color-mix(in srgb, var(--fg) 8%, var(--bg));
  --border: color-mix(in srgb, var(--fg) 15%, var(--bg));
  --muted: color-mix(in srgb, var(--fg) 62%, var(--bg));
  --shadow: 0 8px 24px rgb(0 0 0 / .16), 0 1px 3px rgb(0 0 0 / .12);
}
button { font: inherit; color: inherit; cursor: pointer; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.float { position: fixed; pointer-events: auto; }

/* Status tab: attached to the top border of the composer pill, just after the
   left corner curve. Inverts with the page (dark on light pages, light on dark
   ones) so it reads as status, not as decoration. One element for every state:
   protected, items to replace, noticed, checking, paused. */
.tab {
  display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 9px 0 6px;
  background: var(--fg); color: var(--bg); border: 0; border-radius: 999px;
  box-shadow: 0 0 0 2px var(--bg), 0 1px 3px rgb(0 0 0 / .18);
  font-size: 11.5px; font-weight: 600; line-height: 1; white-space: nowrap; font-variant-numeric: tabular-nums;
  cursor: default;
}
.tab.clickable { cursor: pointer; }
.tab.clickable:hover { background: color-mix(in srgb, var(--fg) 85%, var(--bg)); }
.tab svg { width: 13px; height: 13px; flex: none; stroke-width: 2.2; }
.tab.muted { background: color-mix(in srgb, var(--fg) 12%, var(--bg)); color: var(--fg); box-shadow: 0 0 0 1px var(--border); }
.tab.muted.clickable:hover { background: color-mix(in srgb, var(--fg) 18%, var(--bg)); }
.tab.compact { padding: 0 5px; }
.tab.compact .lbl { display: none; }
.tab.compact:hover, .tab.compact:focus-visible { padding: 0 9px 0 6px; }
.tab.compact:hover .lbl, .tab.compact:focus-visible .lbl { display: inline; }
.tab[hidden] { display: none; }

.panel {
  width: 348px; max-width: calc(100vw - 16px); max-height: min(60vh, 460px);
  display: flex; flex-direction: column;
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow);
}
.panel > header { padding: 14px 16px 6px; }
.panel h2 { margin: 0; font-size: 14px; font-weight: 600; }
.panel .sub { margin: 2px 0 0; color: var(--muted); font-size: 12px; }
.list { overflow: auto; padding: 6px 8px; margin: 0; list-style: none; }
.group { padding: 8px 8px 2px; color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: .02em; text-transform: uppercase; }
.row { display: grid; grid-template-columns: 20px minmax(0,1fr) auto; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px; }
.row.noicon { grid-template-columns: minmax(0,1fr) auto; }
.row:hover { background: var(--hover); }
.row input { margin: 0; width: 16px; height: 16px; accent-color: var(--accent); }
.meta { min-width: 0; }
.label { font-size: 11px; color: var(--muted); }
.value { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.token { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.link { background: none; border: 0; padding: 4px 6px; border-radius: 6px; font-size: 12px; color: var(--muted); white-space: nowrap; }
.link:hover { color: var(--fg); background: var(--hover); }
.row .link { opacity: 0; }
.row:hover .link, .row:focus-within .link { opacity: 1; }
.note { margin: 0; padding: 8px 16px; color: var(--muted); font-size: 12px; border-top: 1px solid var(--border); }
.panel footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--border); }

.btn { height: 32px; padding: 0 14px; border-radius: calc(var(--radius) - 2px); border: 1px solid var(--border); background: transparent; font-weight: 500; }
.btn:hover { background: var(--hover); }
.btn.primary { background: var(--accent); color: var(--accent-fg); border-color: transparent; }
.btn.primary:hover { filter: brightness(1.08); }
.btn.danger { color: #c2410c; border-color: color-mix(in srgb, #c2410c 40%, var(--bg)); }

.toast {
  display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 12px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 999px; box-shadow: var(--shadow); font-size: 13px;
}
.toast svg { width: 16px; height: 16px; flex: none; }
.toast .sub { color: var(--muted); font-size: 12px; }

.scrim { position: fixed; inset: 0; background: rgb(0 0 0 / .4); pointer-events: auto; display: flex; align-items: center; justify-content: center; }
.modal { width: min(420px, calc(100vw - 32px)); background: var(--bg); border: 1px solid var(--border); border-radius: calc(var(--radius) + 2px); box-shadow: var(--shadow); padding: 20px; }
.modal h2 { margin: 0 0 6px; font-size: 15px; font-weight: 600; }
.modal p { margin: 0 0 14px; color: var(--muted); }
.modal ul { margin: 0 0 16px; padding: 0; list-style: none; color: var(--fg); font-size: 12px; }
.modal .actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }

@media (prefers-reduced-motion: no-preference) {
  .panel, .toast { animation: in .12s ease-out; }
  @keyframes in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
}
`;

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let ui: HTMLElement | null = null;

function shell(): HTMLElement {
  if (ui && host?.isConnected) return ui;
  host = document.createElement('div');
  host.id = UI_HOST_ID;
  host.style.cssText = 'position:fixed;z-index:auto;top:0;left:0;width:0;height:0;';
  (document.body ?? document.documentElement).appendChild(host);
  root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;
  ui = document.createElement('div');
  ui.className = 'ui';
  root.append(style, ui);
  retheme(null, null);
  return ui;
}

function retheme(composer: Element | null, send: Element | null): void {
  if (!host) return;
  try {
    applyTheme(host, sampleTheme(composer, send));
  } catch { /* theming is cosmetic; defaults come from sampleTheme's fallbacks */ }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function icon(kind: 'shield' | 'check' | 'pause'): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const paths = {
    shield: ['M12 3 5 6v5.5c0 4.3 2.9 7.6 7 9.5 4.1-1.9 7-5.2 7-9.5V6l-7-3Z', 'm9 12 2 2 4-4'],
    check: ['m5 12.5 4.5 4.5L19 7.5'],
    pause: ['M9 6v12', 'M15 6v12'],
  }[kind];
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

function button(cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

/** Secrets are shown partially even locally; everything else is shown as typed. */
export function displayValue(item: Pick<PanelItem, 'entityType' | 'value'>): string {
  if (item.entityType === 'SECRET_KEY' && item.value.length > 8) return `${item.value.slice(0, 6)}…`;
  return item.value;
}

// ---------------------------------------------------------------------------
// Shield: status tab + panel + toast, anchored to the composer pill
// ---------------------------------------------------------------------------

export interface ChipState {
  items: PanelItem[];
  notices: PanelItem[];
  mode: 'auto' | 'review';
  paused: boolean;
}

type PanelMode = 'live' | 'review' | 'after';

/** Health of the field, from the content script: protected, paused (NOT protected), or nothing. */
export type Protection = 'on' | 'paused' | null;

const TAB_H = 22;
/** How far the tab overlaps the pill's top border (the rest sits above it). */
const TAB_OVERLAP = 6;
/** "Protected" label stays this long after load / focus / route change, then shrinks to the icon. */
const REVEAL_MS = 4000;

class Shield {
  private tab: HTMLButtonElement | null = null;
  private tabLabel = '';
  private panel: HTMLElement | null = null;
  private toastEl: HTMLElement | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private anchor: (() => Anchor | null) | null = null;
  private handlers: ShieldHandlers | null = null;
  private state: ChipState = { items: [], notices: [], mode: 'auto', paused: false };
  private panelMode: PanelMode | null = null;
  private reviewResolve: ((a: 'send' | 'cancel') => void) | null = null;
  private afterItems: PanelItem[] = [];
  private raf = 0;
  private bound = false;
  private protection: Protection = null;
  private checking = false;
  private compact = false;
  private revealTimer: ReturnType<typeof setTimeout> | undefined;
  private tick: ReturnType<typeof setInterval> | undefined;
  /** Visual box of the composer (the rounded pill), cached per composer. */
  private frameOf: { composer: HTMLElement; frame: HTMLElement; until: number } | null = null;

  init(anchor: () => Anchor | null, handlers: ShieldHandlers): void {
    this.anchor = anchor;
    this.handlers = handlers;
    if (!this.bound) {
      this.bound = true;
      const re = () => this.schedule();
      addEventListener('resize', re);
      addEventListener('scroll', re, true);
      new MutationObserver(() => this.schedule()).observe(document.documentElement, {
        attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode'],
      });
      matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', re);
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.panel) this.closePanel('cancel');
      }, true);
      document.addEventListener('pointerdown', (e) => {
        if (!this.panel || this.panelMode === 'review') return;
        if (!e.composedPath().includes(host as EventTarget)) this.closePanel('cancel');
      }, true);
    }
  }

  destroy(): void {
    this.protection = null;
    this.state = { items: [], notices: [], mode: 'auto', paused: false };
    this.checking = false;
    this.closePanel('cancel');
    this.updateTab();
    this.toastEl?.remove(); this.toastEl = null;
  }

  // -- status inputs ----------------------------------------------------------

  /**
   * Persistent field status, driven by the content script's health check (not
   * by the live scan), so "Protected" shows before anything is typed. null
   * hides the tab unless the scan still has something to show.
   */
  setProtection(state: Protection): void {
    if (state === this.protection && (!state || this.tab?.isConnected)) return;
    const wasOn = this.protection === 'on';
    this.protection = state;
    if (state === 'on' && !wasOn) this.reveal();
    else this.updateTab();
  }

  /** Send-time check in progress (slow names model): "Checking…". */
  setChecking(on: boolean): void {
    if (on === this.checking) return;
    this.checking = on;
    this.updateTab();
  }

  /** Show the full "Protected" label for a few seconds, then shrink to the icon. */
  reveal(): void {
    this.compact = false;
    clearTimeout(this.revealTimer);
    this.revealTimer = setTimeout(() => { this.compact = true; this.updateTab(); }, REVEAL_MS);
    this.updateTab();
  }

  render(state: ChipState, keepPanel = false): void {
    this.state = state;
    if (!state.items.length && !state.notices.length) this.closePanel('cancel', true);
    this.updateTab();
    if (this.panelMode === 'live' && !keepPanel) this.buildPanel();
  }

  // -- tab --------------------------------------------------------------------

  private updateTab(): void {
    const s = this.state;
    const paused = this.protection === 'paused' || s.paused;
    const n = s.items.filter((i) => i.checked).length;
    const hasList = s.items.length > 0 || s.notices.length > 0;
    const visible = paused || this.checking || hasList || this.protection === 'on';
    if (!visible) {
      clearInterval(this.tick); this.tick = undefined;
      this.tab?.remove(); this.tab = null;
      return;
    }
    const root = shell();
    if (!this.tab || !this.tab.isConnected) {
      this.tab = el('button', 'float tab');
      this.tab.type = 'button';
      this.tab.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.tab?.classList.contains('clickable')) { this.reveal(); return; }
        this.panel ? this.closePanel('cancel') : this.openLive();
      });
      root.appendChild(this.tab);
    }

    let label: string;
    let glyph: 'shield' | 'pause' = 'shield';
    let muted = false;
    let shrinkable = false;
    if (paused) {
      label = t('tabNotProtected'); glyph = 'pause'; muted = true;
    } else if (this.checking) {
      label = t('tabChecking');
    } else if (n > 0) {
      label = t(s.mode === 'review' ? 'chipReview' : 'chipReplace', n);
    } else if (hasList) {
      label = t('chipNoticed'); muted = true;
    } else {
      label = t('tabProtected'); shrinkable = true;
    }
    const clickable = !paused && !this.checking && hasList;
    const tab = this.tab;
    tab.classList.toggle('muted', muted);
    tab.classList.toggle('clickable', clickable);
    tab.classList.toggle('compact', shrinkable && this.compact);
    if (label !== this.tabLabel || tab.dataset.glyph !== glyph) {
      this.tabLabel = label;
      tab.dataset.glyph = glyph;
      tab.replaceChildren(icon(glyph), el('span', 'lbl', label));
    }
    const full = paused ? t('markerPaused') : shrinkable ? t('markerOn') : `${t('appName')}: ${label}`;
    tab.title = full;
    tab.setAttribute('aria-label', full);
    if (clickable) {
      tab.setAttribute('aria-haspopup', 'dialog');
      tab.setAttribute('aria-expanded', String(!!this.panel));
    } else {
      tab.removeAttribute('aria-haspopup');
      tab.removeAttribute('aria-expanded');
    }
    // Composers move without any event we could hear (ChatGPT's new-chat box
    // slides from the centre to the bottom). A rect read twice a second is cheap.
    this.tick ??= setInterval(() => this.schedule(), 500);
    this.schedule();
  }

  private frame(a: Anchor): HTMLElement {
    // Short-lived cache: sites restyle the pill (focus, drag-over, theme switch).
    // A fallback is re-checked sooner: the real pill may still be mounting.
    const c = this.frameOf;
    if (c?.composer === a.composer && c.frame.isConnected && Date.now() < c.until) return c.frame;
    const { frame, matched } = a.frame ? { frame: a.frame, matched: true } : locateFrame(a.composer, a.sendButton);
    this.frameOf = { composer: a.composer, frame, until: Date.now() + (matched ? 3000 : 400) };
    return frame;
  }

  private openLive(): void {
    this.panelMode = 'live';
    this.buildPanel();
  }

  // -- panel ----------------------------------------------------------------

  /** Review mode: resolves when the user decides. Unchecked items stay as typed. */
  reviewBeforeSend(state: ChipState): Promise<'send' | 'cancel'> {
    this.closePanel('cancel', true);
    this.state = state;
    this.panelMode = 'review';
    return new Promise((resolve) => {
      this.reviewResolve = resolve;
      this.buildPanel();
    });
  }

  private closePanel(result: 'send' | 'cancel', silent = false): void {
    const r = this.reviewResolve;
    this.reviewResolve = null;
    this.panel?.remove();
    this.panel = null;
    const wasMode = this.panelMode;
    this.panelMode = null;
    if (this.tab?.classList.contains('clickable')) this.tab.setAttribute('aria-expanded', 'false');
    r?.(result);
    if (!silent && wasMode && wasMode !== 'review') this.anchor?.()?.composer.focus?.();
  }

  private buildPanel(): void {
    const mode = this.panelMode;
    if (!mode) return;
    const rootEl = shell();
    const first = !this.panel;
    const old = this.panel;
    const panel = el('div', 'float panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', mode === 'review' ? 'true' : 'false');
    const items = mode === 'after' ? this.afterItems : this.state.items;
    const titleKey = mode === 'after' ? 'panelAfter' : mode === 'review' ? 'panelReview' : 'panelLive';
    const header = el('header');
    const h2 = el('h2', undefined, t(titleKey));
    h2.id = 'pii-panel-title';
    panel.setAttribute('aria-labelledby', h2.id);
    header.append(h2, el('p', 'sub', t(mode === 'after' ? 'subAfter' : mode === 'review' ? 'subReview' : 'subLive')));
    panel.appendChild(header);

    const list = el('ul', 'list');
    for (const item of items) list.appendChild(this.row(item, mode));
    if (mode !== 'after' && this.state.notices.length) {
      list.appendChild(el('li', 'group', t('groupNoticed')));
      for (const item of this.state.notices) list.appendChild(this.row(item, 'notice'));
    }
    panel.appendChild(list);

    if (mode !== 'after' && this.skipNote) panel.appendChild(el('p', 'note', this.skipNote));

    if (mode === 'review') {
      const footer = el('footer');
      const cancel = button('btn', t('btnCancel'), () => this.closePanel('cancel'));
      const go = button('btn primary', t('btnReplaceSend'), () => this.closePanel('send'));
      footer.append(cancel, go);
      panel.appendChild(footer);
      queueMicrotask(() => go.focus());
    } else if (mode === 'live' && this.state.items.some((i) => i.checked)) {
      const footer = el('footer');
      footer.append(button('btn', t('btnReplaceNow'), () => { this.handlers?.onScrubNow(); this.closePanel('cancel'); }));
      panel.appendChild(footer);
    }

    panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || mode !== 'review') return;
      const f = [...panel.querySelectorAll<HTMLElement>('button, input')].filter((x) => !(x as HTMLButtonElement).disabled);
      const i = f.indexOf(root!.activeElement as HTMLElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length]?.focus();
    });

    old?.remove();
    rootEl.appendChild(panel);
    this.panel = panel;
    if (this.tab?.classList.contains('clickable')) this.tab.setAttribute('aria-expanded', 'true');
    this.schedule();
    if (first && mode === 'live') (panel.querySelector('input,button') as HTMLElement | null)?.focus();
  }

  skipNote: string | null = null;

  private row(item: PanelItem, mode: PanelMode | 'notice'): HTMLElement {
    const li = el('li', `row${mode === 'after' || mode === 'notice' ? ' noicon' : ''}`);
    if (mode === 'live' || mode === 'review') {
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = item.checked;
      cb.setAttribute('aria-label', `${entityLabel(item.entityType)}: ${displayValue(item)}`);
      cb.addEventListener('change', () => {
        item.checked = cb.checked;
        this.handlers?.onToggle(item.key, cb.checked);
        this.render(this.state, true);
      });
      li.appendChild(cb);
    }
    const meta = el('div', 'meta');
    meta.append(el('div', 'label', entityLabel(item.entityType)));
    const v = el('div', 'value', displayValue(item));
    v.title = displayValue(item);
    meta.appendChild(v);
    if (mode === 'after' && item.token) meta.appendChild(el('div', 'token', `→ ${item.token}`));
    li.appendChild(meta);

    if (mode === 'live' || mode === 'review') {
      li.appendChild(button('link', t('rowAllow'), () => { this.handlers?.onAllow(item); }));
    } else if (mode === 'notice') {
      li.appendChild(button('link', t('rowAlways'), () => { this.handlers?.onAlways(item); }));
    } else {
      li.appendChild(button('link', t('rowDontReplace'), () => { this.handlers?.onAllow(item); li.remove(); }));
    }
    return li;
  }

  // -- toast ----------------------------------------------------------------

  toast(items: PanelItem[], note: string | null): void {
    this.dismissToast();
    if (items.length === 0) return;
    this.afterItems = items;
    const a = this.anchor?.();
    const root = shell();
    retheme(a?.composer ?? null, a?.sendButton ?? null);
    const el_ = el('div', 'float toast');
    el_.setAttribute('role', 'status');
    el_.append(icon('check'));
    const text = el('div');
    text.append(document.createTextNode(t(items.length === 1 ? 'toastOne' : 'toastMany', items.length)));
    if (note) text.append(el('div', 'sub', note));
    el_.append(text, button('link', t('toastDetails'), () => {
      this.dismissToast();
      this.panelMode = 'after';
      this.buildPanel();
    }));
    root.appendChild(el_);
    this.toastEl = el_;
    this.schedule();
    const hide = () => { this.toastTimer = setTimeout(() => this.dismissToast(), 6000); };
    hide();
    el_.addEventListener('pointerenter', () => clearTimeout(this.toastTimer));
    el_.addEventListener('pointerleave', hide);
    el_.addEventListener('focusin', () => clearTimeout(this.toastTimer));
  }

  dismissToast(): void {
    clearTimeout(this.toastTimer);
    this.toastEl?.remove();
    this.toastEl = null;
  }

  // -- layout ---------------------------------------------------------------

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.layout(); });
  }

  private layout(): void {
    const a = this.anchor?.();
    if (!a) { if (this.tab) this.tab.hidden = true; return; }
    retheme(a.composer, a.sendButton);
    const fr = this.frame(a).getBoundingClientRect();
    const vw = innerWidth, vh = innerHeight;
    const gap = 8;
    const off = fr.width === 0 || fr.bottom < 0 || fr.top > vh;

    // Tab: on the pill's top border, just after the left corner curve. Flips to
    // the bottom border when the pill is too close to the top of the viewport.
    let tr: { top: number; bottom: number; left: number } | null = null;
    if (this.tab) {
      this.tab.hidden = off;
      if (!off) {
        const radius = Math.min(parseFloat(getComputedStyle(this.frame(a)).borderTopLeftRadius) || 0, fr.height / 2);
        const w = this.tab.offsetWidth;
        const left = Math.min(Math.max(4, fr.left + Math.min(Math.max(radius, 12), 32)), vw - w - 4);
        let top = fr.top - TAB_H + TAB_OVERLAP;
        if (top < 4) top = Math.min(fr.bottom - TAB_OVERLAP, vh - TAB_H - 4);
        Object.assign(this.tab.style, { top: `${top}px`, left: `${left}px` });
        tr = { top, bottom: top + TAB_H, left };
      }
    }
    // Panel and toast hang off the tab; without one, off the pill's top-left.
    const ref = tr ?? { top: fr.top, bottom: fr.top, left: fr.left };
    const tabBelow = !!tr && tr.top > fr.top;

    if (this.panel) {
      const w = this.panel.offsetWidth;
      const left = Math.min(Math.max(gap, ref.left), vw - w - gap);
      const above = (tabBelow ? fr.top : ref.top) - gap;
      const downFrom = Math.max(fr.bottom, ref.bottom) + gap;
      const below = vh - downFrom - gap;
      // Prefer above the composer (chat boxes sit at the bottom); flip when the
      // composer is near the top of the viewport.
      const up = above >= Math.min(this.panel.scrollHeight, 460) || above >= below;
      this.panel.style.maxHeight = `${Math.max(160, Math.min(460, (up ? above : below) - gap))}px`;
      Object.assign(this.panel.style, up
        ? { left: `${left}px`, bottom: `${vh - above}px`, top: 'auto' }
        : { left: `${left}px`, top: `${downFrom}px`, bottom: 'auto' });
    }
    if (this.toastEl) {
      const w = this.toastEl.offsetWidth;
      const h = this.toastEl.offsetHeight;
      const left = Math.min(Math.max(gap, ref.left), vw - w - gap);
      const above = (tabBelow ? fr.top : ref.top) - gap;
      Object.assign(this.toastEl.style, above - h >= 0
        ? { left: `${left}px`, bottom: `${vh - above}px`, top: 'auto' }
        : { left: `${left}px`, top: `${Math.max(fr.bottom, ref.bottom) + gap}px`, bottom: 'auto' });
    }
  }
}

export const shield = new Shield();

// ---------------------------------------------------------------------------
// Modal (real failures only)
// ---------------------------------------------------------------------------

/**
 * scrub-failed – a scrub was attempted but the editor did not commit it. No
 *                scrub button: retrying cannot help, the user must edit.
 * error        – detection itself failed; nothing is known about the text.
 *                Only Edit or an explicit raw send.
 */
export type ModalKind = 'scrub-failed' | 'error';
export type ModalAction = 'edit' | 'send-unscanned';

let _modal: Promise<ModalAction> | null = null;

/** One modal at a time: a repeat call returns the open one's promise. */
export function showModal(kind: ModalKind, types: string[] = []): Promise<ModalAction> {
  if (_modal) return _modal;
  const rootEl = shell();
  const a = null;
  retheme(a, null);
  const previous = document.activeElement as HTMLElement | null;

  const scrim = el('div', 'scrim');
  const box = el('div', 'modal');
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-modal', 'true');
  const h2 = el('h2', undefined, t(kind === 'error' ? 'errTitle' : 'failTitle'));
  h2.id = 'pii-modal-title';
  const body = el('p', undefined, t(kind === 'error' ? 'errBody' : 'failBody'));
  body.id = 'pii-modal-body';
  box.setAttribute('aria-labelledby', h2.id);
  box.setAttribute('aria-describedby', body.id);
  box.append(h2, body);
  if (types.length) {
    const ul = el('ul');
    for (const ty of new Set(types)) ul.appendChild(el('li', undefined, entityLabel(ty)));
    box.appendChild(ul);
  }
  const actions = el('div', 'actions');
  box.appendChild(actions);
  scrim.appendChild(box);

  _modal = new Promise<ModalAction>((resolve) => {
    const finish = (r: ModalAction) => {
      scrim.remove();
      _modal = null;
      previous?.focus?.();
      resolve(r);
    };
    const buttons: HTMLButtonElement[] = [];
    if (kind === 'error') buttons.push(button('btn danger', t('btnSendUnscanned'), () => finish('send-unscanned')));
    const edit = button('btn primary', t('btnEdit'), () => finish('edit'));
    buttons.push(edit);
    actions.append(...buttons);
    scrim.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish('edit'); return; }
      if (e.key === 'Tab') {
        const i = buttons.indexOf(root!.activeElement as HTMLButtonElement);
        e.preventDefault();
        buttons[(i + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
      }
    });
    rootEl.appendChild(scrim);
    edit.focus(); // safe default, never the raw send
  });
  return _modal;
}
