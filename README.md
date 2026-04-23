# obsidian-ai-integration

Obsidian plugin for invoking Claude from any document via `[!for-claude]` callouts.

## The primitive

Write a `[!for-claude]` callout anywhere — any note, any document, any folder:

```
> [!for-claude]
> What's the main idea of this doc?
```

Tap **ASK CLAUDE** in the bubble. The plugin writes a queue entry at
`vault/+/ai-queue/<id>.md`; the VPS agent crawler picks it up, runs Claude
with the doc as context, and appends a `[!from-claude]` response bubble
immediately below.

## States per bubble

- **fresh** — no id yet; **ASK CLAUDE** button visible.
- **queued** — id assigned, queue file exists, no response yet; "Queued…" chip + cancel action.
- **answered** — response appended; rendered as paired chat bubbles, no chrome.
- **lost** — id present, queue file missing, no response; "Lost" chip + retry action.

## Development

```bash
npm install
npm run dev       # watch build
npm run build     # production build
npm test          # unit tests (parser + state)
```

## Installing into a vault

Either symlink the repo into your vault's plugins directory (desktop-only),
or copy the built artifacts (`main.js`, `manifest.json`, `styles.css`) into
`<vault>/.obsidian/plugins/obsidian-ai-integration/` and let Obsidian Sync
replicate across devices (mobile included).

Then restart Obsidian and enable **AI Integration** under Settings → Community plugins.

## Manual test checklist

### Primitive

- [ ] In a fresh note, write `> [!for-claude]\n> hello` → reading view shows a styled bubble with an **ASK CLAUDE** button.
- [ ] Tap ASK → `vault/+/ai-queue/claude-<ts>-<rand>.md` appears; bubble adds `<!-- claude-id: ... -->` marker; UI flips to "Queued…" + cancel.
- [ ] Delete the queue file manually → next render shows "Lost" + retry.
- [ ] Tap retry → queue file reappears with the same id.
- [ ] Append a matching `> [!from-claude]\n> response\n<!-- claude-id-response: ... -->` → UI flips to "answered"; both bubbles render as chat.

### Command

- [ ] Command palette "Insert for-claude prompt" inserts the snippet at cursor.
- [ ] Ribbon icon does the same.

### Non-interference

- [ ] A note with no for-claude callout is untouched.
- [ ] Code blocks containing `> [!for-claude]` do NOT produce chrome.
- [ ] Other callout types (note, info, warning) render normally.
