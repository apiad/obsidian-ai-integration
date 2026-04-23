import type { Bubble, BubbleState, QueueContext } from "./types";

export function deriveStates(
  bubbles: Bubble[],
  queue: QueueContext,
): Map<Bubble, BubbleState> {
  const result = new Map<Bubble, BubbleState>();

  const fromIds = new Set<string>();
  for (const b of bubbles) {
    if (b.kind === "from-claude" && b.id) fromIds.add(b.id);
  }

  for (const b of bubbles) {
    if (b.kind === "from-claude") {
      result.set(b, "answered");
      continue;
    }

    if (!b.id) {
      result.set(b, "fresh");
      continue;
    }

    if (fromIds.has(b.id)) {
      result.set(b, "answered");
      continue;
    }

    if (queue.pendingIds.has(b.id)) {
      result.set(b, "queued");
      continue;
    }

    result.set(b, "lost");
  }

  return result;
}
