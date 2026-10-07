# Companion PDF handoff

Branch `feature/companion-pdf` starts directly at upstream main
`1ebdfa3d33e52e26eb1f3feb458bbd7a74d20e19` (FineNotes 1.5.0). It contains no
writing-preset feature commits. No upstream PR or release is created.

## Identity and storage

FineNotes has page/stroke IDs and legacy notebook manifests, but no stable
notebook-wide unique identifier suitable for this association. Configuring a
companion adds only the owned optional `finenotes-companion-id` frontmatter
property through `FileManager.processFrontMatter`. It is 64 random bits,
16 lowercase hex digits. New IDs are checked against registered identities;
copied notebooks with an already-owned ID are refused. Existing notebooks are
unchanged until configured. Ink schema, stroke rendering and user prose remain
unchanged; the public frontmatter contract is extended to version 9 and has a
new independent golden without regenerating existing goldens.

Configuration lives in `data.json` under `companionPdfs`:
`{ version: 1, entries: { [id]: { notebookPath, pdfPath, enabled, followName,
dirty, lastFingerprint?, error?, transaction? } } }`. Empty/absent storage means
disabled. A transaction records target, staging and backup paths for recovery.
The identifier lives in the notebook, not its pathname; configuration must be
synced with plugin data to travel automatically between devices.

Default filename: `<notebook name> [FN-<16 uppercase hex digits>].pdf`.
Custom filenames keep that suffix when newly created. PDFs also embed the
identity in standard Subject metadata, produced by the same existing exporter.
The Subject is verified before ownership/replacement, so an unrelated file at
a remembered path is not silently overwritten. Unrelated existing PDFs cannot
be adopted: choose another target. Existing owned PDFs can be selected by path.

Vault rename events update both notebook and PDF paths, including folder moves.
Notebook renames in Follow notebook name mode use `FileManager.renameFile` to
rename the existing PDF, retaining its current folder. Custom mode leaves its
name alone. Changing the configured folder/name moves the existing associated
PDF rather than creating another copy.

After an offline notebook move, the frontmatter ID binds its new path. After an
offline PDF move, a failed stored path triggers a filename-suffix search; only
matching candidates are parsed to verify embedded identity. An existing valid
stored path requires no vault search. Startup only recovers registered pending
transactions; it never scans/parses all PDFs.

If a PDF is confirmed deleted by a live vault event, the companion becomes dirty and the next close recreates the same recorded path, after ownership/collision checks. If a PDF is missing after an offline move/rename with no matching identity suffix, automatic close leaves
it stale and reports the missing target. **Update PDF now** can explicitly
recreate the same recorded path. This avoids silently duplicating a PDF whose
suffix was removed during an offline rename: enter that PDF's new path instead.
Ambiguous matching copies are refused. Notebook deletion never deletes its PDF.

## UI and lifecycle

Notebook settings adds an off-by-default Maintain an up-to-date PDF copy toggle,
a vault-relative PDF path/custom name field, a folder chooser, filename mode,
Update PDF now and status. Paths can be chosen before enabling. Default output
uses the existing PDF exports folder; otherwise it goes next to the notebook,
exactly as manual export does. Manual Export as PDF keeps its dialog, naming,
page selection and sharing behavior.

An exported-content SHA-256 fingerprint covers ordered pages, geometry,
backgrounds, ink/shapes, images, text boxes, export appearance options, notebook
title and source-asset size/mtime. Navigation, audio, bookmarks, page section
titles, recognition metadata and attachment preferences are excluded. The
snapshot uses FineNotes' persisted quantization, so a clean restart stays clean.
Only the first clean-to-dirty transition persists status; pen strokes never
initiate PDF rendering.

`onUnloadFile` saves the notebook and requests one update before its data and
caches go away. `onClose` is a de-duplicated fallback, including after failures.
The existing document-hidden handler requests a best-effort update for iPad
backgrounding. A clean close renders zero PDFs. The command palette also offers
Update companion PDF now for enabled notebooks. Configuration queues per notebook and rereads its saved identity, so rapid initial
toggles cannot create multiple associations. Export requests coalesce per identity;
changes during a running export stay dirty, and a queued close request finishes
with the latest snapshot. View disposal waits before destroying rendering
caches. Generated PDF vault events do not trigger another export.

