# Kolten personal FineNotes test build

`integration/kolten` is **for personal/device testing, not an upstream PR branch or an official FineNotes release**. Current base is upstream FineNotes 1.5.0 (`1ebdfa3`). Main/upstream remain unchanged and no upstream PR is opened.

| Feature                                   | Independent branch commit | Passing tests |
| ----------------------------------------- | ------------------------- | ------------: |
| Stable mutable preset identities          | `b2ead20`                 |         3,035 |
| Solid/Dashed/Dotted Pen                   | `a9b9c61`                 |         3,005 |
| Finger/mouse context and clipboard images | `5621541`                 |         3,027 |
| Two/three-finger double-tap Undo/Redo     | `5c3ded2`                 |         3,012 |
| Companion PDF                             | `677c0bd`                 |         3,046 |

Every feature passes test, typecheck, lint, lint:review, format:check and production build with Node 22. The preset validation uses an isolated snapshot byte-checked against the source because local file-provider reads stalled. Integration adds tests for blue edited defaults with dashed ink; palette scrolling/control exclusions alongside multi-touch; actual history Undo/Redo and companion updates; deleting/restoring content; screenshot event routing into picture placement/selection and companion output; style-only fingerprint invalidation; PDF-backed styled overlays with companion ownership; close/reopen without a redundant export.

The integration full suite uses four workers to avoid artificial contention in the existing shape-recognition timing test. Its original 250 ms limit is unchanged. The initial unconstrained run passed 3,192 tests but exceeded that limit once; the focused test passed. Final integration validation passed all 3,203 tests across 159 files, typecheck, lint, lint:review, formatting and production build.

## Install the exact beta

Prerelease: [FineNotes 1.5.1-beta.3 — Kolten Personal Test](https://github.com/koltensaccount/FineNotes/releases/tag/1.5.1-beta.3). The release notes identify the final integration source commit.

1. Install/enable BRAT in Obsidian Community plugins.
2. Run **BRAT: Add a beta plugin with frozen version based on a release tag**.
3. Enter `koltensaccount/FineNotes` and `1.5.1-beta.3`.
4. If beta.2 is already tracked, change its frozen version to beta.3; if the BRAT UI cannot edit it, remove only its tracking entry and add it again. Keep FineNotes settings/files.
5. Enable FineNotes, reload Obsidian, and verify `1.5.1-beta.3` on both Mac and iPad. If plugin files sync through the vault, let sync finish before reloading/checking the second device.

Assets are `main.js`, `manifest.json`, `styles.css`. Only the packaged manifest gets the beta version. All source branches retain version 1.5.0 and contain no release-only version commit. Beta.2 is preserved. This uses the normal `finenotes` plugin ID: install one enabled FineNotes version. [BRAT guide](https://tfthacker.com/brat-quick-guide).

## Physical test checklist

Run on Mac first, then repeat on iPad in portrait, landscape and Split View. Physical iPad verification is pending.

- Select the original red Pen preset, edit it to the existing blue, and check that its visible disc, selected identity, editor value and new ink are blue. Close/reopen the editor, reorder it, delete another preset, add colors and restart; selection must stay on that identity. Repeat first/middle/last/default/custom edits. Delete the selected preset and check next/previous fallback; delete all and check black fallback. Restore true defaults. Repeat for independent Highlighter colors.
- Add more than five colors. Swipe the strip without selection changes; keep + reachable and normal touch targets at narrow widths. Use hold/right-click Edit/Remove and deliberate Reorder. Widths still normalize/deduplicate/sort numerically with retained selection.
- Draw blue Dashed/Dotted Pen strokes with long curves, different widths and pressure. Compare wet/final/reopened ink, thumbnails, selection operations, Undo/Redo, partial erasure and PDF-backed export. Highlighter/Shape-tool ink remain Solid. Inspect pattern phase and newly erased ends visually.
- On paper, two-finger tap-tap must undo exactly one step; three-finger tap-tap must redo exactly one. Repeat. One/four fingers, pan/pinch, excessive movement, slow/long taps and canceled pointers must do nothing. Try inside the color strip, picker and toolbar/menu controls: no history action. Pencil writing/hold gestures and a resting palm must remain unaffected. Reopen/switch notes and repeat.
- Copy a screenshot in another app. Finger-hold or right-click paper, Paste, and check placement, immediate selection, resize/crop and attachment storage. Repeat keyboard Paste and PNG/JPEG/WebP when exposed. Check internal selection Paste and one insertion per Paste. Deny clipboard access and try the native Paste field; switch/close during pending reads and verify no late insertion in another note.
- Enable Companion PDF on a test notebook. Check stable suffix/path/identity, dirty status after ink/text/image/page/background changes, no export per stroke, and one final PDF update on close. Reopen unchanged and close: no redundant PDF export.
- Repeat companion close after screenshot paste, Dashed/Dotted ink, Undo, Redo, delete and restore. Open the resulting PDF and compare its final content, imported PDF page text/vector fidelity, overlays and ordering. Update PDF now must use the same exporter.
- Rename/move notebook and companion PDF while running, then test offline moves retaining the identity suffix. Reopen and check recovery without duplicates. Delete the PDF while Obsidian is running: close must recreate its recorded target. Put an unrelated PDF at the target: it must be refused. Duplicate a notebook identity or claim the same target: ambiguous ownership must be refused. Deleting a notebook must leave its PDF.
- Background iPad during a dirty notebook/export and reopen. Check final PDF/status and replacement recovery. OS suspension may interrupt asynchronous work; use Update PDF now and confirm Up to date before sharing a critical copy. Test clipboard permission UI and gesture ergonomics on the actual device.

## State and limits

Presets use version-2 `data.json` records `{id,color}` and per-tool selected IDs; version-1 strings/color selections migrate safely. No separate stale display color is stored. The selected preset follows edits/reorder, and duplicate colors retain distinct identities.

Companion identity is the optional owned `finenotes-companion-id` notebook frontmatter key (64 random bits/16 hex digits), also embedded in PDF Subject and its default filename suffix. Registry paths, enablement, filename mode, dirty fingerprint, errors and replacement journal live in `data.json` under `companionPdfs`. Rename events follow moves; recovery searches filenames only when the remembered target is unavailable and verifies embedded ownership. A confirmed live deletion is recreated on close; an ambiguous offline rename that removed its suffix requires choosing the moved target or explicitly updating the recorded path. Full bytes are generated/validated before journaled staging/backup promotion; failure preserves the last good copy.

Multitouch is a pure touch-chord recognizer plus a page-only input adapter calling existing Undo/Redo. It adds no history stack, polling or timers. Physical iPad timing, OS gesture arbitration, clipboard permission/native Paste behavior, narrow UI layout, pattern appearance and suspension behavior remain unverified.

The selection clipboard stays window-local. Clipboard freshness cannot be perfectly inferred when the platform refuses reads/writes. Older FineNotes clients may display styled strokes as Solid and discard style metadata on save. No native permission/security bypass is used.
