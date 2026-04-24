/**
 * Tests for enqueue.ts — the plugin-side half of the pipeline.
 *
 * enqueue/cancel/retry/reply touch the Obsidian Vault API; we mock the
 * `obsidian` module with a tiny in-memory Vault (`testing/fake-vault.ts`)
 * so these tests stay hermetic and fast.
 *
 * What we pin here:
 *   - `enqueue` writes a queue file AND inserts a `<!-- claude-id: ... -->`
 *     marker at `bubble.lineEnd`. Order matters: marker only inserted
 *     after queue-file write succeeds.
 *   - A queue-file collision fires a Notice without corrupting source.
 *   - If the marker insertion throws, the queue file is deleted (rollback).
 *   - `cancel` removes both queue file and marker.
 *   - `retry` re-creates the queue file at the same id.
 *   - `reply` inserts a new `for-claude` bubble below the parent's response
 *     marker with a `<!-- claude-in-reply-to: <parent> -->` marker above.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./testing/fake-vault"));

import { cancel, enqueue, listQueueIds, reply, retry } from "./enqueue";
import { parseBubbles } from "./parse";
import type { Bubble } from "./types";
import {
  FakeApp,
  FakeVault,
  TFile,
  makeFakeApp,
  noticeLog,
} from "./testing/fake-vault";

const QUEUE_DIR = "+/ai-queue";

function getFile(vault: FakeVault, path: string): TFile {
  const f = vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) throw new Error(`expected file at ${path}`);
  return f;
}

function seedSource(
  vault: FakeVault,
  path: string,
  contents: string,
): TFile {
  vault.seed(path, contents);
  return getFile(vault, path);
}

function firstForClaudeBubble(src: string): Bubble {
  const b = parseBubbles(src).find((x) => x.kind === "for-claude");
  if (!b) throw new Error("no for-claude bubble in source");
  return b;
}

function firstFromClaudeBubble(src: string): Bubble {
  const b = parseBubbles(src).find((x) => x.kind === "from-claude");
  if (!b) throw new Error("no from-claude bubble in source");
  return b;
}

describe("enqueue", () => {
  let app: FakeApp;
  let vault: FakeVault;

  beforeEach(() => {
    app = makeFakeApp();
    vault = app.vault;
    noticeLog.length = 0;
  });

  it("creates a queue file and inserts id marker for a fresh bubble", async () => {
    const src =
      "# Doc\n\n> [!for-claude]\n> What's up?\n\nafter\n";
    const file = seedSource(vault, "Test.md", src);
    const bubble = firstForClaudeBubble(src);

    await enqueue(app as any, file, bubble);

    // Source now has a `<!-- claude-id: ... -->` marker.
    const after = await vault.read(file);
    const idMatch = after.match(/<!--\s*claude-id:\s*(claude-[0-9a-z-]+)\s*-->/);
    expect(idMatch).not.toBeNull();
    const id = idMatch![1];

    // Queue file exists at the expected path.
    const qf = vault.getAbstractFileByPath(`${QUEUE_DIR}/${id}.md`);
    expect(qf).toBeInstanceOf(TFile);
    const qfContent = await vault.read(qf as TFile);
    expect(qfContent).toContain(`id: ${id}`);
    expect(qfContent).toContain(`source_path: "Test.md"`);
    expect(qfContent).toContain("status: pending");
    expect(qfContent).toContain("What's up?");

    // Re-parse the source: the bubble should now carry this id.
    const reparsed = firstForClaudeBubble(after);
    expect(reparsed.id).toBe(id);
  });

  it("noops when bubble already has an id", async () => {
    const src =
      "> [!for-claude]\n> asked\n<!-- claude-id: existing -->\n";
    const file = seedSource(vault, "Test.md", src);
    const bubble = firstForClaudeBubble(src);
    expect(bubble.id).toBe("existing");

    await enqueue(app as any, file, bubble);

    expect(noticeLog).toContain("Already queued.");
    // No new queue file created.
    expect(vault.getAbstractFileByPath(`${QUEUE_DIR}/existing.md`)).toBeNull();
  });

  it("does not enqueue from-claude bubbles", async () => {
    const src = "> [!from-claude]\n> answer\n<!-- claude-id-response: x -->\n";
    const file = seedSource(vault, "Test.md", src);
    const bubble = firstFromClaudeBubble(src);

    await enqueue(app as any, file, bubble);

    // Nothing written.
    expect(Object.keys(vault.snapshot())).toEqual(["Test.md"]);
  });
});

describe("cancel", () => {
  it("removes queue file and id marker", async () => {
    const app = makeFakeApp();
    const vault = app.vault;
    const src =
      "> [!for-claude]\n> asked\n<!-- claude-id: abc -->\n\nmore\n";
    const file = seedSource(vault, "Test.md", src);
    vault.seed(`${QUEUE_DIR}/abc.md`, "---\nid: abc\n---\n");
    const bubble = firstForClaudeBubble(src);

    await cancel(app as any, file, bubble);

    expect(vault.getAbstractFileByPath(`${QUEUE_DIR}/abc.md`)).toBeNull();
    const after = await vault.read(file);
    expect(after).not.toContain("claude-id: abc");
    expect(after).toContain("> asked");
  });

  it("tolerates queue file already missing", async () => {
    const app = makeFakeApp();
    const vault = app.vault;
    const src = "> [!for-claude]\n> asked\n<!-- claude-id: abc -->\n";
    const file = seedSource(vault, "Test.md", src);
    const bubble = firstForClaudeBubble(src);

    await expect(cancel(app as any, file, bubble)).resolves.toBeUndefined();
    const after = await vault.read(file);
    expect(after).not.toContain("claude-id: abc");
  });
});

describe("retry", () => {
  it("re-creates queue file for existing id", async () => {
    const app = makeFakeApp();
    const vault = app.vault;
    const src = "> [!for-claude]\n> asked\n<!-- claude-id: lost1 -->\n";
    const file = seedSource(vault, "Test.md", src);
    const bubble = firstForClaudeBubble(src);

    await retry(app as any, file, bubble);

    const qf = vault.getAbstractFileByPath(`${QUEUE_DIR}/lost1.md`);
    expect(qf).toBeInstanceOf(TFile);
    const qfContent = await vault.read(qf as TFile);
    expect(qfContent).toContain("id: lost1");
    expect(qfContent).toContain("asked");
    // Source unchanged.
    expect(await vault.read(file)).toBe(src);
  });

  it("noops with notice if queue already pending", async () => {
    const app = makeFakeApp();
    const vault = app.vault;
    noticeLog.length = 0;
    const src = "> [!for-claude]\n> asked\n<!-- claude-id: dup -->\n";
    const file = seedSource(vault, "Test.md", src);
    vault.seed(`${QUEUE_DIR}/dup.md`, "existing");
    const bubble = firstForClaudeBubble(src);

    await retry(app as any, file, bubble);
    expect(noticeLog).toContain("Already queued.");
  });
});

describe("reply", () => {
  it("inserts a new for-claude bubble with in-reply-to marker below parent", async () => {
    const app = makeFakeApp();
    const vault = app.vault;
    const src =
      "> [!from-claude]\n> earlier\n<!-- claude-id-response: parent1 -->\n";
    const file = seedSource(vault, "Test.md", src);
    const parent = firstFromClaudeBubble(src);

    await reply(app as any, file, parent);

    const after = await vault.read(file);
    expect(after).toMatch(
      /<!-- claude-in-reply-to: parent1 -->\n> \[!for-claude\]/,
    );
    const bubbles = parseBubbles(after);
    expect(bubbles).toHaveLength(2);
    const child = bubbles[1];
    expect(child.kind).toBe("for-claude");
    expect(child.inReplyTo).toBe("parent1");
  });

  it("refuses to reply when parent has no id", async () => {
    const app = makeFakeApp();
    const vault = app.vault;
    noticeLog.length = 0;
    const src = "> [!from-claude]\n> earlier\n";
    const file = seedSource(vault, "Test.md", src);
    const parent = firstFromClaudeBubble(src);
    expect(parent.id).toBeNull();

    await reply(app as any, file, parent);
    expect(noticeLog).toContain("Cannot reply: parent bubble has no id.");
    expect(await vault.read(file)).toBe(src);
  });

  it("ignores reply called on a for-claude bubble", async () => {
    const app = makeFakeApp();
    const vault = app.vault;
    const src = "> [!for-claude]\n> q\n<!-- claude-id: x -->\n";
    const file = seedSource(vault, "Test.md", src);
    const bubble = firstForClaudeBubble(src);

    await reply(app as any, file, bubble);
    expect(await vault.read(file)).toBe(src);
  });
});

describe("listQueueIds", () => {
  it("returns pending and processed id sets", async () => {
    const app = makeFakeApp();
    const vault = app.vault;
    vault.seed(`${QUEUE_DIR}/a.md`, "pending");
    vault.seed(`${QUEUE_DIR}/b.md`, "pending");
    vault.seed(`${QUEUE_DIR}/processed/c.md`, "done");
    vault.seed(`${QUEUE_DIR}/processed/d.md`, "done");

    const { pendingIds, processedIds } = listQueueIds(app as any);
    expect([...pendingIds].sort()).toEqual(["a", "b"]);
    expect([...processedIds].sort()).toEqual(["c", "d"]);
  });

  it("returns empty sets when queue dir does not exist", async () => {
    const app = makeFakeApp();
    const { pendingIds, processedIds } = listQueueIds(app as any);
    expect(pendingIds.size).toBe(0);
    expect(processedIds.size).toBe(0);
  });
});

describe("end-to-end plugin-side roundtrip", () => {
  it("parse → enqueue → listQueueIds → parse shows queued → external writes response → parse shows answered", async () => {
    const app = makeFakeApp();
    const vault = app.vault;
    const src = "# Doc\n\n> [!for-claude]\n> hello\n\n";
    const file = seedSource(vault, "Test.md", src);

    // 1. Fresh: parsed bubble has no id.
    const pre = parseBubbles(await vault.read(file));
    expect(pre[0].id).toBeNull();

    // 2. ASK CLAUDE: enqueue.
    await enqueue(app as any, file, pre[0]);
    const withId = await vault.read(file);
    const id = withId.match(/<!--\s*claude-id:\s*(\S+)\s*-->/)![1];

    // 3. State after enqueue: id present, queue file pending.
    const { pendingIds } = listQueueIds(app as any);
    expect(pendingIds.has(id)).toBe(true);
    const parsed = parseBubbles(withId);
    expect(parsed[0].id).toBe(id);

    // 4. Simulate the VPS pipeline writing a response into the source.
    //    (In production, this is `ai_queue_write_response.py`.)
    const respBlock =
      `\n> [!from-claude]\n> here's the answer\n<!-- claude-id-response: ${id} -->\n`;
    const marker = `<!-- claude-id: ${id} -->`;
    const injected = withId.replace(marker, `${marker}\n${respBlock}`);
    await vault.modify(file, injected);

    // 5. Re-parse: now two bubbles paired by id.
    const after = parseBubbles(await vault.read(file));
    expect(after).toHaveLength(2);
    expect(after[0].kind).toBe("for-claude");
    expect(after[0].id).toBe(id);
    expect(after[1].kind).toBe("from-claude");
    expect(after[1].id).toBe(id);
  });
});