Full PDF bytes are generated before replacement. Same-folder staging is then
written, parsed and validated before the old PDF is renamed to a retained backup
and staging is promoted. The journal is persisted before mutation; interrupted
operations restore/clean up on restart or next open. Promotion failures restore
the old file by rename, avoiding a second partial binary write. Reserved
artifacts are removed using Obsidian's trash preference only after recovery or a
validated promotion. Internal moves are excluded from FineNotes' existing file
relink log, so temporary backup names cannot leak into notebook references.
All settings saves are serialized so an older unrelated settings write cannot
win over association/journal state.

## Files changed

- `src/model/companion-pdf.ts`: identity/path rules, fingerprint input, association
  controller, ownership recovery and coalesced dirty/export lifecycle.
- `src/model/companion-write.ts`: replacement journal, rollback and recovery.
- `src/view/companion-pdf.ts`: vault/FileManager adapter and persisted registry.
- `src/view/ink-view.ts`: notebook settings, close/background hooks and existing
  exporter invocation with stable snapshots.
- `src/view/note-settings-modal.ts`: companion controls using existing settings
  and keyboard-placement components.
- `src/main.ts`, `src/settings-data.ts`: optional storage, registered events,
  command and serialized saves.
- `src/export/companion-metadata.ts`, `src/export/pdf-writer.ts`,
  `src/export/pdf-composer.ts`, `src/view/pdf-export.ts`: optional Subject ownership
  metadata; manual export defaults and rendering remain unchanged.
- `contracts/api.md`, `tests/model/goldens/companion-frontmatter.md`: optional owned
  property contract/golden; existing ink goldens remain untouched.
- `tests/model/companion-pdf.test.ts`, `tests/model/companion-write.test.ts`,
  `tests/model/companion-frontmatter.test.ts`, `tests/view/companion-pdf.test.ts`,
  `tests/view/companion-lifecycle.test.ts`, `tests/view/pdf-export.test.ts`,
  `tests/view/plugin-entry.test.ts`, `vitest.config.mts`: meaningful logic, actual
  view-hook, vault adapter, PDF quality, backward compatibility and coverage checks.
- `docs/companion-pdf.md`: this handoff and physical checklist.

## Automated validation

Required suite uses Node 22.23.3: npm install completed with zero vulnerabilities;
**3,043 tests passed across 146 files**. Typecheck, lint, plugin-review lint,
formatting and production build passed. Tests cover enabled/disabled/clean/dirty closes,
manual updates, failures, concurrent changes/requests, settings reload, source
PDF vector preservation, moves/renames, identity collisions, missing targets,
interrupted replacement and repeated view initialization/disposal. Tests use
Obsidian/vault/DOM stand-ins; no physical iPad validation is claimed.

## Test build and exact physical iPad checklist

Use `companion-pdf.zip` in a separate test vault synced to the iPad. Unzip its
three files into that vault's `.obsidian/plugins/finenotes`, enable FineNotes and
reload Obsidian. This build does not include the writing-preset branch. Your
normal installation has not been overwritten; no release is published.

1. Create a test notebook. Confirm the companion toggle is off. Set its PDF
   exports folder, enable the companion, and verify one PDF appears there.
   Also test a notebook with no exports folder: PDF should appear beside it.
2. Write several strokes, add/erase objects and pages. Confirm no export per
   stroke. Close the notebook; open the PDF and verify visible content/order.
3. Reopen/edit/close; verify the same PDF updates. Reopen and close untouched;
   verify no PDF modification. Restart Obsidian and repeat the clean close.
4. Move the PDF to another vault folder inside Obsidian, edit/close the notebook
   and verify only the moved PDF updates. Rename the PDF and repeat.
5. Rename/move the notebook. Follow mode should rename the same PDF when the
   notebook's name changes; its association should survive a folder move.
6. Select Custom name and enter a new PDF name/path. Verify the existing PDF
   moves with the stable suffix; rename the notebook and confirm the custom
   name stays. Type a path occupied by an unrelated PDF: it must be refused.
