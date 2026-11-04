/**
 * Inline UI components injected into the page by the content script.
 * All styles are scoped under a shadow DOM root to avoid CSS conflicts.
 */

import type { Detection } from '../detection/types';

// ---------------------------------------------------------------------------
// Shadow host setup (shared)
// ---------------------------------------------------------------------------

/** Id of the shadow host; the send guard ignores events that originate here. */
export const UI_HOST_ID = 'pii-airlock-ui';

let _shadowHost: HTMLElement | null = null;
let _shadowRoot: ShadowRoot | null = null;

function getShadowRoot(): ShadowRoot {
  if (_shadowRoot) return _shadowRoot;

  _shadowHost = document.createElement('div');
  _shadowHost.id = UI_HOST_ID;
  _shadowHost.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;pointer-events:none;';
  document.body.appendChild(_shadowHost);

  _shadowRoot = _shadowHost.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; font-family: system-ui, sans-serif; }

    .pii-banner {
      position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
      background: #fff; border: 2px solid #f59e0b; border-radius: 10px;
      padding: 12px 16px; box-shadow: 0 4px 20px rgba(0,0,0,.18);
      display: flex; align-items: center; gap: 12px;
      min-width: 320px; max-width: 500px; pointer-events: all;
      animation: slideUp .2s ease;
    }
    @keyframes slideUp { from { opacity:0; transform: translateX(-50%) translateY(8px); } to { opacity:1; transform: translateX(-50%) translateY(0); } }

    .pii-banner.high { border-color: #ef4444; }
    .pii-banner .icon { font-size: 20px; flex-shrink: 0; }
    .pii-banner .body { flex: 1; }
    .pii-banner .title { font-weight: 700; font-size: 13px; margin-bottom: 2px; color: #1f2937; }
    .pii-banner .detail { font-size: 12px; color: #6b7280; }
    .pii-banner .actions { display: flex; gap: 6px; flex-shrink: 0; }
    .pii-banner button { border: none; border-radius: 6px; padding: 5px 10px; font-size: 12px; cursor: pointer; font-weight: 600; }
    .btn-scrub  { background: #3b82f6; color: #fff; }
    .btn-scrub:hover  { background: #2563eb; }
    .btn-edit   { background: #e5e7eb; color: #374151; }
    .btn-edit:hover   { background: #d1d5db; }
    .btn-send   { background: #f3f4f6; color: #6b7280; font-size: 11px; }
    .btn-send:hover   { background: #e5e7eb; }

    .pii-pill {
      position: fixed; bottom: 80px; right: 20px;
      background: #3b82f6; color: #fff; border-radius: 20px;
      padding: 6px 14px; font-size: 12px; font-weight: 600;
      box-shadow: 0 2px 8px rgba(0,0,0,.2); pointer-events: all;
      cursor: pointer; animation: fadeIn .2s ease;
    }
    @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }

    .pii-modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,.45);
      display: flex; align-items: center; justify-content: center;
      pointer-events: all; animation: fadeIn .15s ease;
    }
    .pii-modal {
      background: #fff; border-radius: 12px; padding: 24px;
      max-width: 400px; width: 90%; box-shadow: 0 8px 32px rgba(0,0,0,.22);
    }
    .pii-modal h2 { margin: 0 0 8px; font-size: 16px; color: #1f2937; }
    .pii-modal p  { margin: 0 0 16px; font-size: 13px; color: #6b7280; }
    .pii-modal .entity-list { margin: 0 0 20px; padding: 0; list-style: none; }
    .pii-modal .entity-list li {
      display: flex; align-items: center; gap: 8px;
      padding: 4px 0; font-size: 13px; color: #374151;
    }
    .pii-modal .entity-list li .badge {
      background: #fee2e2; color: #991b1b; border-radius: 4px;
      padding: 1px 6px; font-size: 11px; font-weight: 700;
    }
    .pii-modal .actions { display: flex; gap: 8px; justify-content: flex-end; }
    .pii-modal button { border: none; border-radius: 7px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .btn-modal-scrub { background: #3b82f6; color: #fff; }
    .btn-modal-edit  { background: #e5e7eb; color: #374151; }
    .btn-modal-raw   { background: transparent; color: #991b1b; text-decoration: underline; }
    button:focus-visible { outline: 2px solid #1d4ed8; outline-offset: 2px; }
  `;
  _shadowRoot.appendChild(style);
  return _shadowRoot;
}

// ---------------------------------------------------------------------------
// Banner (warn decisions, and paste warnings)
// ---------------------------------------------------------------------------

let _banner: HTMLElement | null = null;
let _bannerResolve: ((a: BannerAction) => void) | null = null;

export type BannerAction = 'scrub' | 'edit' | 'send';

/**
 * Non-modal banner. Resolves with the user's choice; resolves 'edit' when
 * replaced or dismissed, so a caller awaiting it is never left hanging.
 * `context: 'paste'` shows "Scrub now / Dismiss" (there is no send to confirm).
 */
export function showBanner(
  detections: Detection[],
  isHigh: boolean,
  context: 'send' | 'paste' = 'send',
): Promise<BannerAction> {
  dismissBanner();
  const root = getShadowRoot();

  const banner = document.createElement('div');
  banner.className = `pii-banner${isHigh ? ' high' : ''}`;
  banner.setAttribute('role', 'alert');

  const entities = [...new Set(detections.map((d) => d.entityType))].join(', ');
  const paste = context === 'paste';

  const icon = el('span', 'icon', isHigh ? '\u{1F534}' : '\u26A0\uFE0F');
  const body = el('div', 'body');
  body.append(
    el('div', 'title', paste ? 'Pasted text contains PII' : 'PII detected before sending'),
    el('div', 'detail', entities),
  );
  const actions = el('div', 'actions');

  return new Promise<BannerAction>((resolve) => {
    const done = (a: BannerAction) => { dismissBanner(); resolve(a); };
    _bannerResolve = resolve;
    actions.append(
      button('btn-scrub', paste ? 'Scrub now' : 'Auto-scrub & send', () => done('scrub')),
      button('btn-edit', paste ? 'Dismiss' : 'Edit', () => done('edit')),
    );
    if (!paste && !isHigh) actions.append(button('btn-send', 'Send anyway', () => done('send')));
    banner.append(icon, body, actions);
    root.appendChild(banner);
    _banner = banner;
  });
}

export function isBannerOpen(): boolean {
  return _banner !== null;
}

export function dismissBanner(): void {
  _banner?.remove();
  _banner = null;
  const r = _bannerResolve;
  _bannerResolve = null;
  r?.('edit');
}

// ---------------------------------------------------------------------------
// Pill (post-send status)
// ---------------------------------------------------------------------------

let _pill: HTMLElement | null = null;

/**
 * `scrubbed`: values were replaced before sending.
 * `noticed`: values were detected but NOT changed (policy allowed them through).
 */
export function showPill(count: number, kind: 'scrubbed' | 'noticed' = 'scrubbed'): void {
  dismissPill();
  const root = getShadowRoot();
  const pill = document.createElement('div');
  pill.className = 'pii-pill';
  const s = count !== 1 ? 's' : '';
  pill.textContent = kind === 'scrubbed'
    ? `\u{1F512} ${count} item${s} scrubbed`
    : `\u2139\uFE0F ${count} possible item${s} noticed, sent as is`;
  pill.title = kind === 'scrubbed'
    ? 'PII was replaced with tokens before sending'
    : 'Policy allowed these through unchanged';
  pill.addEventListener('click', dismissPill);
  root.appendChild(pill);
  _pill = pill;
  setTimeout(dismissPill, 4000);
}

export function dismissPill(): void {
  _pill?.remove();
  _pill = null;
}

// ---------------------------------------------------------------------------
// Modal (block decisions and real failures)
// ---------------------------------------------------------------------------

/**
 * detected     – PII found, scrub offered.
 * scrub-failed – a scrub was attempted but the editor did not commit it. No
 *                scrub button: retrying cannot help, the user must edit.
 * error        – detection itself failed; nothing is known about the text.
 *                Scrubbing is meaningless; only Edit or an explicit raw send.
 */
export type ModalKind = 'detected' | 'scrub-failed' | 'error';
export type ModalAction = 'scrub' | 'edit' | 'send-unscanned';

let _modal: Promise<ModalAction> | null = null;

/** One modal at a time: a repeat call returns the open one's promise. */
export function showModal(kind: ModalKind, detections: Detection[]): Promise<ModalAction> {
  if (_modal) return _modal;
  const root = getShadowRoot();
  const previous = document.activeElement as HTMLElement | null;

  const overlay = el('div', 'pii-modal-overlay');
  const box = el('div', 'pii-modal');
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-modal', 'true');

  const copy = {
    detected: ['Sensitive data detected', 'Your message appears to contain personal data. Review before sending.'],
    'scrub-failed': ['Could not scrub this message', 'The editor did not accept the replacement, so the message was NOT sent. Edit it by hand to remove the highlighted values.'],
    error: ['Could not check this message', 'Detection failed, so nothing is known about this text. The message was NOT sent.'],
  }[kind];
  const h2 = el('h2', undefined, copy[0]!);
  h2.id = 'pii-modal-title';
  box.setAttribute('aria-labelledby', 'pii-modal-title');
  box.append(h2, el('p', undefined, copy[1]!));

  if (detections.length > 0) {
    const ul = el('ul', 'entity-list');
    for (const t of new Set(detections.map((d) => d.entityType))) {
      const li = document.createElement('li');
      li.append(el('span', 'badge', t), document.createTextNode(summarize(detections, t)));
      ul.appendChild(li);
    }
    box.appendChild(ul);
  }

  const actions = el('div', 'actions');
  box.appendChild(actions);
  overlay.appendChild(box);

  _modal = new Promise<ModalAction>((resolve) => {
    const finish = (a: ModalAction) => {
      overlay.remove();
      _modal = null;
      previous?.focus?.();
      resolve(a);
    };
    const buttons: HTMLButtonElement[] = [];
    if (kind === 'error') {
      buttons.push(button('btn-modal-raw', 'Send unscanned', () => finish('send-unscanned')));
    }
    if (kind === 'detected') {
      buttons.push(button('btn-modal-scrub', 'Auto-scrub & send', () => finish('scrub')));
    }
    const edit = button('btn-modal-edit', 'Edit message', () => finish('edit'));
    buttons.push(edit);
    actions.append(...buttons);

    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish('edit'); return; }
      if (e.key === 'Tab') {
        const i = buttons.indexOf(root.activeElement as HTMLButtonElement);
        const next = e.shiftKey ? (i <= 0 ? buttons.length - 1 : i - 1) : (i + 1) % buttons.length;
        e.preventDefault();
        buttons[next]?.focus();
      }
    });
    root.appendChild(overlay);
    // Focus the safe default (Edit), never a destructive/raw action.
    edit.focus();
  });
  return _modal;
}

function summarize(detections: Detection[], entityType: string): string {
  const count = detections.filter((d) => d.entityType === entityType).length;
  return count > 1 ? ` \u00D7${count}` : '';
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
