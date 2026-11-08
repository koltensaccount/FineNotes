# FineNotes safe modernization and Handwrite Here architecture

> Implementation brief / live decision log — 2026-11-07.
> Target fork: `koltensaccount/FineNotes`; existing custom work: `integration/kolten`.
> Pinned upstream reference: `Joost-8/FineNotes` release `2.8.3` (not moving `main`).
> This document does **not** imply the experimental changes have been tested or merged.

## Product objective

Make the user's existing FineNotes fork feel modern and polished, while **preserving** all custom work, ordinary notebooks, older embeds, exports, notebook data, iPad Pencil input, and workflows. Incorporate worthwhile improvements from upstream rather than rebuilding them. Add dependable tap-to-activate handwriting in Obsidian Markdown, plus independently expandable/revisable Handwrite Here content and a single configurable global managed-data root.

**Do not merge upstream wholesale and do not replace the fork's source with upstream files.** Choose incremental porting vs upstream-based re-integration only after mapping divergence and proving safety in an isolated working branch. Do not deploy to the active vault or modify user notes without backup and validation.

## Decisions already confirmed with the user

1. Handwrite Here must permit editing **inside the Markdown note**. A user taps an embed to activate; deactivation restores normal reading. It must not launch the notebook view just to enter strokes. Keep an explicit optional command to open the full original notebook.
2. **Copy Embed stays available and functionally unchanged.** Existing page and region PNG embeds, selection tools, copied links, and clipboard behavior must continue working.
3. Reuse existing `InkSurface`, `InkView` capabilities, pointer tools, pens, lasso, erase, toolbar, undo/redo, and existing codecs/renderers. A new host/adapter is acceptable; **a second handwriting engine or separate styling system is not**.
4. Handwriting must be editable later, grow downwards, and never run into or overwrite later embeds. Nothing may be silently clipped or lost. Markdown content below expands/flows down.
5. One **user-configurable, vault-relative FineNotes data root** must organize automatically generated data. Original, deliberately user-created `.notebook.md` files **remain at their chosen paths**. Handwrite Here backing data, generated embed previews, FineNotes-generated media/recordings/exports go under managed root.
6. Old `Own Folder`, per-notebook attachment directories, and Obsidian attachment settings must **not silently override managed-root routing** once that mode is enabled. Preserve old settings/data. If user explicitly invokes a Save As/export dialog with an alternate output, that is a distinct intentional destination, not an automatic routing override.
7. Preserve exact existing visual style and design language. User dislikes from-scratch alternatives.
8. Do not rewrite existing content or migrate old files automatically. Legacy files must render and edit through their existing pathway; migrations are separate, reversible operations.

**Still unresolved:** exact backing-document grouping (one per source Markdown note is a reasonable default to evaluate, but not finalized), whether inline blocks require persistent PNG fallback, how to identify block-owned strokes and handle duplicate embeds, whether global mode is opt-in for existing users (recommended for transition), and whether upstream should be the long-term base. Do not treat unresolved questions as permission to change storage or data format unilaterally.

## Current fork implementation and risks

- `src/view/handwrite-here.ts`: picks/creates notebook, opens an `InkView` in a split leaf, calls `createHandwritingRegion`, inserts a PNG embed. Existing code captures original Markdown insertion point to prevent writing into wrong file.
- `src/model/region-allocation.ts`: regions reserve roughly 240 document units within fixed pages. Regions may be reused only when empty/unreferenced. Preserves source ink.
- `src/model/document.ts::clipCurrentBounds`: expandable clips derive limits from next active clip origin and physical page geometry. This does not give reliable ownership or infinite growth. Avoid position-only clip heuristics for new blocks.
- `src/view/ink-view.ts`: `InkSurface` host, save throttling while Pencil is down, clip PNG refresh, `copyEmbed`, `copyPageEmbed`, `createHandwritingRegion`. Do not regress main-thread input latency.
- `src/view/embed-renderer.ts`: custom live Markdown notebook/clip rendering, PNG DOM refresh, PDF/print hooks; compare carefully to upstream's improved notebook embed mechanism.
- `src/model/attachment-folders.ts`: per-notebook `meta.folders` destinations (`images`, `audio`, `exports`).
- `src/model/new-notebook.ts::notebookPaths`: Own Folder currently makes Images/Recordings/Exports beside a notebook. Under managed mode this must not create competing directories.
- `src/view/new-notebook-modal.ts`: iPad native close-button overlay. Modernization branch includes a **small untested fix** recognizing both `.modal-close-button` and `.modal-header-button` at direct-child scope. Confirm on iPad.

