#!/usr/bin/env node
/**
 * Copy built plugin artifacts (main.js, manifest.json, styles.css) from the
 * repo into the installed plugin directory inside the vault so Obsidian
 * actually loads the latest build. Obsidian Sync then replicates the binaries
 * to other devices.
 *
 * Target dir resolution order:
 *   1. $OBSIDIAN_PLUGIN_DIR (explicit override)
 *   2. ../../vault/.obsidian/plugins/obsidian-ai-integration (workspace layout)
 *
 * No-op if the target dir's parent (`.obsidian/plugins/`) does not exist —
 * this keeps the step safe on machines where the repo is checked out outside
 * the workspace layout.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ARTIFACTS = ["main.js", "manifest.json", "styles.css"];

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function resolveTargetDir() {
  const fromEnv = process.env.OBSIDIAN_PLUGIN_DIR;
  if (fromEnv) return resolve(fromEnv);
  return resolve(repoRoot(), "../../vault/.obsidian/plugins/obsidian-ai-integration");
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function deploy({ silent = false } = {}) {
  const src = repoRoot();
  const target = resolveTargetDir();
  const pluginsParent = dirname(target);

  if (!existsSync(pluginsParent)) {
    if (!silent)
      console.log(`[deploy-plugin] skipped — no plugins dir at ${pluginsParent}`);
    return { status: "skipped", reason: "plugins-dir-missing", target };
  }

  mkdirSync(target, { recursive: true });

  const copied = [];
  for (const name of ARTIFACTS) {
    const from = resolve(src, name);
    if (!existsSync(from)) {
      throw new Error(`[deploy-plugin] missing artifact: ${from} — run build first`);
    }
    const to = resolve(target, name);
    copyFileSync(from, to);
    copied.push({ name, hash: sha256(to), bytes: statSync(to).size });
  }

  if (!silent) {
    console.log(`[deploy-plugin] copied to ${target}`);
    for (const c of copied) {
      console.log(`  ${c.name}  ${c.hash.slice(0, 12)}  ${c.bytes}b`);
    }
  }

  // Kick Obsidian Sync so the new binaries actually leave the host.
  // `ob sync --continuous` does not watch .obsidian/plugins for local-file
  // changes between scans — every build we did would sit unuploaded until
  // the daemon was restarted. If a systemd user unit named obsidian-sync
  // is active, restart it so sync picks up the deploy on its startup scan.
  kickSyncIfPresent(silent);

  return { status: "ok", target, copied };
}

function kickSyncIfPresent(silent) {
  const check = spawnSync("systemctl", ["--user", "is-active", "obsidian-sync.service"], {
    encoding: "utf8",
  });
  if (check.error || check.status !== 0 || check.stdout.trim() !== "active") {
    return;
  }
  const restart = spawnSync("systemctl", ["--user", "restart", "obsidian-sync.service"], {
    encoding: "utf8",
  });
  if (!silent) {
    if (restart.status === 0) {
      console.log("[deploy-plugin] kicked obsidian-sync.service (forces upload scan)");
    } else {
      console.warn(`[deploy-plugin] systemctl restart failed: ${restart.stderr || "unknown"}`);
    }
  }
}

export function verifyInstalled() {
  const src = repoRoot();
  const target = resolveTargetDir();

  if (!existsSync(target)) {
    return { status: "absent", target };
  }

  const drift = [];
  for (const name of ARTIFACTS) {
    const from = resolve(src, name);
    const to = resolve(target, name);
    if (!existsSync(from)) throw new Error(`missing built artifact: ${from}`);
    if (!existsSync(to)) {
      drift.push({ name, kind: "missing-installed" });
      continue;
    }
    const a = sha256(from);
    const b = sha256(to);
    if (a !== b) drift.push({ name, kind: "hash-mismatch", built: a, installed: b });
  }

  return drift.length === 0 ? { status: "match", target } : { status: "drift", target, drift };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2] ?? "deploy";
  if (mode === "verify") {
    const res = verifyInstalled();
    if (res.status === "drift") {
      console.error(`[deploy-plugin] DRIFT detected at ${res.target}:`);
      for (const d of res.drift) console.error(`  ${d.name}: ${d.kind}`);
      process.exit(1);
    }
    console.log(`[deploy-plugin] verify: ${res.status} (${res.target})`);
  } else {
    deploy();
  }
}
