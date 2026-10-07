# Customizable writing presets

Branch: `feature/customizable-writing-presets`, based on upstream main
`1ebdfa3d33e52e26eb1f3feb458bbd7a74d20e19`.

## Source findings and decisions

- `src/constants.ts` defines `SIZES` (2, 3, 5, 8, 12 page px) and `PALETTE`.
  Previously `InkView.buildDom` appended `customColors` to that immutable
  palette. Widths and colors had no stored editable preset order.
- `src/view/toolbar.ts` owns the two-tier toolbar and its popovers. The pill
  intentionally has three quick widths and three quick colors. That limit
  remains; the managers use bounded scrolling lists with 44px targets.
- Pen and Highlighter previously shared both color and width selection.
  Palettes and selected colors are now independent. Widths stay shared to
  preserve the existing width/slider architecture and stroke behavior.
- Width creation/replacement snaps to `widthStops(SIZES, true)`: existing
  0.20/0.25/0.30/0.35mm fine stops, then 2–12 page px at 0.5px increments.
  Stored fine widths retain hundredth-page-pixel precision. Duplicates merge;
  order always sorts numerically. Existing selected widths migrate exactly,
  even when outside that range. Highlighter retains its existing minimum
  effective width and multiplier; no handwriting renderer is changed.
- Highlighter originally has no separate default palette; each tool therefore
  starts and resets to the existing `PALETTE`. All those slots can be edited,
  removed, and moved, including white. Colors never auto-sort.
- The existing HSV mixer and common-color choices remain available while
  editing/adding. The old picker displayed HEX without accepting typed HEX;
  the writing-preset editor adds a labeled HEX field without changing text,
  shape or selection pickers. No eyedropper is introduced.
- Upstream references private `contracts/design-brief.md` and
  `research/RESEARCH.md` in toolbar comments; those files are absent from the
  public repository. Published toolbar architecture and contribution rules
  were used.

## Files changed

- `src/model/writing-presets.ts`: pure normalization, palette operations and migration.
- `src/view/preset-colors.ts`, `src/view/preset-drag.ts`: color management and disposable pointer reorder.
- `src/view/toolbar.ts`, `styles.css`: integrate managers and bounded touch-sized layouts.
- `src/view/ink-view.ts`: opening selections and persistence callbacks.
- `src/main.ts`: explicit migration and serialized preset writes.
- `src/settings-data.ts`, `src/settings.ts`: versioned preferences and legacy setting interoperability.
- `tests/model/writing-presets.test.ts`, `tests/view/preset-drag.test.ts`,
  `tests/view/preset-colors.test.ts`, `tests/view/writing-presets-toolbar.test.ts`,
  `tests/view/plugin-entry.test.ts`: logic, lifecycle and persistence coverage.
- `vitest.config.mts`: include the pointer adapter in coverage.
- `docs/customizable-writing-presets.md`: feature notes and physical test checklist.

## Settings migration

`data.json` stores version-2 `writingPresets`: sorted widths, selectedWidth, two independent palettes of `{ id, color }` records, a monotonic nextColorId and per-tool selectedIds. Legacy string palettes and color selections migrate explicitly; HEX values normalize while preset identities and user order persist. The original legacy settings fields and unrelated preferences remain. Migration is saved once, and failed writes retain the in-memory state for retry.

The legacy Custom colors setting still bulk-imports both palettes, retaining surviving record IDs. Default color selects or adds a real preset for the opening tool. Editing, selecting, reordering and removal operate by identity. Removing the selected color chooses the next remaining row, then the previous row at the end, with black ink for an empty palette. Restore Defaults selects a matching default color or the first default. Width removal retains its existing active-value behavior.

No notebook file format change is involved.

## Resulting UI

Tap selects a preset. Hold/right-click opens its compact Edit/Remove/Reorder/Restore actions; the reachable `+` opens Add color.
Each scrollable row has a reorder handle, color/HEX select button, Edit and
Remove. Add color opens the original mixer plus HEX input. Restore default
colors opens a confirmation with Cancel and Restore, scoped to the active tool.
Hold a reorder handle for 350ms with a finger; mouse/Pencil handle dragging
starts immediately. The source dims and the destination shows an accent line.
A focused handle supports Up/Down arrows. Capture, cancellation and disposal
keep drag events from becoming drawing input or color selection.

