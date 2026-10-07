# Kolten personal FineNotes test build

`integration/kolten` is a personal/device-test integration branch. **It is not an upstream PR branch or an official FineNotes release.** It combines only the three requested, independently tested feature branches, starting from current upstream main (`1ebdfa3`, FineNotes 1.5.0). No upstream PR has been opened. Main and upstream have not been modified.

| Independent feature branch             | Tested feature commit | Passing tests |
| -------------------------------------- | --------------------- | ------------: |
| `feature/customizable-writing-presets` | `2aeb1a2`             |         3,031 |
| `feature/line-styles`                  | `a9b9c61`             |         3,005 |
| `feature/clipboard-context-menu`       | `5621541`             |         3,027 |

Every feature and the integration pass `npm test`, `npm run typecheck`, `npm run lint`, `npm run lint:review`, `npm run format:check`, and `npm run build`, using Node 22. Integration: **3,097 tests across 151 test files**. Merge resolutions combine the preset and line-style settings/imports; no feature was redesigned. No completed multitouch undo/redo branch was present in the fork. The separate companion-PDF branch is not included in this three-feature build.

## BRAT package

Personal prerelease: `1.5.1-beta.2` — [FineNotes Kolten Personal Integration Test](https://github.com/koltensaccount/FineNotes/releases/tag/1.5.1-beta.2).

Assets: production `main.js`, `styles.css`, and a packaging-only `manifest.json` whose version equals the tag. Source manifest/package versions remain `1.5.0`; no release-only version commit is added to any feature branch. The release tag points at the integration commit, reported in the release notes. Physical iPad testing is pending. The earlier presets beta was tested on Mac; the refinements and combined build still need this checklist.

## Install this exact build on Mac and iPad

1. In Obsidian, open Settings → Community plugins, install/enable **BRAT** if needed.
2. Open the command palette and run **BRAT: Add a beta plugin with frozen version based on a release tag**.
3. Enter repository `koltensaccount/FineNotes`, select/enter release tag `1.5.1-beta.2`, and add the plugin.
4. If this fork is already tracked at beta.1, change its frozen version to beta.2. If the installed BRAT UI has no edit option, remove the old entry from BRAT's tracking list (without uninstalling FineNotes or deleting its settings), then add it again with the frozen-version command.
5. Enable **FineNotes** in Community plugins and reload Obsidian. Check its displayed version is `1.5.1-beta.2`.
6. Do the same version check on iPad. If the vault's `.obsidian` plugin files sync between devices, let that sync finish and reload iPad Obsidian before checking. Use one enabled FineNotes installation, because this build retains the normal `finenotes` plugin ID.

Use the frozen-version route rather than assuming BRAT's normal/latest command will select a prerelease. [BRAT's own guide](https://tfthacker.com/brat-quick-guide) documents the command.

## Physical Mac checklist

- **Quick colors:** compare palettes with 1–5 colors and more than 5. Add a sixth and further colors; each enters the strip immediately. About five 44 px targets fit at full size, fewer at narrow widths; swipe/scroll to later swatches while + remains reachable. Scrolling must not change the selected color. Tap a color; right-click Edit/Remove; edit/delete an original default just like a custom color. Use deliberate Reorder colors handles, reopen/restart, and confirm order persists. Restore Defaults. Repeat with Highlighter and confirm its palette remains independent.
- **Widths:** add widths out of order and duplicates, including 0.20/0.25/0.30/0.35 mm. Check numerical normalization, deduplication, ascending order, persistence and retained selection after sorting.
- **Line styles:** use Pen Solid, Dashed and Dotted at thin/medium/thick widths. Draw long straight lines, curves and pressure-varying strokes. Compare wet and final ink, then save/reopen and thumbnails. Move with lasso, Cut/Copy/Paste, Duplicate, Undo/Redo, whole and partial erase. Check dots stay round and dash phase does not restart at every input sample. Check surviving erased fragments and new cut ends visually. Open old notes: their ink remains Solid. Highlighter and Shape-tool ink remain Solid; a Pen stroke snapped into a shape retains its Pen style.
- **PDF:** annotate an imported PDF page with all three Pen styles and paste a picture. Export it and an ordinary notebook page; compare overlays with the canvas and thumbnails.
- **Context:** right-click empty paper for Paste, then selected content for Cut/Copy/Duplicate/Delete/Paste. Confirm no right-click ink. Exercise Undo/Redo after each mutation and verify selection stays usable.
- **System clipboard:** copy a screenshot outside Obsidian and menu-Paste it at different page points. Check a vault attachment is created, the image is selected, and it can move/resize/crop. Repeat PNG/JPEG/WebP where exposed. Cmd+V after interacting with a page should use that point; reopen without a prior interaction and check visible-centre placement. Copy a FineNotes mixed lasso group and a lone image; confirm local selection versus external screenshot priority.
- **Overlap/lifetime:** each Paste inserts once; intentional repeated Paste inserts again. Deny clipboard permission, try the native Paste field, cancel it, switch notes during a pending read, close/reopen repeatedly and check no late insertions or stale menus appear.

## Physical iPad checklist

Run the Mac behavior checks above using fingers, Pencil and a hardware keyboard where available, plus:

1. Inspect portrait, landscape and Split View/narrow widths. Keep normal touch targets; verify horizontal palette scrolling, visible +, selected-color indication and picker/menu placement with the keyboard open.
2. Finger-scroll the color strip repeatedly, with Pencil nearby/resting; no accidental selection. Finger hold Edit/Remove, deliberate reorder, Restore Defaults and independent Highlighter colors. Save/restart and verify widths and palettes persist.
3. Finger-hold empty paper for roughly half a second and Paste a screenshot copied from the system screenshot UI/Photos. Accept the OS paste permission/callout if shown. Verify placement, immediate selection, attachment storage, resize/crop and one-step Undo/Redo.
4. If direct clipboard access is denied/unavailable, hold in the fallback dialog's text field and choose the **system Paste** action. Confirm one image insertion at the original point. If the OS exposes no image, use normal image import; record the iPadOS/Obsidian versions and what the OS supplied.
5. Finger-hold inside a selected lasso group/image for its existing actions. Pencil drawing/shape/circle/lasso holds must retain their existing behavior and never enter the new finger/mouse recognizer. Existing Pencil lasso hold UI is intentionally unchanged.
6. Start a pan, move beyond the hold slop, add a second finger/pinch, lift early or switch apps mid-hold. No delayed context action should fire or rearm after the pinch. Check ordinary scrolling/zooming still works and a resting palm while drawing does not open the new menu.
7. Repeat long/curved/pressure-sensitive Dashed/Dotted drawing, thumbnails/reopen, lasso operations, partial erasure and ordinary/PDF-backed export. Inspect pressure transitions and newly cut pattern ends at several zoom levels.
8. With a hardware keyboard, test Cmd/Ctrl+V point/centre placement and image selection. Reopen tabs and restart Obsidian repeatedly; no duplicate paste or long-press handler should accumulate.

## Remaining verification and limits

No physical iPad result is claimed. Clipboard permissions, OS screenshot representations, native Paste field behavior, Pencil/finger arbitration, narrow-view ergonomics and pattern appearance still need device testing. The automated suite validates geometry/model/render paths and event arbitration, not physical WebView behavior.

Line styles are optional additive notebook fields: old notes load Solid without a schema migration or old-golden rewrite. Older FineNotes clients can load new strokes as Solid and may discard style metadata if they save them. Dash spacing follows whole-stroke distance using nominal width; pressure changes dot/dash thickness, not spacing. Partial erasure phase uses the stored polyline and merits visual device inspection.

The selection clipboard remains window-local. A system marker identifies it best-effort, and external image data wins without a matching marker. When a platform refuses both reads and writes, perfect clipboard freshness detection is unavailable. Clipboard MIME acceptance is PNG/JPEG/WebP when exposed; iPadOS may supply PNG regardless of the original format. [WebKit's clipboard documentation](https://webkit.org/blog/10855/async-clipboard-api/) explains the user-gesture restrictions. No native security bypass is used.