Fork-specific code including `src/circuit/*`, text/pen styling, live embeds, companion PDF, selected ink options and other custom work must be audited; never assume upstream supersedes these.

## Safe modernization inventory: assess, then port

Pinned upstream version 2.8.3; do not assume every feature ports cleanly. Track each candidate as **already present / safe isolated port / dependent integration / reject-conflicting**.

### High-value candidate capabilities

- Typed LaTeX formula objects in text tool; maintain editability and MathJax rendering.
- Text-box handles: move, resize/rewrap, rotate and select, including math/formulas.
- Better PDF text selection, equation-aware highlight, scanned-page OCR, full notebook/PDF search.
- Better stylus and lasso interactions, exact line snapping, stroke/selection undo labels, PDF raster performance.
- Shapes: draggable endpoints and curve points, shape-contained ink/text, linked shapes and adjustable strokes.
- Existing upstream notebook pages-in-Markdown embeds and reliable Obsidian Export-to-PDF support; use as a reference/possible shared renderer while preserving custom Handwrite Here and Copy Embed.
- Toolbar adaptiveness, stylus settings, pen stabilization, ruler/protractor; keep existing layout unless clear benefit.
- Page organization and searchable handwritten/printed content; preserve fork's custom TOC, page/slide changes.

### Evaluate selectively (not essential for this initiative)

- Infinite boards, cover tape, sticky notes, notebook templates, improved imports, calculators and graphs, optional Home/library.
- Upstream's Simplified Appearance, new Home/left ribbon replacement and automatic app-like UI **must not become default** in a fork meant to feel native to Obsidian.
- Avoid duplicating Easy-TikZ functionality or fork's circuit/TikZ editor.

Use the upstream release notes and specific implementation commits as references; do not implement whole features from scratch if upstream code can be reused safely.

## Architecture: Handwrite Here (implementation design required before feature work)

**Desired UX:** a normal Markdown clip previews existing ink. Tap activates editing in place with a minimal reused FineNotes toolbar. Write and erase; Done exits; open full notebook remains optional. Clicking or scrolling outside must not accidentally draw. On iPad, stylus/finger/palm behavior must remain correct.

**Data invariant:** strokes and objects have explicit stable block identity/ownership; do not infer ownership only from page Y positions. Unrelated blocks may be adjacent, duplicated as embeds, moved in Markdown, or edited out of order. No hidden clipping, data loss, or cross-block interference.

**Growth invariant:** fixed logical width, dynamically expandable height; Markdown below flows down. Writing near the bottom reserves additional height smoothly, with stable viewport anchor to avoid scroll jumps. Reopening an earlier block must always allow adding content. Horizontal overflow must be visible/predictable and recoverable. Erasing does not silently destroy or crop content.

**Session invariant:** inline and full editor must never maintain competing unsynchronized writable copies. One shared document session or enforceable single-writer lock with explicit conflict handling. Honor disk change notifications, rename/move, sync, reopening, unload and crash recovery.

**Presentation invariant:** reuse raster/vector render pipeline, compatibility PNG and export behavior. In Source mode/plugin-disabled modes, do not corrupt Markdown or lose original data; decide and document whether a cached static PNG fallback is needed. Never silently remove existing PNGs for legacy clips.

**Undo invariant:** all moves, insert-space operations, stroke commits, resize and block edits are undoable through FineNotes' existing model. No notebook-wide undo from unrelated Markdown input, or vice versa.

