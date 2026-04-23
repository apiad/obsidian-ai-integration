import { Editor, MarkdownView } from "obsidian";

export function insertForClaudePrompt(editor: Editor, _view: MarkdownView): void {
  const snippet = "\n> [!for-claude]\n> \n";
  const cursor = editor.getCursor();
  editor.replaceRange(snippet, cursor);
  editor.setCursor({ line: cursor.line + 2, ch: 2 });
}
