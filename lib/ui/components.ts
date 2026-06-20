/**
 * Inline UI components injected into the page by the content script.
 * All styles are scoped under a shadow DOM root to avoid CSS conflicts.
 */

import type { Detection } from '../detection/types';
import type { Decision } from '../detection/types';

// ---------------------------------------------------------------------------
// Shadow host setup (shared)
// ---------------------------------------------------------------------------

let _shadowHost: HTMLElement | null = null;
let _shadowRoot: ShadowRoot | null = null;

function getShadowRoot(): ShadowRoot {
  if (_shadowRoot) return _shadowRoot;

  _shadowHost = document.createElement('div');
  _shadowHost.id = 'pii-airlock-ui';
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
  `;
  _shadowRoot.appendChild(style);
  return _shadowRoot;
}

// ---------------------------------------------------------------------------
// Banner (warn decisions)
// ---------------------------------------------------------------------------

let _banner: HTMLElement | null = null;

export interface BannerResult {
  action: 'scrub' | 'edit' | 'send';
}

export function showBanner(
  detections: Detection[],
  isHigh: boolean,
  onAction: (r: BannerResult) => void,
): void {
  dismissBanner();
  const root = getShadowRoot();

  const banner = document.createElement('div');
  banner.className = `pii-banner${isHigh ? ' high' : ''}`;

  const entities = [...new Set(detections.map((d) => d.entityType))].join(', ');

  banner.innerHTML = `
    <span class="icon">${isHigh ? '🔴' : '⚠️'}</span>
    <div class="body">
      <div class="title">PII detected before sending</div>
      <div class="detail">${entities}</div>
    </div>
    <div class="actions">
      <button class="btn-scrub">Auto-scrub &amp; send</button>
      <button class="btn-edit">Edit</button>
      ${!isHigh ? '<button class="btn-send">Send anyway</button>' : ''}
    </div>
  `;

  banner.querySelector('.btn-scrub')?.addEventListener('click', () => { dismissBanner(); onAction({ action: 'scrub' }); });
  banner.querySelector('.btn-edit')?.addEventListener('click', () => { dismissBanner(); onAction({ action: 'edit' }); });
  banner.querySelector('.btn-send')?.addEventListener('click', () => { dismissBanner(); onAction({ action: 'send' }); });

  root.appendChild(banner);
  _banner = banner;
}

export function dismissBanner(): void {
  _banner?.remove();
  _banner = null;
}

// ---------------------------------------------------------------------------
// Pill (auto_scrub confirmation)
// ---------------------------------------------------------------------------

let _pill: HTMLElement | null = null;

export function showPill(count: number): void {
  dismissPill();
  const root = getShadowRoot();
  const pill = document.createElement('div');
  pill.className = 'pii-pill';
  pill.textContent = `🔒 ${count} item${count !== 1 ? 's' : ''} scrubbed`;
  pill.title = 'PII was automatically replaced with tokens before sending';
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
// Modal (block decisions)
// ---------------------------------------------------------------------------

export interface ModalResult {
  action: 'scrub' | 'edit';
}

export function showModal(
  detections: Detection[],
  onAction: (r: ModalResult) => void,
): void {
  const root = getShadowRoot();

  const overlay = document.createElement('div');
  overlay.className = 'pii-modal-overlay';

  const entityItems = [...new Set(detections.map((d) => d.entityType))]
    .map((t) => `<li><span class="badge">${t}</span>${summarize(detections, t)}</li>`)
    .join('');

  overlay.innerHTML = `
    <div class="pii-modal">
      <h2>🔴 Sensitive data detected</h2>
      <p>Your message appears to contain personal data. Review before sending.</p>
      <ul class="entity-list">${entityItems}</ul>
      <div class="actions">
        <button class="btn-modal-scrub">Auto-scrub &amp; send</button>
        <button class="btn-modal-edit">Edit message</button>
      </div>
    </div>
  `;

  overlay.querySelector('.btn-modal-scrub')?.addEventListener('click', () => { overlay.remove(); onAction({ action: 'scrub' }); });
  overlay.querySelector('.btn-modal-edit')?.addEventListener('click', () => { overlay.remove(); onAction({ action: 'edit' }); });

  root.appendChild(overlay);
}

function summarize(detections: Detection[], entityType: string): string {
  const count = detections.filter((d) => d.entityType === entityType).length;
  return count > 1 ? ` ×${count}` : '';
}
