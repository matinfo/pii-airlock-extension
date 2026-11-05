/**
 * Fixture "chat site": a real ProseMirror composer whose Enter handler and send
 * button are registered at page boot (before the content script), exactly like
 * production sites. Sending POSTs the document text to /api/send, which the test
 * records. Tests assert on what was SENT, never on the DOM.
 */
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Schema } from 'prosemirror-model';
import { schema as basic } from 'prosemirror-schema-basic';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';

const schema = new Schema({ nodes: basic.spec.nodes, marks: basic.spec.marks });

function docText(view: EditorView): string {
  return view.state.doc.textBetween(0, view.state.doc.content.size, '\n');
}

async function send(view: EditorView) {
  const text = docText(view);
  if (!text.trim()) return;
  // Clear first, like real chat UIs (optimistic): clearing after the fetch
  // resolves leaves the old text in the box on a slow runner, and a repeat
  // Enter then legitimately sends it again (A8 flake).
  view.updateState(EditorState.create({ schema, plugins: view.state.plugins }));
  await fetch('/api/send', { method: 'POST', body: text });
}

function makeView(): EditorView {
  const mount = document.getElementById('editor')!;
  mount.innerHTML = '';
  const v: EditorView = new EditorView(mount, {
    state: EditorState.create({
      schema,
      plugins: [
        keymap({
          Enter: () => { void send(v); return true; },
          'Mod-Enter': () => { void send(v); return true; },
        }),
        keymap(baseKeymap),
      ],
    }),
    attributes: { id: 'prompt-textarea' },
  });
  return v;
}

let view = makeView();
document.getElementById('send')!.addEventListener('click', () => void send(view));

// An "edit previous message" box: separate editable, own Enter-to-send handler.
const edit = document.getElementById('edit') as HTMLTextAreaElement;
edit.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void fetch('/api/send', { method: 'POST', body: edit.value });
  }
});

// Test hooks
const w = window as unknown as { __remount: () => void };
// SPA remount: the whole composer is replaced (as on route change / re-render).
w.__remount = () => { view.destroy(); view = makeView(); };
