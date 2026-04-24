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

    // `<!-- claude-in-reply-to: ... -->` threading marker. Primary form is
    // INSIDE the callout body (prefixed with `> ` on the first body line) so
    // Obsidian hides it as an HTML comment. For back-compat we also detect
    // the legacy placement: a bare marker on the line immediately above the
    // opener. Only applies to for-claude.
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
      const stripped = stripBlockquote(lines[i]);
      if (
        kind === "for-claude" &&
        inReplyTo == null &&
        bodyLines.length === 0
      ) {
        const inside = stripped.match(IN_REPLY_TO_MARKER);
        if (inside) {
          inReplyTo = inside[1];
          inReplyToMarkerLine = i + 1;
          lineEnd = i + 1;
          i++;
          continue;
        }
      }
      bodyLines.push(stripped);
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
