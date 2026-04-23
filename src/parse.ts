import type { Bubble, BubbleKind } from "./types";

const CALLOUT_OPEN = /^>\s*\[!(for-claude|from-claude)\]/i;
const ID_MARKER = /^<!--\s*claude-id:\s*(\S+)\s*-->$/;
const ID_RESPONSE_MARKER = /^<!--\s*claude-id-response:\s*(\S+)\s*-->$/;
const IN_REPLY_TO_MARKER = /^<!--\s*claude-in-reply-to:\s*(\S+)\s*-->$/;
const CODE_FENCE = /^```/;

export function parseBubbles(src: string): Bubble[] {
  const lines = src.split("\n");
  const bubbles: Bubble[] = [];
  let inFence = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (CODE_FENCE.test(line)) {
      inFence = !inFence;
      i++;
      continue;
    }
    if (inFence) {
      i++;
      continue;
    }

    const open = line.match(CALLOUT_OPEN);
    if (!open) {
      i++;
      continue;
    }

    const kind = open[1].toLowerCase() as BubbleKind;
    const lineStart = i + 1;
    const bodyLines: string[] = [];
    let lineEnd = lineStart;

    // Look back one line for a `<!-- claude-in-reply-to: ... -->` marker
    // directly above this `[!for-claude]` opener. Only applies to for-claude.
    let inReplyTo: string | null = null;
    let inReplyToMarkerLine: number | null = null;
    if (kind === "for-claude" && i > 0) {
      const reply = lines[i - 1].match(IN_REPLY_TO_MARKER);
      if (reply) {
        inReplyTo = reply[1];
        inReplyToMarkerLine = i;
      }
    }

    i++;
    while (i < lines.length && lines[i].startsWith(">")) {
      bodyLines.push(stripBlockquote(lines[i]));
      lineEnd = i + 1;
      i++;
    }

    let id: string | null = null;
    let idMarkerLine: number | null = null;
    if (i < lines.length) {
      const marker = kind === "for-claude"
        ? lines[i].match(ID_MARKER)
        : lines[i].match(ID_RESPONSE_MARKER);
      if (marker) {
        id = marker[1];
        idMarkerLine = i + 1;
        i++;
      }
    }

    bubbles.push({
      kind,
      id,
      lineStart,
      lineEnd,
      idMarkerLine,
      inReplyTo,
      inReplyToMarkerLine,
      body: bodyLines.join("\n").trim(),
    });
  }

  return bubbles;
}

function stripBlockquote(line: string): string {
  return line.replace(/^>\s?/, "");
}