More widths opens the existing live slider/readout and a sorted list with
Select, Replace and Remove. Choose the desired width on the slider, then Save
current width as preset or Replace an existing row. Reset stroke width retains
its existing meaning: reset the selected width, not the preset list.

## Validation

Run all checks from CONTRIBUTING.md:

```sh
npm test
npm run typecheck
npm run lint
npm run lint:review
npm run format:check
npm run build
```

Verified on the 1.5.0 upstream base: **3,020 tests passed across 145 files**;
TypeScript, ESLint, plugin-review lint, formatting and production build passed.

Tests cover width insertion at each position, resorting on edit, normalization,
duplicates, selected values and JSON reload; default-color edits/removals,
addition, ordering/reload, reset and palette independence; real plugin migration
and reload; mouse/touch drag capture, long press, cancellation, keyboard movement,
and UI/listener disposal on repeated initialization. UI tests use DOM stand-ins;
they do not establish actual iPad WebKit behavior.

## Exact physical iPad checklist

Use a disposable notebook with recognizable existing ink. Record the screen
with FineNotes' input debug overlay enabled. Reload Obsidian after installing
the build. Repeat layout/interactions in portrait, landscape and narrow Split
View, with light and dark Obsidian themes.

- [ ] Before upgrade, record existing custom colors, selected/default color,
      width, highlighter opacity and eraser settings. Upgrade/reload and verify
      those values and existing notebook ink are preserved.
- [ ] Open More widths. Move the slider to a fine smaller width and save it;
      save a middle width and the largest width. Check ascending order and that
      the selected width does not jump when the list changes.
- [ ] Replace a preset using a thinner/thicker slider value; verify resorting.
      Save/replace a near-duplicate and verify one normalized slot remains.
- [ ] Remove the active width, then all widths. Confirm drawing keeps its
      selected width, the slider still works, and a new preset can be added.
- [ ] Edit the original black and white Pen slots, delete a former default,
      add arbitrary HEX and mixer colors, and verify equal color values can have distinct mutable identities.
- [ ] Select distinctive colors in Pen and Highlighter. Switch between them;
      each remembers its own color. Edit/delete/reorder Pen and verify the
      Highlighter palette remains unchanged; repeat in the other direction.
- [ ] Hold a handle with a finger for at least 350ms, drag up/down and drop.
      Check source/destination feedback, exact order and no accidental extra swatches,
      no color selection and no ink beneath the popover.
- [ ] Tap a handle without holding and move before the long press; neither
      should reorder/select. Cancel a drag by switching away/backgrounding;
      reopen and check no stuck feedback, capture or delayed drag.
- [ ] Keep Pencil present while reordering with a finger; touch Pencil to the
      page during an active drag. Verify no stroke, unintended dismissal or
      palette selection. After release, verify Pencil writing works normally.
- [ ] Add enough colors/widths to require scrolling. Check targets remain easy
      to hit, handles reorder through a scroll boundary, and the popover/pill
      stays within the pane. Open HEX input with the keyboard visible.
- [ ] Restore default colors: Cancel first, then confirm. Only the current
      tool's original palette should return; widths, selected ink, opacity,
      eraser and other settings should stay unchanged.
- [ ] Close/reopen managers repeatedly, switch tools/notes and reload Obsidian.
      Verify no duplicated controls/actions and all selections/orders persist.
- [ ] Test mouse drag and keyboard Tab, handle Up/Down, Enter/Space activation,
      and Escape dismissal on desktop or with an attached keyboard/trackpad.
      Verify normal writing resumes after dismissal.

## Upstream review limits

Physical iPad testing is pending; no upstream PR is opened. Long press,
Pencil/finger coexistence, scrolling, keyboard placement and real WebKit focus
must pass the checklist before proposing this upstream. Widths intentionally
remain shared, the bulk settings importer intentionally affects both palettes,
and both tools use upstream's original common palette as their reset values.
Confirm those product choices with the maintainer during later review.

## Focused follow-up audit

Base and original feature commit remain `1ebdfa3` and `4381eb9`; no rebase.
The audit fixes Default ink color for a Highlighter default tool, serializes
all settings writes together (including writes outside the preset manager),
and cancels reorder capture/timers on document hiding and window blur.
An empty width list no longer receives a hidden negative-index array entry.
Regression tests cover opening a Highlighter notebook, failed-write retry,
empty collections, mixed settings/preset writes and background cancellation.
Validation uses Node 22.23.3; npm install reports zero vulnerabilities.

