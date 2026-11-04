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
  await fetch('/api/send', { method: 'POST', body: text });
  view.updateState(EditorState.create({ schema, plugins: view.state.plugins }));
}

const mount = document.getElementById('editor')!;
const view: EditorView = new EditorView(mount, {
  state: EditorState.create({
    schema,
    plugins: [
      keymap({
        Enter: () => { void send(view); return true; },
        'Mod-Enter': () => { void send(view); return true; },
      }),
      keymap(baseKeymap),
    ],
  }),
  attributes: { id: 'prompt-textarea' },
});
document.getElementById('send')!.addEventListener('click', () => void send(view));

// Test hooks
(window as unknown as { __pm: EditorView }).__pm = view;
