/**
 * Show real values on the page in place of our tokens.
 *
 * Display only: the page's own state, what was sent, and the model's context all
 * keep the tokens. Text nodes are edited in place (`nodeValue`), never replaced or
 * wrapped, so React/streaming re-renders keep working; when a framework writes the
 * token back, the mutation fires again and we restore it again.
 *
 * Selector-free on purpose (adapters are fragile): the whole page is watched, minus
 * editable areas, so a user's own draft is never rewritten.
 */
import type { BrowserMapping } from './mapping';

const QUICK = /[<[][A-Z][A-Z0-9_]*_\d+[>\]]/;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'NOSCRIPT']);

function excluded(node: Node): boolean {
  for (let n: Node | null = node; n; n = n.parentNode) {
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const el = n as HTMLElement;
    if (SKIP_TAGS.has(el.tagName) || el.isContentEditable) return true;
  }
  return false;
}

export function restoreTextNode(node: Node, mapping: BrowserMapping): boolean {
  const text = node.nodeValue;
  if (!text || !QUICK.test(text) || excluded(node)) return false;
  const out = mapping.restore(text);
  if (out === text) return false;
  node.nodeValue = out;
  return true;
}

/** Restore every text node under `root` (or `root` itself if it is one). */
export function restoreTree(root: Node, mapping: BrowserMapping): number {
  if (root.nodeType === Node.TEXT_NODE) return restoreTextNode(root, mapping) ? 1 : 0;
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n = 0;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (restoreTextNode(t, mapping)) n++;
  }
  return n;
}

/** Watch `root` and restore tokens as they appear. Returns a stop function. */
export function startRestore(mapping: BrowserMapping, root: Node = document.body): () => void {
  const pending = new Set<Node>();
  let scheduled = 0;

  const flush = () => {
    scheduled = 0;
    const batch = [...pending];
    pending.clear();
    if (mapping.size === 0) return;
    for (const node of batch) if (node.isConnected) restoreTree(node, mapping);
  };
  const queue = (node: Node) => {
    pending.add(node);
    if (!scheduled) scheduled = requestAnimationFrame(flush);
  };

  const observer = new MutationObserver((records) => {
    if (mapping.size === 0) return;
    for (const r of records) {
      if (r.type === 'characterData') queue(r.target);
      else r.addedNodes.forEach(queue);
    }
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });

  // New tokens can be minted after content is already on the page (a reload that
  // restored the mapping late, or a second send): rescan once the mapping grows.
  let seen = mapping.size;
  const prev = mapping.onChange;
  mapping.onChange = () => {
    prev?.();
    if (mapping.size !== seen) {
      seen = mapping.size;
      queue(root);
    }
  };

  queue(root);
  return () => {
    observer.disconnect();
    if (scheduled) cancelAnimationFrame(scheduled);
    mapping.onChange = prev;
  };
}
