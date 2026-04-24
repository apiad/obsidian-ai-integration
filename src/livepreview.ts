import { App, MarkdownView, Plugin, TFile } from "obsidian";
import type { Bubble, BubbleState } from "./types";
import { parseBubbles } from "./parse";
import { deriveStates } from "./state";
import { enqueue, cancel, retry, reply, listQueueIds } from "./enqueue";

const SELECTOR =
  '.markdown-source-view .callout[data-callout="for-claude"], ' +
  '.markdown-source-view .callout[data-callout="from-claude"]';

export class LivePreviewDecorator {
  private observer?: MutationObserver;

  constructor(private app: App) {}

  start(plugin: Plugin): void {
    // When Obsidian reloads the plugin (disable+enable, or Hot Reload),
    // callouts in the live DOM may still carry data-ai-state / chrome
    // from the previous instance. Clear that stale state before scanning,
    // otherwise decorateOne's short-circuit skips every bubble and no
    // buttons render until the user triggers a view rerender.
    this.stripDecorations(document.body);
    this.scan(document.body);

    this.observer = new MutationObserver((mutations) => {
      const seen = new Set<HTMLElement>();
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) this.collect(node, seen);
        });
        if (m.type === "attributes" && m.target instanceof HTMLElement) {
          this.collect(m.target, seen);
        }
      }
      seen.forEach((el) => this.decorateOne(el));
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-callout"],
    });

    plugin.register(() => {
      this.observer?.disconnect();
      this.stripDecorations(document.body);
    });
  }

  private stripDecorations(root: ParentNode): void {
    root.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
      delete el.dataset.aiState;
      delete el.dataset.aiInReplyTo;
      el.classList.remove(
        "ai-integration-bubble",
        "ai-integration-for-claude",
        "ai-integration-from-claude",
      );
      el.querySelectorAll(".ai-integration-chrome").forEach((n) => n.remove());
    });
  }

  private collect(root: HTMLElement, seen: Set<HTMLElement>): void {
    if (typeof root.matches === "function" && root.matches(SELECTOR)) {
      seen.add(root);
    }
    root
      .querySelectorAll<HTMLElement>(SELECTOR)
      .forEach((el) => seen.add(el));
  }

  private scan(root: ParentNode): void {
    root
      .querySelectorAll<HTMLElement>(SELECTOR)
      .forEach((el) => this.decorateOne(el));
  }

  rescan(): void {
    this.stripDecorations(document.body);
    document
      .querySelectorAll<HTMLElement>(SELECTOR)
      .forEach((el) => this.decorateOne(el));
  }

  private decorateOne(el: HTMLElement): void {
    if (el.dataset.aiState) return;

    const view = this.findContainingView(el);
    if (!view || !view.file) return;

    const file = view.file;
    const cmView: any = (view.editor as any).cm;
    if (!cmView || typeof cmView.posAtDOM !== "function") return;

    let pos: number;
    try {
      pos = cmView.posAtDOM(el);
    } catch {
      return;
    }
    const calloutLine = view.editor.offsetToPos(pos).line + 1;

    this.app.vault.cachedRead(file).then((raw) => {
      if (!el.isConnected) return;

      const bubbles = parseBubbles(raw);
      let bubble = bubbles.find((b) => b.lineStart === calloutLine);
      if (!bubble) {
        bubble = bubbles
          .slice()
          .sort(
            (a, b) =>
              Math.abs(a.lineStart - calloutLine) -
              Math.abs(b.lineStart - calloutLine),
          )[0];
      }
      if (!bubble) return;

      const queueCtx = listQueueIds(this.app);
      const state = deriveStates(bubbles, queueCtx).get(bubble)!;

      this.applyDecoration(el, bubble, state, file);
    });
  }

  private applyDecoration(
    el: HTMLElement,
    bubble: Bubble,
    state: BubbleState,
    file: TFile,
  ): void {
    el.classList.add("ai-integration-bubble");
    el.classList.add(`ai-integration-${bubble.kind}`);
    el.setAttribute("data-ai-state", state);
    if (bubble.inReplyTo) {
      el.setAttribute("data-ai-in-reply-to", bubble.inReplyTo);
    }

    el.querySelectorAll(".ai-integration-chrome").forEach((n) => n.remove());

    const chrome = document.createElement("div");
    chrome.className = "ai-integration-chrome";

    if (bubble.kind === "from-claude") {
      if (!bubble.id) return;
      const replyBtn = document.createElement("button");
      replyBtn.className = "ai-integration-reply";
      replyBtn.textContent = "↩ Reply";
      replyBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await reply(this.app, file, bubble);
      });
      chrome.appendChild(replyBtn);
      el.appendChild(chrome);
      return;
    }

    if (state === "fresh") {
      const btn = document.createElement("button");
      btn.className = "ai-integration-ask";
      btn.textContent = "ASK CLAUDE";
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await enqueue(this.app, file, bubble);
      });
      chrome.appendChild(btn);
    } else if (state === "queued") {
      const chip = document.createElement("span");
      chip.className = "ai-integration-chip-queued";
      chip.textContent = "Queued…";
      chrome.appendChild(chip);
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "ai-integration-cancel";
      cancelBtn.textContent = "cancel";
      cancelBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await cancel(this.app, file, bubble);
      });
      chrome.appendChild(cancelBtn);
    } else if (state === "lost") {
      const chip = document.createElement("span");
      chip.className = "ai-integration-chip-lost";
      chip.textContent = "Lost";
      chrome.appendChild(chip);
      const retryBtn = document.createElement("button");
      retryBtn.className = "ai-integration-retry";
      retryBtn.textContent = "retry";
      retryBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await retry(this.app, file, bubble);
      });
      chrome.appendChild(retryBtn);
    } else {
      return;
    }

    el.appendChild(chrome);
  }

  private findContainingView(el: HTMLElement): MarkdownView | null {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const view = leaf.view as MarkdownView;
      if (view?.contentEl?.contains(el)) return view;
    }
    return null;
  }
}
