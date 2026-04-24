# Crumbs — for the next session

Notes for future Claude (and Alex) on how this plugin fits together end
to end, what's tested, and where the seams are.

## The pipeline, at a glance

```
  Plugin (this repo)                   │  VPS (Workspace)
  ─────────────────────────────────    │  ───────────────────────────────
  click ASK CLAUDE                     │
    → enqueue.ts                       │
      writes  vault/+/ai-queue/<id>.md │  systemd tick every 30s
      inserts <!-- claude-id: <id> --> │    → ai_queue_crawler.py
                                       │      picks oldest pending
                                       │      sets status=running
                                       │      invokes run-claude-ai-queue.sh
                                       │        → claude -p -- "<prompt>"
                                       │        → stdout captured
                                       │        → ai_queue_write_response.py
                                       │          inserts [!from-claude] in
                                       │          source doc at the id marker
                                       │          moves queue file → processed/
  vault event "modify" fires           │
    → main.ts debounces, rescans       │
    → state.ts: "queued" → "answered"  │
```

**Hard contract:** Claude's stdout is the response *body*. The Python writer
script wraps it into a `[!from-claude]` callout and handles insertion.
Claude must NOT edit the source file at the bubble location — the writer
owns that byte range.

## Test map

### Plugin side (TypeScript, vitest)

Run: `npm test`

- `src/parse.test.ts` — markdown → `Bubble[]` parsing. Case sensitivity,
  id markers, in-reply-to markers, code-block isolation, blank-line
  separation.
- `src/state.test.ts` — derives `fresh / queued / answered / lost` from
  bubbles + queue state.
- `src/enqueue.test.ts` — enqueue / cancel / retry / reply against a
  fake in-memory Vault (`src/testing/fake-vault.ts`). Includes a small
  end-to-end test simulating the VPS writing a response into the source
  doc and re-parsing.

### VPS side (Python, pytest via uv)

Run: `cd .claude/scripts && uv run --with pytest --with pyyaml python -m pytest`

- `test_ai_queue_crawler.py` — iterator, pick-oldest-pending semantics,
  skipping running entries, not double-dispatching when timer re-fires.
- `test_ai_queue_write_response.py` — the writer that inserts a
  `[!from-claude]` block. Covers happy path, marker-not-found,
  empty-response, missing-source, multi-bubble preservation.
- `test_ai_queue_e2e.py` — spawns the real bash wrapper
  (`bin/run-claude-ai-queue.sh`) inside a tmp workspace with a mock
  `claude` on `$PATH`. Proves the full pipeline end-to-end: queue file
  + source doc → paired response + archived queue entry.

## Fake Obsidian vault

`src/testing/fake-vault.ts` is a 150-ish-line in-memory Vault with just
enough surface area to test plugin-side code: `create`, `createFolder`,
`read`, `cachedRead`, `modify`, `delete`, `getAbstractFileByPath`, and
`TFile` / `TFolder` classes.

Wired up via `vitest.config.ts` alias: `"obsidian"` resolves to
`src/testing/fake-vault.ts` in the test bundle. Production imports of
`obsidian` stay untouched.

## What's NOT covered by tests (intentional gaps)

Things that require a real Obsidian runtime:

1. **Reading-mode DOM decoration** (`decorate.ts`) — relies on
   `MarkdownPostProcessorContext.getSectionInfo`, which is an Obsidian
   runtime thing.
2. **Live Preview `MutationObserver` plumbing** (`livepreview.ts`) —
   `posAtDOM`, Editor offsets, CodeMirror state. Unit-testing this
   faithfully would require a real editor embed.
3. **Plugin lifecycle** — `onload` / `onunload`, `registerEvent`,
   ribbon icons, commands.
4. **Sync latency on mobile** — plugin writes the queue file locally,
   Obsidian Sync carries it to the VPS. If sync is backed up, everything
   appears "stuck". Not a plugin bug.

For these, the manual test checklist in `README.md` is still the
ground truth.

## Known weak signals to watch

- **`created` field in queue frontmatter uses local timezone ISO.** The
  crawler sorts queue files by *string* comparison of this field.
  Same-TZ works fine, cross-TZ concurrent creates can mis-order. Not a
  correctness bug (each file still gets processed), only an ordering one.
- **`decorate.ts` section→bubbles mapping assumes DOM order matches
  parse order within a section.** Obsidian renders callouts in document
  order, so this holds in practice, but if a future Obsidian change
  re-orders DOM, the filter-by-line + index-into-array approach will
  silently mis-associate state with the wrong callout. A stricter match
  would key by line number, not positional index.

## Extending the tests

If a bug reproduces on the laptop, the first move is to replicate it as
a test in `enqueue.test.ts` (plugin side) or
`test_ai_queue_write_response.py` (VPS side) before patching. The fake
vault covers enough of the Obsidian API to drive most scenarios.

For pipeline-shape changes (new queue fields, new marker formats), update
both ends at once: `parse.ts` / `enqueue.ts` on the plugin side;
`ai_queue_write_response.py` / `ai_queue_crawler.py` on the VPS side.
The e2e test will surface any cross-side drift.
