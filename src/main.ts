import { MarkdownView, Plugin, TAbstractFile, TFile } from "obsidian";
import { makeDecorator } from "./decorate";
import { LivePreviewDecorator } from "./livepreview";
import { insertForClaudePrompt } from "./commands";

const QUEUE_DIR = "+/ai-queue";
const REFRESH_DEBOUNCE_MS = 150;

export default class AiIntegrationPlugin extends Plugin {
  private livePreview?: LivePreviewDecorator;
  private refreshTimer: number | null = null;

  async onload() {
    this.registerMarkdownPostProcessor(makeDecorator(this.app));

    this.livePreview = new LivePreviewDecorator(this.app);
    this.livePreview.start(this);

    this.registerEvent(this.app.vault.on("create", (f) => this.onVaultEvent(f)));
    this.registerEvent(this.app.vault.on("delete", (f) => this.onVaultEvent(f)));
    this.registerEvent(
      this.app.vault.on("rename", (f, oldPath) => this.onVaultEvent(f, oldPath)),
    );
    this.registerEvent(this.app.vault.on("modify", (f) => this.onVaultEvent(f)));

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

  async onunload() {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
  }

  private onVaultEvent(file: TAbstractFile, oldPath?: string): void {
    if (this.isRelevant(file.path) || (oldPath && this.isRelevant(oldPath))) {
      this.scheduleRefresh();
    }
  }

  private isRelevant(path: string): boolean {
    if (!path.endsWith(".md")) return false;
    if (path.startsWith(QUEUE_DIR + "/")) return true;
    return this.isPathOpen(path);
  }

  private isPathOpen(path: string): boolean {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const view = leaf.view as MarkdownView;
      if (view?.file?.path === path) return true;
    }
    return false;
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refreshAll();
    }, REFRESH_DEBOUNCE_MS);
  }

  private refreshAll(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view as MarkdownView;
      view.previewMode?.rerender(true);
    }
    this.livePreview?.rescan();
  }
}