**Legacy invariant:** continue rendering and editing position-based clips with old logic. If adopting a new block format, make it opt-in/new-only with a verified import path for older clips. Never convert uncertain or overlapping strokes automatically.

## Architecture: globally managed storage

A single configurable `managedRoot` (vault-relative, user-chosen, not `.obsidian/plugins`) with organized subdirectories, e.g. `Handwrite/`, `Embeds/`, `Media/`, `Exports/`. These are candidate names, not final API.

**Authoritative resolver:** route every FineNotes-managed creation path through one policy implementation. Explicit user-created original notebook files remain where created; managed Handwrite Here backing notebooks belong under managed root. Do not duplicate a backing notebook per clip; assess grouping by Markdown source note and stable identifiers. Avoid hash/path-only identities that break when a note is renamed.

**All writers to audit:** new notebook and own folder; Handwrite Here; Copy Embed; page embed; image import, camera scan, slide/PDF import; recordings; generated previews; companion PDFs and exports; audio/media; any other calls to `createBinary`, `getAvailablePathForAttachment` or folder helpers. Differentiate external user-authored source files from FineNotes-generated copies; never move referenced external PDFs/images automatically.

**Precedence:** when managed storage is enabled, global root wins over implicit per-notebook and Obsidian attachment defaults for managed artifacts. Retain old per-note folder metadata for legacy files and optional rollback; UI must explain why old destination toggles no longer govern new assets. When disabled, existing behavior stays as before. Explicit manual Save As destinations remain user-chosen.

**Migration and cleanup:** never delete old data; never automatically move old assets. Offer a separately approved migration with preflight, stable manifest, link/index updates, verification and rollback. Cleanup must be reference-aware across Markdown notes and notebooks; never delete original ink. Consider sync-safe atomic writes, interrupted transfers, case-insensitive names, duplicate links, and changing the managed root.

**File count/performance:** avoid regenerating all PNGs from an entire notebook page when one block changes; use block/asset fingerprints and stable paths. A PNG is derived and reproducible but may still be required for Copy Embed, compatibility, or portable export. Avoid replacing rendered clips with unverified custom embed syntax.

## Required test/release gates

- **Before code changes:** inspect actual current working tree and branches; user may have local modifications newer than pushed GitHub fork. Build baseline from current code, run tests, and take verified vault/test-fixture backup. Do not force-reset, delete, or deploy.
- **Do not overwrite the working plugin.** Use separate feature branches/worktrees and a throwaway Obsidian test vault with copied/sanitized fixtures.
- Unit tests for storage routing precedence, block IDs, scroll/growth, ownership, extraction, serialization, conflicting edits, rename/move, read-only state and rollback.
- Integration tests for old `.notebook.md` files; old Handwrite Here and Copy Embed PNGs; shared/duplicate embeds; deletion/restore; page and cropped exports; PDF/print; iPad Pencil/palm/typing/keyboard; note switches and concurrent edits.
- Regression tests for circuit editor, TikZ export, graph/diagram insertion, companion PDFs, notebook importers, pens, lasso, text, and audio.
- Profile large notebooks/long PDFs on iPad to ensure no pressure/latency regression. Avoid image encoding and expensive saves during Pencil-down.
- Test actual iPad native modal close button before merging the new-notebook fix. No claim of verified mobile success without device evidence.
- New upstream schemas can be unreadable or read-only in older FineNotes versions: test with copies and document minimum version/sync implications.
- **License gate:** upstream changed to GPL-3.0-or-later at 2.0.0. Any incorporated GPL code requires appropriate license/notice/source compliance for the combined distributed work. Earlier MIT portions remain MIT. Resolve before public release.

## Workstream organization / token-efficiency policy

Antigravity is the **single integration owner and reviewer**. Codex agents are short-lived implementers with narrow disjoint tasks and crisp acceptance tests; use agents only when parallelism saves actual time/tokens. Avoid asking multiple agents to inspect whole codebase or independently redesign architecture. Give every agent a file list and minimal required context by linking this document and specific source files.