The fork has Actions enabled at repository level, but its Actions API lists no
registered workflows or runs. Its CI file exists and triggers only main pushes
and pull requests. In the fork's Actions tab, click **I understand my workflows,
go ahead and enable them** if shown. Then open a pull request **within the fork**
(base `koltensaccount/FineNotes:main`, head the preset feature branch) to trigger
the unchanged upstream CI. No upstream PR or workflow edits are necessary.

Shortest physical pass: finger hold-and-drag with Pencil present; repeat in
portrait, landscape and Split View; scroll a long palette; enter HEX with the
onscreen keyboard; restart Obsidian and verify both palettes, order and ink
selection. No physical iPad/WebKit validation has been performed.

## Mac feedback refinement

Normal taps select. Every saved color now enters a horizontal quick strip with
room for five 44px targets; it has no total palette limit. The add button is
outside the scrolling region and stays at its edge. Hold with a finger or
right-click for Edit, Remove, Reorder colors or Restore defaults. Add/Edit open
the existing color mixer and HEX field directly. Reordering is deliberately
entered through the context action and uses the existing capture-safe handles;
normal swipes only scroll. Strip movement/cancellation suppresses selection.
Scroll position is retained separately per tool. Narrow panes show fewer
full-size targets rather than shrinking them. Physical Mac feedback informed
this change; the new strip still needs a physical iPad pass.

## Physical-test fix: stable color identities

The version-1 palette stored color strings, selected by color value and targeted editors/removal by array index. Duplicate colors were rejected, while a rebuilt toolbar and an already-open editor could retain different references. This could leave the visible preset, editor and live color out of agreement.

Version 2 stores each preset as `{ id, color }`, plus per-tool `selectedIds` and a monotonic ID counter. Defaults and custom colors use the same records. The displayed swatch and editor derive their color from the identified preset; selection follows the ID through edits and reorder. Editing to another preset's existing color is allowed without merging identities. Stale editors refuse to save if their target was removed, rather than appending or editing another row. Every mutation synchronizes the live color and notifies the drawing callback before the strip is rebuilt.

Deleting the selected preset picks the next remaining row at that position, otherwise the previous final row; an empty palette uses the original black ink fallback with no selected preset. Deleting another row preserves selection. Restore Defaults creates the true default palette with fresh identities and selects a matching default color, or the first default. Width behavior and the roughly five-swatch scrolling strip/+ remain unchanged.

Version-1 and pre-preset settings migrate in user order. A previously selected color outside a nonempty legacy palette is retained as an ordinary preset. Version-2 reload preserves IDs, including duplicate color values. The upgrade is persisted once; no notebook format changes are involved.

Regression coverage includes actual strip rendering after selected default red is edited to existing blue, the live drawing callback, reopening the same editor after reorder, first/middle/last edits, delete fallback, added colors, independent tools, restore and both legacy migrations. Physical iPad verification remains pending.

## Tool-specific default polish (version 3)

New profiles (explicitly identified during plugin settings initialization) receive five Highlighter colors: yellow `#f2d45c`, green `#8bcb84`, cyan `#78c3df`, pink `#e99cb5`, peach `#f2af7e`. Highlighter nominal widths are 5/8/12 page px; its unchanged 4× nib gives actual thickness about 4.1/6.6/9.8 mm, with 8 selected. Pen defaults remain unchanged. Restore colors/widths applies only to the selected tool and uses these new defaults.

Version 3 adds `highlighterWidths` and `selectedHighlighterWidth`; existing `widths`/`selectedWidth` now belong to Pen. Versions 1/2 shared widths and active width migrate into independent copies for both tools, including empty arrays and active values outside the slider. Existing palettes, IDs, selections and customized widths are never overwritten by the new defaults. The upgrade saves once; version-3 reload is idempotent. No notebook/ink schema changes occur. Existing users must explicitly Restore Defaults to adopt the improved Highlighter starting choices.

The independent `feature/writing-tool-ui` branch supplies SVG tool identity and the generic visual thickness editor. Integration wires its optional management callbacks to these per-tool preferences; the independent preset branch remains buildable without the UI feature. Physical iPad verification is pending.
