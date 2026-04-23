import { MarkdownView, Plugin } from "obsidian";
import { makeDecorator } from "./decorate";
import { LivePreviewDecorator } from "./livepreview";
import { insertForClaudePrompt } from "./commands";

export default class AiIntegrationPlugin extends Plugin {
  async onload() {
    this.registerMarkdownPostProcessor(makeDecorator(this.app));

    new LivePreviewDecorator(this.app).start(this);

    this.addRibbonIcon("message-square-plus", "Insert for-claude prompt", () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view) insertForClaudePrompt(view.editor, view);
    });

    this.addCommand({
      id: "insert-for-claude",
      name: "Insert for-claude prompt",
      editorCallback: (editor, view) => {
        if (view instanceof MarkdownView) insertForClaudePrompt(editor, view);
      },
    });
  }

  async onunload() {}
}
