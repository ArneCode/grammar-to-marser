# Frontend redesign brief

Shared constraints for parallel design agents. **Read this file before making changes.**

## Product goal

Redesign the grammar-to-marser web UI so a first-time visitor can:

1. **Get in quickly** — understand what the tool does within a few seconds
2. **Understand the flow** — grammar in → Rust out, without reading docs first
3. **Feel motivated to play** — tempted to load an example, edit it, and see live output

The app is a browser tool: paste or open a Pest/PEG grammar, get Marser Rust parser code live.

## Design principles (all variants)

- Lead with action, not documentation walls
- Make the dual-pane editors the hero once the user is oriented
- Onboarding should be skippable and not block the editors
- Preserve a dark-theme-friendly dev-tool feel unless your variant brief says otherwise
- Mobile layout must remain usable (stacked panes, tappable controls)

## Files you may change

| File | Scope |
|------|--------|
| `web/index.html` | Structure, copy, layout, class names |
| `web/styles.css` | All visual design |
| `web/src/ui.js` | Onboarding/tour copy and minor DOM helpers only if needed |
| `web/src/main.js` | **Avoid** — only touch if unavoidable; prefer HTML/CSS |

Do **not** change WASM/Rust (`web/src/lib.rs`), conversion logic, share encoding, or example data unless fixing a bug you introduced.

## DOM contract — do not break

JavaScript binds to these **IDs**. Keep them on the correct elements (or update JS in the same PR if you must rename):

| ID | Purpose |
|----|---------|
| `examples-select` | Example grammar dropdown |
| `input-syntax` | Pest / PEG selector |
| `entry-rule` | Entry rule text input |
| `rule-names` | Datalist for rule autocomplete |
| `entry-rule-hint` | Validation hint (may be `hidden`) |
| `entry-rule-help` | Field help text |
| `open-file-btn` | Open file button |
| `file-input` | Hidden file input |
| `share-link-btn` | Share URL button |
| `share-outdated` | “outdated” badge (may be `hidden`) |
| `status` | WASM / convert status |
| `intro-section` | Onboarding block |
| `intro-dismiss` | Dismiss intro |
| `intro-tour-btn` | Start tour |
| `hero`, `quick-start`, `intro-actions` | Intro subsections |
| `panes` | Editor container |
| `pest-pane`, `rust-pane` | Left / right panes |
| `pane-resizer` | Draggable divider |
| `pest-editor`, `rust-editor` | CodeMirror mount hosts (class `editor-host`) |
| `pest-filename` | Loaded filename label |
| `copy-pest-btn`, `copy-rust-btn` | Copy buttons |
| `emit-comments`, `emit-trace` | Output option checkboxes |
| `download-project-btn` | Zip download |
| `error-panel`, `error-list`, `copy-errors-btn` | Error display |
| `limitations-panel` | Supported features details |
| `tour-bar`, `tour-text`, `tour-skip`, `tour-next` | Guided tour |

Tour highlights these targets (keep IDs): `examples-select`, `entry-rule`, `pest-editor`, `share-link-btn`, `download-project-btn`.

Required classes: `editor-host` on editor containers; `btn`, `btn-sm` on buttons; `tour-highlight` is added by JS.

## Features that must keep working

- Live WASM conversion as grammar edits
- Example loading, syntax switch (Pest/PEG), entry rule + datalist
- Open file + drag-and-drop on grammar pane
- Copy grammar / Rust / errors; download Cargo zip
- Share link (URL hash)
- Pane resizer; intro dismiss (localStorage); guided tour
- Error panel when conversion fails
- `localStorage` persistence for grammar, entry rule, options

## Build & verify

From `web/`:

```bash
./dev.sh          # wasm + npm bundle (first run is slow)
# or if pkg/ already built:
npm run build
```

Serve statically (e.g. `npx serve .` from `web/`) and confirm:

1. Page loads, status becomes “Ready”
2. Select an example → Rust pane updates
3. Edit grammar → live update
4. Share link copies a URL that reloads state

## Git workflow

Each agent works on **one branch only** (see `design-agents/PROMPTS.md`). Commit your redesign on that branch when done. Do not merge to `main`.

## Comparison

After all agents finish, the repo owner compares branches in the browser. See `setup-design-worktrees.sh`.