7. With Obsidian closed, move the PDF retaining its suffix, then reopen/edit/
   close; verify suffix recovery updates that same PDF. If renaming removes
   the suffix offline, choose its new path before updating; no second PDF
   should appear automatically.
8. Delete the test companion. Close after an edit: status should remain missing/
   stale. Use Update PDF now to explicitly recreate the recorded path, once.
9. Import a PDF-backed page with selectable text/vector detail and annotate it.
   Update its companion; inspect text/vector quality and annotation/page order.
   Try ordinary manual Export as PDF too: its workflow should remain unchanged.
10. Edit and background Obsidian, then reopen and inspect status/output. Repeat
    in portrait, landscape and Split View, with the onscreen keyboard while
    entering a long target path. Background mid-export and verify recovery.
11. Cause a source/target-unavailable failure (use only test copies). Verify the
    previous good PDF is retained, status stays stale/failed, and Update now
    works after availability returns. Repeated close/reopen must not duplicate
    files or export attempts. Edit during a manual export; verify stale status
    or a subsequent close updates the latest content.

## Limits and remaining uncertainty

- iPadOS suspension/termination cannot guarantee asynchronous export completion.
  Hidden-state work is best effort; saved fingerprints and the replacement
  journal allow later retry/recovery. Physical WebKit/iCloud behavior is untested.
- Offline PDF renames that remove the suffix require explicit path reselection;
  automatic all-PDF metadata scanning is deliberately avoided. Missing targets
  are not automatically recreated after a prior successful export.
- Obsidian vault rename operations are not a distributed transaction. Concurrent
  writes from multiple devices, provider failures and power loss still need
  real-device testing; the backup/journal preserve recovery data rather than
  claiming an atomic cross-device guarantee.
- External asset edits in a closed notebook are discovered when it next opens/
  updates; there is no continuous renderer or startup content scan.
- Large PDFs require memory for the existing exporter and ownership validation.
  Source quality is preserved, but long notebooks need an iPad performance pass.
- Removing/corrupting the owned frontmatter ID, PDF Subject, registry or recovery
  artifacts manually can require explicit reassociation. Copies with the same
  ID are refused rather than automatically claiming another notebook's PDF.

## Part A audit / CI status

Preset follow-up is `3d9d81d`, still containing `4381eb9` on original base
`1ebdfa3`; upstream had not moved. It fixes default-tool color consistency,
serializes all settings writes, cancels drag capture on hiding/blur and avoids
an empty-width negative-index entry. Under Node 22.23.3: **3,020 tests passed**;
npm install (zero vulnerabilities), typecheck, both lints, formatting and build
passed. Its separate test ZIP was refreshed.

Fork Actions permissions report enabled, but no workflows/runs are registered.
Upstream CI triggers only main pushes and pull requests, not feature pushes.
A fork-only draft PR attempt was rejected by GitHub with GraphQL/server errors
and REST HTTP 500; no PR was created and no workflow files were changed.
In the fork's Actions tab, enable inherited workflows if the acknowledgment
banner appears. Then create a draft PR with **base repository and head repository
both `koltensaccount/FineNotes`**, base `main`, head the preset branch. That runs
the existing CI without opening an upstream PR.

Shortest preset physical pass: finger long-press reorder with Pencil present;
portrait, landscape and Split View; onscreen keyboard + HEX; long-palette
scrolling; restart and verify order and independent Pen/Highlighter selections.

## Current request audit

This branch remains independent of presets, multitouch and line styles. The existing exporter, association registry, rename recovery, safe-write journal and unload lifecycle are retained. Export fingerprints now retain all stroke rendering fields while excluding only stroke ID and replay timing; this includes snapped shape metadata and allows additive rendering styles to participate when integrated without depending on a separate feature branch. A confirmed live PDF deletion can automatically recreate the stable recorded target on close. An ambiguous offline missing path still uses suffix/embedded-ID recovery and explicit Update PDF now when no owned candidate can be identified, avoiding a silent duplicate after an offline rename that removed the suffix.

The automatic close/background export is best effort: OS suspension or forced process termination can interrupt asynchronous work. Staging/backup recovery protects the last good file, but no code can guarantee completion after the process stops. Physical iPad lifecycle validation is still pending. Use Update PDF now and check Up to date before relying on the companion for sharing.
