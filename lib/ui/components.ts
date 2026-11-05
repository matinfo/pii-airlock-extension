/**
 * In-page UI: a chip docked to the composer, a review panel, a post-send toast
 * and a modal for real failures. Everything lives in a closed shadow root and
 * is built with textContent only (values are user data, never HTML). Colours,
 * font and radius are sampled from the host page (see theme.ts), so the UI
 * reads as part of each chat instead of a foreign overlay.
 */

import { t, entityLabel } from '../i18n';
import { applyTheme, sampleTheme } from './theme';

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

.chip {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px 0 8px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 999px;
  font-size: 12px; font-weight: 500; font-variant-numeric: tabular-nums;
}
.chip:hover { background: var(--hover); }
.chip.muted { color: var(--muted); }
.chip svg { width: 15px; height: 15px; flex: none; }

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
  .panel, .toast, .chip { animation: in .12s ease-out; }
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
  host.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;';
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
// Shield: chip + panel + toast, anchored to the composer
// ---------------------------------------------------------------------------

export interface ChipState {
  items: PanelItem[];
  notices: PanelItem[];
  mode: 'auto' | 'review';
  paused: boolean;
}

type PanelMode = 'live' | 'review' | 'after';

class Shield {
  private chip: HTMLElement | null = null;
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
    this.closePanel('cancel');
    this.chip?.remove(); this.chip = null;
    this.toastEl?.remove(); this.toastEl = null;
  }

  // -- chip -----------------------------------------------------------------

  render(state: ChipState, keepPanel = false): void {
    this.state = state;
    const visible = state.paused || state.items.length > 0 || state.notices.length > 0;
    if (!visible) { this.chip?.remove(); this.chip = null; this.closePanel('cancel', true); return; }
    const a = this.anchor?.();
    if (!a) { this.chip?.remove(); this.chip = null; return; }

    const root = shell();
    if (!this.chip) {
      this.chip = el('button', 'float chip');
      (this.chip as HTMLButtonElement).type = 'button';
      this.chip.addEventListener('click', (e) => {
        e.stopPropagation();
        this.panel ? this.closePanel('cancel') : this.openLive();
      });
      root.appendChild(this.chip);
    }
    const n = state.items.filter((i) => i.checked).length;
    this.chip.classList.toggle('muted', state.paused || n === 0);
    this.chip.replaceChildren(icon(state.paused ? 'pause' : 'shield'));
    const label = state.paused
      ? t('chipPaused')
      : n > 0
        ? t(state.mode === 'review' ? 'chipReview' : 'chipReplace', n)
        : t('chipNoticed');
    this.chip.append(document.createTextNode(label));
    this.chip.setAttribute('aria-label', `${t('appName')}: ${label}`);
    this.chip.setAttribute('aria-haspopup', 'dialog');
    this.chip.setAttribute('aria-expanded', String(!!this.panel));
    this.schedule();
    if (this.panelMode === 'live' && !keepPanel) this.buildPanel();
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
    this.chip?.setAttribute('aria-expanded', 'false');
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
    this.chip?.setAttribute('aria-expanded', 'true');
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
    if (!a) return;
    retheme(a.composer, a.sendButton);
    const r = a.composer.closest('form')?.getBoundingClientRect() ?? a.composer.getBoundingClientRect();
    const vw = innerWidth, vh = innerHeight;
    const gap = 8;
    const chipH = 28;
    if (this.chip) {
      const w = this.chip.offsetWidth;
      const top = Math.max(gap, r.top - chipH - gap);
      const left = Math.min(Math.max(gap, r.right - w - 4), vw - w - gap);
      Object.assign(this.chip.style, { top: `${top}px`, left: `${left}px` });
    }
    if (this.panel) {
      const w = this.panel.offsetWidth;
      const left = Math.min(Math.max(gap, r.right - w - 4), vw - w - gap);
      const chipTop = this.chip ? parseFloat(this.chip.style.top) : r.top - chipH - gap;
      const above = chipTop - gap;
      const below = vh - r.bottom - 2 * gap;
      // Prefer above the composer (chat boxes sit at the bottom); flip when the
      // composer is near the top of the viewport.
      const up = above >= Math.min(this.panel.scrollHeight, 460) || above >= below;
      this.panel.style.maxHeight = `${Math.max(160, Math.min(460, (up ? above : below) - gap))}px`;
      Object.assign(this.panel.style, up
        ? { left: `${left}px`, bottom: `${vh - chipTop + 6}px`, top: 'auto' }
        : { left: `${left}px`, top: `${r.bottom + gap}px`, bottom: 'auto' });
    }
    if (this.toastEl) {
      const w = this.toastEl.offsetWidth;
      const left = Math.min(Math.max(gap, r.left + (r.width - w) / 2), vw - w - gap);
      const h = this.toastEl.offsetHeight;
      Object.assign(this.toastEl.style, r.top - h - gap >= 0
        ? { left: `${left}px`, bottom: `${vh - r.top + gap}px`, top: 'auto' }
        : { left: `${left}px`, top: `${r.bottom + gap}px`, bottom: 'auto' });
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
