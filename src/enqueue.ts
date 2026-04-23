import { App, Notice, TFile, normalizePath } from "obsidian";
import type { Bubble } from "./types";

const QUEUE_DIR = "+/ai-queue";

function timestampId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts =
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds());
  const rand = Math.random().toString(36).slice(2, 8);
  return `claude-${ts}-${rand}`;
}

function isoNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const tzMin = -d.getTimezoneOffset();
  const sign = tzMin >= 0 ? "+" : "-";
  const abs = Math.abs(tzMin);
  const tz = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${tz}`
  );
}

async function ensureQueueDir(app: App): Promise<void> {
  const dir = normalizePath(QUEUE_DIR);
  if (!app.vault.getAbstractFileByPath(dir)) {
    await app.vault.createFolder(dir);
  }
}

function queuePath(id: string): string {
  return normalizePath(`${QUEUE_DIR}/${id}.md`);
}

function queueBody(id: string, sourcePath: string, prompt: string): string {
  return [
    "---",
    "type: ai-queue",
    `id: ${id}`,
    `source_path: "${sourcePath}"`,
    `created: ${isoNow()}`,
    "status: pending",
    "---",
    "",
    "## Prompt",
    "",
    prompt,
    "",
  ].join("\n");
}

export async function enqueue(
  app: App,
  sourceFile: TFile,
  bubble: Bubble,
): Promise<void> {
  if (bubble.kind !== "for-claude") return;
  if (bubble.id) {
    new Notice("Already queued.");
    return;
  }

  await ensureQueueDir(app);

  const id = timestampId();
  const qp = queuePath(id);

  if (app.vault.getAbstractFileByPath(qp)) {
    new Notice("Queue file collision; try again.");
    return;
  }

  await app.vault.create(qp, queueBody(id, sourceFile.path, bubble.body));

  try {
    await insertIdMarker(app, sourceFile, bubble, id);
  } catch (err) {
    const qf = app.vault.getAbstractFileByPath(qp);
    if (qf instanceof TFile) await app.vault.delete(qf);
    throw err;
  }

  new Notice("Queued for Claude.");
}

async function insertIdMarker(
  app: App,
  file: TFile,
  bubble: Bubble,
  id: string,
): Promise<void> {
  const raw = await app.vault.read(file);
  const lines = raw.split("\n");
  const insertAt = bubble.lineEnd;
  const marker = `<!-- claude-id: ${id} -->`;
  lines.splice(insertAt, 0, marker);
  await app.vault.modify(file, lines.join("\n"));
}

export async function cancel(
  app: App,
  sourceFile: TFile,
  bubble: Bubble,
): Promise<void> {
  if (!bubble.id) return;
  const qp = queuePath(bubble.id);
  const qf = app.vault.getAbstractFileByPath(qp);
  if (qf instanceof TFile) await app.vault.delete(qf);
  await removeIdMarker(app, sourceFile, bubble);
  new Notice("Request cancelled.");
}

export async function retry(
  app: App,
  sourceFile: TFile,
  bubble: Bubble,
): Promise<void> {
  if (!bubble.id) return;
  await ensureQueueDir(app);
  const qp = queuePath(bubble.id);
  if (app.vault.getAbstractFileByPath(qp)) {
    new Notice("Already queued.");
    return;
  }
  await app.vault.create(qp, queueBody(bubble.id, sourceFile.path, bubble.body));
  new Notice("Retrying.");
}

async function removeIdMarker(
  app: App,
  file: TFile,
  bubble: Bubble,
): Promise<void> {
  if (bubble.idMarkerLine == null) return;
  const raw = await app.vault.read(file);
  const lines = raw.split("\n");
  lines.splice(bubble.idMarkerLine - 1, 1);
  await app.vault.modify(file, lines.join("\n"));
}

export async function reply(
  app: App,
  sourceFile: TFile,
  parentBubble: Bubble,
): Promise<void> {
  if (parentBubble.kind !== "from-claude") return;
  if (!parentBubble.id) {
    new Notice("Cannot reply: parent bubble has no id.");
    return;
  }

  const raw = await app.vault.read(sourceFile);
  const lines = raw.split("\n");

  // Insert right after the response's id marker if present, else after the
  // last `>` line of the from-claude callout.
  const insertAt =
    parentBubble.idMarkerLine != null
      ? parentBubble.idMarkerLine
      : parentBubble.lineEnd;

  const snippet = [
    "",
    `<!-- claude-in-reply-to: ${parentBubble.id} -->`,
    "> [!for-claude]",
    "> ",
    "",
  ];

  lines.splice(insertAt, 0, ...snippet);
  await app.vault.modify(sourceFile, lines.join("\n"));
  new Notice("Reply bubble inserted.");
}

export function listQueueIds(app: App): { pendingIds: Set<string>; processedIds: Set<string> } {
  const pending = new Set<string>();
  const processed = new Set<string>();

  const pendingDir = app.vault.getAbstractFileByPath(QUEUE_DIR);
  if (pendingDir && "children" in pendingDir) {
    for (const child of (pendingDir as any).children) {
      if (child instanceof TFile && child.extension === "md") {
        pending.add(child.basename);
      }
    }
  }

  const processedDir = app.vault.getAbstractFileByPath(`${QUEUE_DIR}/processed`);
  if (processedDir && "children" in processedDir) {
    for (const child of (processedDir as any).children) {
      if (child instanceof TFile && child.extension === "md") {
        processed.add(child.basename);
      }
    }
  }

  return { pendingIds: pending, processedIds: processed };
}
