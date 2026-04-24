/**
 * Cross-language end-to-end test.
 *
 * The plugin (TypeScript) and the VPS pipeline (Python) don't share code, only
 * a markdown contract: the plugin writes a `<!-- claude-id: <id> -->` marker,
 * the Python writer (`ai_queue_write_response.py`) injects a `[!from-claude]`
 * callout + `<!-- claude-id-response: <id> -->` marker below. This test spawns
 * the real Python script, lets it mutate a real source file, then feeds that
 * file through the real TS parser and asserts the result is what the plugin
 * expects ("answered" bubble, paired by id).
 *
 * Guards against silent drift in the markdown contract between halves.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseBubbles } from "./parse";
import { deriveStates } from "./state";

const WRITER_PATH = resolve(
  __dirname,
  "../../../.claude/scripts/ai_queue_write_response.py",
);

function hasPython(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function hasYaml(): boolean {
  try {
    execFileSync("python3", ["-c", "import yaml"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("pipeline cross-language e2e", () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(resolve(tmpdir(), "ai-queue-e2e-"));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("python writer produces markdown the ts parser reads as answered", () => {
    if (!existsSync(WRITER_PATH)) return; // writer not checked out, skip
    if (!hasPython() || !hasYaml()) return; // runtime missing, skip

    const workspace = scratch;
    const vault = resolve(workspace, "vault");
    const queueDir = resolve(vault, "+/ai-queue");
    mkdirSync(queueDir, { recursive: true });

    const entryId = "claude-test-e2e-xyz";
    const sourceRel = "Note.md";
    const sourcePath = resolve(vault, sourceRel);
    const source = [
      "# Test Note",
      "",
      "> [!for-claude]",
      "> What is 2+2?",
      "<!-- claude-id: " + entryId + " -->",
      "",
      "trailing paragraph",
      "",
    ].join("\n");
    writeFileSync(sourcePath, source, "utf8");

    const queueFile = resolve(queueDir, entryId + ".md");
    const queueBody = [
      "---",
      "type: ai-queue",
      "id: " + entryId,
      'source_path: "' + sourceRel + '"',
      "created: 2026-04-24T04:00:00-04:00",
      "status: pending",
      "---",
      "",
      "## Prompt",
      "",
      "What is 2+2?",
      "",
    ].join("\n");
    writeFileSync(queueFile, queueBody, "utf8");

    const responseFile = resolve(scratch, "response.txt");
    const responseBody = [
      "Four. Sources:",
      "",
      "- arithmetic",
      "- counting",
    ].join("\n");
    writeFileSync(responseFile, responseBody, "utf8");

    execFileSync("python3", [WRITER_PATH, queueFile, responseFile], {
      env: { ...process.env, CLAUDE_WORKSPACE: workspace },
      stdio: ["ignore", "ignore", "pipe"],
    });

    // Queue file moved to processed/.
    expect(existsSync(queueFile)).toBe(false);
    expect(existsSync(resolve(queueDir, "processed", entryId + ".md"))).toBe(
      true,
    );

    const mutated = readFileSync(sourcePath, "utf8");

    // Contract: response block sits below the id marker with the response
    // marker at its tail.
    expect(mutated).toContain("> [!from-claude]");
    expect(mutated).toContain(
      "<!-- claude-id-response: " + entryId + " -->",
    );

    // TS parser sees two bubbles, paired by id, and state derives "answered".
    const bubbles = parseBubbles(mutated);
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0].kind).toBe("for-claude");
    expect(bubbles[0].id).toBe(entryId);
    expect(bubbles[1].kind).toBe("from-claude");
    expect(bubbles[1].id).toBe(entryId);

    const states = deriveStates(bubbles, {
      pendingIds: new Set(),
      processedIds: new Set([entryId]),
    });
    expect(states.get(bubbles[0])).toBe("answered");
    expect(states.get(bubbles[1])).toBe("answered");
  });

  it("python writer preserves multi-bubble source structure", () => {
    if (!existsSync(WRITER_PATH)) return;
    if (!hasPython() || !hasYaml()) return;

    const workspace = scratch;
    const vault = resolve(workspace, "vault");
    const queueDir = resolve(vault, "+/ai-queue");
    mkdirSync(queueDir, { recursive: true });

    const id1 = "claude-test-prior-aaaa";
    const id2 = "claude-test-new-bbbb";
    const sourceRel = "Thread.md";
    const sourcePath = resolve(vault, sourceRel);
    const source = [
      "> [!for-claude]",
      "> first question",
      "<!-- claude-id: " + id1 + " -->",
      "",
      "> [!from-claude]",
      "> first answer",
      "<!-- claude-id-response: " + id1 + " -->",
      "",
      "> [!for-claude]",
      "> second question",
      "<!-- claude-id: " + id2 + " -->",
      "",
    ].join("\n");
    writeFileSync(sourcePath, source, "utf8");

    const queueFile = resolve(queueDir, id2 + ".md");
    writeFileSync(
      queueFile,
      [
        "---",
        "type: ai-queue",
        "id: " + id2,
        'source_path: "' + sourceRel + '"',
        "created: 2026-04-24T04:00:00-04:00",
        "status: pending",
        "---",
        "",
      ].join("\n"),
      "utf8",
    );

    const responseFile = resolve(scratch, "response.txt");
    writeFileSync(responseFile, "second answer\n", "utf8");

    execFileSync("python3", [WRITER_PATH, queueFile, responseFile], {
      env: { ...process.env, CLAUDE_WORKSPACE: workspace },
      stdio: ["ignore", "ignore", "pipe"],
    });

    const mutated = readFileSync(sourcePath, "utf8");
    const bubbles = parseBubbles(mutated);

    // 4 bubbles now: [for id1], [from id1], [for id2], [from id2].
    expect(bubbles.map((b) => [b.kind, b.id])).toEqual([
      ["for-claude", id1],
      ["from-claude", id1],
      ["for-claude", id2],
      ["from-claude", id2],
    ]);

    // Prior exchange untouched by the insertion.
    expect(mutated.indexOf("first question")).toBeLessThan(
      mutated.indexOf("first answer"),
    );
    expect(mutated.indexOf("first answer")).toBeLessThan(
      mutated.indexOf("second question"),
    );
    expect(mutated.indexOf("second question")).toBeLessThan(
      mutated.indexOf("second answer"),
    );
  });
});
