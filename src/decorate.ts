import { App, MarkdownPostProcessorContext, TFile } from "obsidian";
import type { Bubble, BubbleState } from "./types";
import { parseBubbles } from "./parse";
import { deriveStates } from "./state";
import { enqueue, cancel, retry, reply, listQueueIds } from "./enqueue";

export function makeDecorator(app: App) {
  return async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const callouts = el.querySelectorAll<HTMLElement>(
      '.callout[data-callout="for-claude"], .callout[data-callout="from-claude"]',
    );
    if (callouts.length === 0) return;

    const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) return;

    const raw = await app.vault.cachedRead(file);
    const bubbles = parseBubbles(raw);
    const queueCtx = listQueueIds(app);
    const states = deriveStates(bubbles, queueCtx);

    const section = ctx.getSectionInfo(el);
    if (!section) return;

    const sectionStart = section.lineStart + 1;
    const sectionEnd = section.lineEnd + 1;

    const sectionBubbles = bubbles.filter(
      (b) => b.lineStart >= sectionStart && b.lineEnd <= sectionEnd,
    );

    callouts.forEach((calloutEl, index) => {
      const b = sectionBubbles[index];
      if (!b) return;
      const state = states.get(b)!;
      decorateCallout(calloutEl, b, state, {
        onAsk: () => enqueue(app, file, b),
        onCancel: () => cancel(app, file, b),
        onRetry: () => retry(app, file, b),
        onReply: () => reply(app, file, b),
      });
    });
  };
}

interface Handlers {
  onAsk: () => Promise<void>;
  onCancel: () => Promise<void>;
  onRetry: () => Promise<void>;
  onReply: () => Promise<void>;
}

function decorateCallout(
  el: HTMLElement,
  bubble: Bubble,
  state: BubbleState,
  handlers: Handlers,
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
    replyBtn.addEventListener("click", handlers.onReply);
    chrome.appendChild(replyBtn);
    el.appendChild(chrome);
    return;
  }

  switch (state) {
    case "fresh": {
      const btn = document.createElement("button");
      btn.className = "ai-integration-ask";
      btn.textContent = "ASK CLAUDE";
      btn.addEventListener("click", handlers.onAsk);
      chrome.appendChild(btn);
      break;
    }
    case "queued": {
      const chip = document.createElement("span");
      chip.className = "ai-integration-chip-queued";
      chip.textContent = "Queued…";
      chrome.appendChild(chip);
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "ai-integration-cancel";
      cancelBtn.textContent = "cancel";
      cancelBtn.addEventListener("click", handlers.onCancel);
      chrome.appendChild(cancelBtn);
      break;
    }
    case "lost": {
      const chip = document.createElement("span");
      chip.className = "ai-integration-chip-lost";
      chip.textContent = "Lost";
      chrome.appendChild(chip);
      const retryBtn = document.createElement("button");
      retryBtn.className = "ai-integration-retry";
      retryBtn.textContent = "retry";
      retryBtn.addEventListener("click", handlers.onRetry);
      chrome.appendChild(retryBtn);
      break;
    }
    case "answered":
      return;
  }

  el.appendChild(chrome);
}
