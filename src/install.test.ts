/**
 * Guard against the deploy drift that bit us on 2026-04-24: built main.js in
 * the repo, stale main.js in `vault/.obsidian/plugins/obsidian-ai-integration/`,
 * Obsidian on the laptop silently loading the old one. Every "I shipped X"
 * message was effectively a lie because the installed binary never updated.
 *
 * This test fails loud if the installed artifacts don't match the built ones.
 * Skips when either side is missing (dev checkouts without a vault, or before
 * the first build). Run `npm run build` to reconcile; that invokes the deploy
 * step and the next `npm test` will be green again.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — .mjs, no types, but we only use two exported functions.
import { verifyInstalled, resolveTargetDir } from "../scripts/deploy-to-vault.mjs";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const BUILT_MAIN = resolve(REPO_ROOT, "main.js");
const INSTALL_DIR = resolveTargetDir();

describe("installed plugin parity", () => {
  it("installed artifacts match built artifacts (or one side is absent)", () => {
    if (!existsSync(BUILT_MAIN)) {
      // Fresh checkout, no build yet. Not a failure.
      return;
    }
    if (!existsSync(INSTALL_DIR)) {
      // Dev machine without workspace vault layout. Not a failure.
      return;
    }
    const result = verifyInstalled();
    if (result.status === "drift") {
      const lines = result.drift.map(
        (d: { name: string; kind: string }) => `  ${d.name}: ${d.kind}`,
      );
      throw new Error(
        `Installed plugin out of sync with repo build at ${result.target}\n` +
          lines.join("\n") +
          "\nRun `npm run build` (which now runs deploy) to reconcile.",
      );
    }
    expect(result.status).toBe("match");
  });
});
