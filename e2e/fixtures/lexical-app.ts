/**
 * Fixture "Lexical chat site" (like perplexity.ai): a Lexical rich-text editor
 * whose Enter command is registered at boot at high priority and POSTs the
 * editor's text to /api/send. Tests assert on what was SENT.
 */
import { createEditor, $getRoot, KEY_ENTER_COMMAND, COMMAND_PRIORITY_HIGH, $createParagraphNode } from 'lexical';
import { registerRichText } from '@lexical/rich-text';

const root = document.getElementById('lexical-root') as HTMLElement;
const editor = createEditor({ namespace: 'fixture', onError: (e) => { throw e; } });
editor.setRootElement(root);
registerRichText(editor);

editor.registerCommand(
  KEY_ENTER_COMMAND,
  (e: KeyboardEvent | null) => {
    if (e?.shiftKey) return false;
    e?.preventDefault();
    let text = '';
    editor.getEditorState().read(() => { text = $getRoot().getTextContent(); });
    if (text.trim()) {
      void fetch('/api/send', { method: 'POST', body: text });
      editor.update(() => { const r = $getRoot(); r.clear(); r.append($createParagraphNode()); });
    }
    return true;
  },
  COMMAND_PRIORITY_HIGH,
);
