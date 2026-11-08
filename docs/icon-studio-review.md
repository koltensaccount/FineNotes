# FineNotes Icon Studio — Concept #2 refinement

## Current design target

The second mockup (“Lecture Notes”) guides the writing tools. All eleven designs were approved in chat and are used by their corresponding FineNotes controls. The gallery groups them into writing tools, notebook and page actions, import and conversion, and handwriting and PDF updates.

### Candidate behavior

| Candidate | Original shown in review | Revised artwork |
| --- | --- | --- |
| Pen | Existing live-style FineNotes stroke preview, reflecting configured pen type and width | Slim tilted digital stylus, neutral outline, tiny live-color tip, quiet end cap |
| Highlighter | Existing FineNotes highlighter stroke preview | Same tilted axis, wider barrel, squared chisel tip, live-color nib |
| Eraser | Obsidian `eraser` icon used by current primary toolbar | Simple two-part eraser block with one seam, no ink coloration |
| New notebook | Obsidian `notebook-pen` | Bound notebook with a creation mark |
| Page thumbnails | Obsidian `panel-left` | Page strip beside an open page |
| Add page | Obsidian `plus` | Loose sheet with a folded corner and creation mark |
| Import PDF | Obsidian `file-text` | Folded sheet with an inward arrow |
| Scan document | Obsidian `scan-line` | Sheet framed by camera guides |
| Convert to notebook | Obsidian `book-open` | Open notebook with a turning page |
| Handwrite Here | No dedicated icon | Tilted pen between text lines |
| Update companion PDF | Text-only button | Folded sheet with a refresh arrow |

All batches use one 24×24 grid, a 1.6-unit neutral outline, rounded joins and caps, and minimal detail. Test at displayed tool size, not just enlarged.

**Existing behavior stays untouched.** Pen presets, highlighter opacity, pressure rules, lasso modes, shape-specific previews, color swatches, record, text, notebook layout, circuit tools and Obsidian utility icons are unchanged. The approved icons use `finenotes-concept2-*` registrations. Gallery decisions store feedback independently of the active artwork.

## Side-by-side review

Open **FineNotes settings → Support and diagnostics → FineNotes Icon Studio → Review icons…**, or command palette **FineNotes: Review proposed icons side by side…** on a build of this branch.

For each candidate, the gallery shows **Original** and **Approved** side by side, at toolbar size by default. Use **Preview size** to compare both icons from 16 to 48 px. **Approve**, **Reject** and **Clear decision** persist review choices per icon. Test pen ink colors blue, red, green, yellow, black, and white. Switch theme previews between Obsidian, Light, and Dark. **Save feedback** writes the choices and comments to `icon-studio-feedback.json` in the FineNotes plugin folder. Reopening the gallery restores saved comments. **Copy feedback** copies the current choices and comments.

## Rollout and verification gates

1. Validate the plugin with lint, typecheck, Vitest, and a production build.
2. In Obsidian, verify the toolbar and menus at desktop and iPad sizes, and check that Pen and Highlighter follow the selected ink.
3. Preserve the stroke previews in width menus, the rectangular and freehand Lasso modes, and the Shapes presets.
