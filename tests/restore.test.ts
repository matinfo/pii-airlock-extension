/**
 * Page restorer: tokens become real values in place, composers are never touched.
 * Driven through happy-dom (MutationObserver + TreeWalker are supported).
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { BrowserMapping } from '../lib/mapping';

let startRestore: typeof import('../lib/restore').startRestore;
let restoreTree: typeof import('../lib/restore').restoreTree;

beforeAll(async () => {
  GlobalRegistrator.register();
  ({ startRestore, restoreTree } = await import('../lib/restore'));
});
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => { document.body.innerHTML = ''; });

const frames = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise<void>((r) => requestAnimationFrame(() => r()));
};

function mapped() {
  const m = new BrowserMapping();
  m.tokenFor('PERSON', 'Jean Dupont');
  m.tokenFor('EMAIL_ADDRESS', 'jane@example.com');
  return m;
}

test('restores tokens in place without replacing or wrapping nodes', () => {
  const m = mapped();
  document.body.innerHTML = '<p id="a">Hi &lt;PERSON_1&gt;, write to &lt;EMAIL_ADDRESS_1&gt;.</p>';
  const p = document.getElementById('a')!;
  const text = p.firstChild!;
  expect(restoreTree(document.body, m)).toBe(1);
  expect(p.textContent).toBe('Hi Jean Dupont, write to jane@example.com.');
  expect(p.firstChild).toBe(text);
  expect(p.childNodes.length).toBe(1);
});

test('leaves unknown tokens alone', () => {
  document.body.innerHTML = '<p>&lt;PERSON_9&gt;</p>';
  restoreTree(document.body, mapped());
  expect(document.body.textContent).toBe('<PERSON_9>');
});

test('never rewrites editable areas or textareas', () => {
  const m = mapped();
  document.body.innerHTML =
    '<div id="ce" contenteditable="true">&lt;PERSON_1&gt;</div><textarea id="ta">&lt;PERSON_1&gt;</textarea>';
  // happy-dom may not compute isContentEditable; set it the way browsers expose it.
  const ce = document.getElementById('ce')!;
  Object.defineProperty(ce, 'isContentEditable', { value: true });
  restoreTree(document.body, m);
  expect(ce.textContent).toBe('<PERSON_1>');
  expect((document.getElementById('ta') as HTMLTextAreaElement).value).toBe('<PERSON_1>');
});

test('restores streamed text as it arrives, including re-written text nodes', async () => {
  const m = mapped();
  const p = document.createElement('p');
  document.body.append(p);
  const stop = startRestore(m);
  const node = document.createTextNode('Hello <PERS');
  p.append(node);
  await frames();
  expect(p.textContent).toBe('Hello <PERS'); // incomplete token: untouched
  node.nodeValue = 'Hello <PERSON_1>';
  await frames();
  expect(p.textContent).toBe('Hello Jean Dupont');
  // A framework writes the token back on its next render: restored again.
  node.nodeValue = 'Hello <PERSON_1> and <EMAIL_ADDRESS_1>';
  await frames();
  expect(p.textContent).toBe('Hello Jean Dupont and jane@example.com');
  stop();
});

test('rescans the page when a token is minted after the text appeared', async () => {
  const m = new BrowserMapping();
  document.body.innerHTML = '<p>&lt;PERSON_1&gt;</p>';
  const stop = startRestore(m);
  await frames();
  expect(document.body.textContent).toBe('<PERSON_1>');
  m.tokenFor('PERSON', 'Jean Dupont');
  await frames();
  expect(document.body.textContent).toBe('Jean Dupont');
  stop();
});
