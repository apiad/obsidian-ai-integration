import { describe, it, expect } from "vitest";
import { deriveStates } from "./state";
import type { Bubble } from "./types";

function bubble(partial: Partial<Bubble> & { kind: Bubble["kind"] }): Bubble {
  return {
    kind: partial.kind,
    id: partial.id ?? null,
    lineStart: partial.lineStart ?? 1,
    lineEnd: partial.lineEnd ?? 1,
    idMarkerLine: partial.idMarkerLine ?? null,
    inReplyTo: partial.inReplyTo ?? null,
    inReplyToMarkerLine: partial.inReplyToMarkerLine ?? null,
    body: partial.body ?? "",
  };
}

describe("deriveStates", () => {
  it("fresh: for-claude with no id", () => {
    const bubbles = [bubble({ kind: "for-claude" })];
    const states = deriveStates(bubbles, { pendingIds: new Set(), processedIds: new Set() });
    expect(states.get(bubbles[0])).toBe("fresh");
  });

  it("queued: for-claude with id present in pendingIds and no paired response", () => {
    const b = bubble({ kind: "for-claude", id: "x1" });
    const states = deriveStates([b], {
      pendingIds: new Set(["x1"]),
      processedIds: new Set(),
    });
    expect(states.get(b)).toBe("queued");
  });

  it("answered: for-claude with id and a matching from-claude", () => {
    const q = bubble({ kind: "for-claude", id: "x2" });
    const a = bubble({ kind: "from-claude", id: "x2" });
    const states = deriveStates([q, a], {
      pendingIds: new Set(),
      processedIds: new Set(["x2"]),
    });
    expect(states.get(q)).toBe("answered");
  });

  it("lost: for-claude has id, no queue entry, no response", () => {
    const b = bubble({ kind: "for-claude", id: "x3" });
    const states = deriveStates([b], {
      pendingIds: new Set(),
      processedIds: new Set(),
    });
    expect(states.get(b)).toBe("lost");
  });

  it("from-claude bubbles always return 'answered'", () => {
    const a = bubble({ kind: "from-claude", id: "x4" });
    const states = deriveStates([a], {
      pendingIds: new Set(),
      processedIds: new Set(["x4"]),
    });
    expect(states.get(a)).toBe("answered");
  });

  it("answered takes priority over pendingIds (queue + response both present)", () => {
    const q = bubble({ kind: "for-claude", id: "x5" });
    const a = bubble({ kind: "from-claude", id: "x5" });
    const states = deriveStates([q, a], {
      pendingIds: new Set(["x5"]),
      processedIds: new Set(),
    });
    expect(states.get(q)).toBe("answered");
  });
});
