/** M365 Copilot path gate: m365.cloud.microsoft is matched host-wide, adapter only acts on /chat. */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { test, expect, beforeAll, afterAll } from 'bun:test';

let copilotAdapter: typeof import('../../lib/adapters/copilot').copilotAdapter;
beforeAll(async () => {
  GlobalRegistrator.register({ url: 'https://m365.cloud.microsoft/' });
  ({ copilotAdapter } = await import('../../lib/adapters/copilot'));
});
afterAll(() => GlobalRegistrator.unregister());

const COMPOSER = `<div><div id="m365-chat-editor-target-element" role="textbox" contenteditable="true"><p><br></p></div>
<button aria-label="Send" type="button"></button></div>`;

test('M365 home: inert even with a contenteditable textbox present', () => {
  history.pushState({}, '', '/');
  document.body.innerHTML = COMPOSER;
  expect(copilotAdapter.isChatPage!()).toBe(false);
  expect(copilotAdapter.findComposer()).toBeNull();
});

test('M365 search-like path is not /chat', () => {
  history.pushState({}, '', '/chatter');
  expect(copilotAdapter.isChatPage!()).toBe(false);
});

test('SPA nav to /chat: finds the M365 Copilot composer', () => {
  history.pushState({}, '', '/');
  document.body.innerHTML = COMPOSER;
  history.pushState({}, '', '/chat');
  expect(copilotAdapter.isChatPage!()).toBe(true);
  expect(copilotAdapter.findComposer()?.id).toBe('m365-chat-editor-target-element');
  history.pushState({}, '', '/chat/abc123');
  expect(copilotAdapter.findComposer()?.id).toBe('m365-chat-editor-target-element');
});

test('copilot.microsoft.com is not path-gated', () => {
  history.pushState({}, '', '/'); // would be gated on m365
  const loc = { hostname: 'copilot.microsoft.com', pathname: '/' };
  const spy = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { value: loc, configurable: true });
  try {
    expect(copilotAdapter.isChatPage!()).toBe(true);
  } finally {
    if (spy) Object.defineProperty(globalThis, 'location', spy);
  }
});
