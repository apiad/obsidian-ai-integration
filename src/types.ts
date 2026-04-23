export type BubbleKind = "for-claude" | "from-claude";

export type BubbleState = "fresh" | "queued" | "answered" | "lost";

export interface Bubble {
  kind: BubbleKind;
  id: string | null;
  /** 1-based line number where the callout starts (the `> [!...]` line). */
  lineStart: number;
  /** 1-based line number of the last `>` line of the callout. */
  lineEnd: number;
  /** 1-based line number of the `<!-- claude-id: ... -->` marker, if present. */
  idMarkerLine: number | null;
  /**
   * ID of the `from-claude` bubble this `for-claude` bubble is replying to,
   * if a `<!-- claude-in-reply-to: <id> -->` marker sits on the line
   * immediately above the callout opener. Always null for `from-claude`.
   */
  inReplyTo: string | null;
  /**
   * 1-based line number of the `<!-- claude-in-reply-to: ... -->` marker,
   * if present.
   */
  inReplyToMarkerLine: number | null;
  /** The body text of the callout, stripped of leading `> ` prefixes, joined by \n. */
  body: string;
}

export interface QueueContext {
  /** IDs with a pending file in `+/ai-queue/`. */
  pendingIds: Set<string>;
  /** IDs with a file in `+/ai-queue/processed/`. */
  processedIds: Set<string>;
}
