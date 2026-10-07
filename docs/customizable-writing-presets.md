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

`data.json` gains `writingPresets` with `version: 1`, sorted `widths`,
`selectedWidth`, `palettes: { pen, highlighter }`, and
`selectedColors: { pen, highlighter }`. Loading explicitly migrates legacy
`PALETTE + customColors` into separate arrays. HEX is canonicalized and
semantic duplicates collapse. The original legacy fields remain, including
`customColors`, `defaultColor`, `defaultSize`, opacity and unrelated settings.
The first upgrade of existing settings is saved immediately. Repeated loading
retains custom ordering, empty palettes, deleted defaults and active colors.
Preset writes are serialized, and failed writes show a notice.

The settings tab's legacy Custom colors field remains a bulk import into both
palettes; its description explains that behavior. Individual changes in the
Pen manager do not mutate Highlighter. Default color/size settings continue
setting the opening selection. Removing a selected preset or restoring colors
keeps the active ink value; it need not remain a palette slot.

No notebook file format change is involved.

## Resulting UI

Tap the active color or the color `+` to open the active tool's manager.
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

Verified on the 1.5.0 upstream base: **3,011 tests passed across 145 files**;
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
      add arbitrary HEX and mixer colors, and reject duplicate HEX variants.
- [ ] Select distinctive colors in Pen and Highlighter. Switch between them;
      each remembers its own color. Edit/delete/reorder Pen and verify the
      Highlighter palette remains unchanged; repeat in the other direction.
- [ ] Hold a handle with a finger for at least 350ms, drag up/down and drop.
      Check source/destination feedback, exact order, no duplicate swatches,
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
