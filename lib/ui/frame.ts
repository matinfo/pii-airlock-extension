/**
 * Finds the visible "pill" around a chat composer: the box the user sees as the
 * input field, which the status tab attaches to. Pure DOM reads, so it can be
 * unit-tested in happy-dom.
 *
 * The editable itself is rarely the pill: sites wrap it in several layers, and
 * some of those inner wrappers are rounded and filled too (Gemini). The pill is
 * told apart by holding the composer's own controls (+, mic, send).
 */

const MAX_DEPTH = 10;

function transparent(color: string): boolean {
  return !color || color === 'transparent' || /rgba?\([^)]*[,/]\s*0(\.0+)?\s*\)$/.test(color);
}

function decorated(cs: CSSStyleDeclaration): boolean {
  return (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none')
    || !transparent(cs.backgroundColor)
    || (!!cs.boxShadow && cs.boxShadow !== 'none');
}

/** A button that belongs to the pill (not to rich content inside the editor). */
function hasOwnButton(n: HTMLElement, composer: HTMLElement): boolean {
  for (const b of n.querySelectorAll('button, [role="button"]')) {
    if (!composer.contains(b)) return true;
  }
  return false;
}

function commonAncestor(a: HTMLElement, b: HTMLElement): HTMLElement | null {
  for (let n: HTMLElement | null = a; n; n = n.parentElement) if (n.contains(b)) return n;
  return null;
}

/**
 * First ancestor of `composer` that is decorated (border, fill or shadow),
 * rounded (radius >= 8), holds a button outside the composer, and is not a
 * page-level card (>90% of the viewport width). Fallbacks: the lowest common
 * ancestor of composer and send button, the form, the composer.
 */
export function findFrame(composer: HTMLElement, sendButton?: HTMLElement | null): HTMLElement {
  return locateFrame(composer, sendButton).frame;
}

/** Same as findFrame; `matched` is false when a fallback was used (pill may still be mounting). */
export function locateFrame(composer: HTMLElement, sendButton?: HTMLElement | null): { frame: HTMLElement; matched: boolean } {
  const maxW = (globalThis.innerWidth || 0) * 0.9;
  let n: HTMLElement | null = composer.parentElement;
  for (let i = 0; n && n !== document.body && i < MAX_DEPTH; i++, n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (!decorated(cs) || parseFloat(cs.borderTopLeftRadius) < 8) continue;
    const w = n.getBoundingClientRect().width;
    if (maxW > 0 && w > maxW) break; // past the pill: page-level card
    if (hasOwnButton(n, composer)) return { frame: n, matched: true };
  }
  if (sendButton) {
    const lca = commonAncestor(composer, sendButton);
    if (lca && lca !== document.body && lca !== document.documentElement) return { frame: lca, matched: false };
  }
  return { frame: composer.closest('form') ?? composer, matched: false };
}
