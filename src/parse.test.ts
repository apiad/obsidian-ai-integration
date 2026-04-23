import { describe, it, expect } from "vitest";
import { parseBubbles } from "./parse";

describe("parseBubbles", () => {
  it("parses a fresh for-claude bubble with no id", () => {
    const src = [
      "# Doc",
      "",
      "> [!for-claude]",
      "> What do you think?",
      "",
      "more content",
    ].join("\n");
    const bubbles = parseBubbles(src);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]).toMatchObject({
      kind: "for-claude",
      id: null,
      lineStart: 3,
      lineEnd: 4,
      idMarkerLine: null,
      body: "What do you think?",
    });
  });

  it("parses a for-claude bubble with a following id marker", () => {
    const src = [
      "> [!for-claude]",
      "> prompt line 1",
      "> prompt line 2",
      "<!-- claude-id: abc-123 -->",
      "",
    ].join("\n");
    const bubbles = parseBubbles(src);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]).toMatchObject({
      kind: "for-claude",
      id: "abc-123",
      lineStart: 1,
      lineEnd: 3,
      idMarkerLine: 4,
      body: "prompt line 1\nprompt line 2",
    });
  });

  it("parses a from-claude bubble with a response marker", () => {
    const src = [
      "> [!from-claude]",
      "> my response",
      "<!-- claude-id-response: abc-123 -->",
    ].join("\n");
    const bubbles = parseBubbles(src);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]).toMatchObject({
      kind: "from-claude",
      id: "abc-123",
      body: "my response",
    });
  });

  it("parses a paired for/from-claude conversation", () => {
    const src = [
      "> [!for-claude]",
      "> what's 2+2",
      "<!-- claude-id: q1 -->",
      "",
      "> [!from-claude]",
      "> four",
      "<!-- claude-id-response: q1 -->",
    ].join("\n");
    const bubbles = parseBubbles(src);
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0].kind).toBe("for-claude");
    expect(bubbles[0].id).toBe("q1");
    expect(bubbles[1].kind).toBe("from-claude");
    expect(bubbles[1].id).toBe("q1");
  });

  it("ignores callouts of other types", () => {
    const src = [
      "> [!note]",
      "> unrelated",
      "",
      "> [!for-claude]",
      "> ask",
    ].join("\n");
    const bubbles = parseBubbles(src);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].kind).toBe("for-claude");
  });

  it("does not attach a marker separated by blank line", () => {
    const src = [
      "> [!for-claude]",
      "> ask",
      "",
      "<!-- claude-id: detached -->",
    ].join("\n");
    const bubbles = parseBubbles(src);
    expect(bubbles[0].id).toBeNull();
    expect(bubbles[0].idMarkerLine).toBeNull();
  });

  it("handles case-insensitive callout names", () => {
    const src = [
      "> [!For-Claude]",
      "> ask",
    ].join("\n");
    const bubbles = parseBubbles(src);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].kind).toBe("for-claude");
  });

  it("attaches an in-reply-to marker on the line above a for-claude opener", () => {
    const src = [
      "> [!from-claude]",
      "> earlier answer",
      "<!-- claude-id-response: parent-1 -->",
      "",
      "<!-- claude-in-reply-to: parent-1 -->",
      "> [!for-claude]",
      "> follow-up question",
      "<!-- claude-id: child-1 -->",
    ].join("\n");
    const bubbles = parseBubbles(src);
    expect(bubbles).toHaveLength(2);
    const child = bubbles[1];
    expect(child.kind).toBe("for-claude");
    expect(child.inReplyTo).toBe("parent-1");
    expect(child.inReplyToMarkerLine).toBe(5);
    expect(child.id).toBe("child-1");
  });

  it("does not attach an in-reply-to marker to from-claude bubbles", () => {
    const src = [
      "<!-- claude-in-reply-to: nope -->",
      "> [!from-claude]",
      "> hi",
    ].join("\n");
    const bubbles = parseBubbles(src);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].kind).toBe("from-claude");
    expect(bubbles[0].inReplyTo).toBeNull();
  });

  it("leaves inReplyTo null when no marker precedes a for-claude opener", () => {
    const src = [
      "> [!for-claude]",
      "> standalone",
    ].join("\n");
    const bubbles = parseBubbles(src);
    expect(bubbles[0].inReplyTo).toBeNull();
    expect(bubbles[0].inReplyToMarkerLine).toBeNull();
  });

  it("ignores lines that look like callouts inside a code block", () => {
    const src = [
      "```",
      "> [!for-claude]",
      "> not real",
      "```",
    ].join("\n");
    const bubbles = parseBubbles(src);
    expect(bubbles).toHaveLength(0);
  });
});