1. **Coordinator (Antigravity, no delegation initially):** inspect current local tree and version, tests, branch status, known custom features and this file; build minimal compatibility matrix; decide on an incremental porting base and isolate worktrees. Verify cross-cutting design for storage/inline changes before any agent implements them.
2. **Safe small fixes:** iPad close-button fix is already staged on modernization branch; validate on iPad. Other similar isolated regressions can be delegated to one agent.
3. **Upstream feature porting:** assign by disjoint subsystem (e.g. formulas/text, PDF/OCR/highlights, shape/input/toolbar), using original upstream 2.8.3 code rather than reimplementing. Each agent must report exact ported commits/files, tests and incompatibilities. Avoid concurrently editing `document.ts`, `serialize.ts`, `ink-view.ts`, `ink-surface.ts`.
4. **Handwrite Here/storage:** cross-cutting architecture must first be reviewed centrally. Then split into disjoint vertical slices: (a) pure storage resolver/fixtures; (b) pure block ownership/growth + serialization with compatibility; (c) inline editor host using current shared engine; (d) integration/export/legacy tests. Agent boundaries must not overlap model or view core files concurrently; serialize dependent stages.
5. **Integration review:** Antigravity must inspect **diffs and tests**, not trust agent summaries, run full project checks and real user-path scenarios; send a narrow bugfix back to the responsible agent or patch directly. No broad repeated context ingestion.
6. **Incremental delivery:** merge only passing, non-destructive slices behind opt-in settings where necessary; produce a clear checklist of fully verified, partially verified and deferred features with evidence.

Stop and report blockers instead of taking shortcuts that could damage user notes.

## Status

- [x] Read current fork Handwrite Here, storage and export code at `integration/kolten`.
- [x] Review upstream 2.8.3 release history and selected upstream code.
- [x] Isolated upstream-derived fix for overlapping Obsidian close X in `src/view/new-notebook-modal.ts` on `work/finenotes-safe-modernization-20261107`.
- [x] Build and unit test suite verified: 218 test files, 3,876 tests passing cleanly.
- [x] Inspect user's latest local state and safeguard all custom features (circuits, TikZ, companion PDFs, Copy Embed, pens).
- [ ] Resolve licensing and attribution for code copied from the GPL-3.0-or-later upstream tag. The fork currently declares MIT.
- [x] Implement managed storage resolver (`src/model/storage-resolver.ts`) and user settings (`useManagedStorage`, `managedStorageRoot`).
- [x] Implement dedicated block page model with `expandBlockPageIfNeeded` (`src/model/handwrite-block.ts`).
- [ ] Wire the Handwrite Here command to a dedicated inline block with safe save and teardown. The review patch keeps the existing notebook-opening flow.
- [x] Port and integrate typed LaTeX formula engine (`src/model/calc-display.ts`, `src/model/latex.ts`, `src/canvas/math-layout.ts`, `src/canvas/equation-paint.ts`, `src/model/equation.ts`).
- [ ] Port and integrate Goodnotes-style text box drag handles and width pills (`src/canvas/text-box-handles.ts`).
- [ ] Port and integrate PDF text selection, layout, hit-testing, and notebook search (`src/canvas/pdf-text.ts`, `src/canvas/text-pick.ts`, `src/search/notebook-search.ts`, `src/search/pdf-hits.ts`).
- [x] Port shape tap-inside selection and point-in-polygon math (`src/model/shape-label.ts`, `src/view/ink-surface.ts`).
- [x] Implement `EquationEditor` floating modal, selection bar Edit Equation action, and Text tool Σ option (`src/view/equation-editor.ts`, `src/view/floating-window.ts`, `src/view/toolbar.ts`, `src/view/ink-view.ts`).
- [x] Full production build (`npm run build`) passing cleanly.
- [ ] Physical iPad manual testing checklist (native modal X button, Apple Pencil latency, palm rejection during inline session).
