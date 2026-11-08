# FineNotes Icon Studio — Concept #2 refinement

## Current design target

The second mockup (“Lecture Notes”) guides the writing tools. The writing tools and notebook/page batches were approved in chat. The next review group covers PDF import, scanning, and single-page conversion.

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

All batches use one 24×24 grid, a 1.6-unit neutral outline, rounded joins and caps, and minimal detail. Test at displayed tool size, not just enlarged.

**Existing behavior stays untouched.** Pen presets, highlighter opacity, pressure rules, lasso modes, shape-specific previews, color swatches, record, text, notebook layout, circuit tools and Obsidian utility icons are unchanged. SVG registrations are review-only and use `finenotes-concept2-*` ids. Approval stores a decision and does not apply icons to the toolbar.

## Side-by-side review

Open **FineNotes settings → Support and diagnostics → FineNotes Icon Studio → Review icons…**, or command palette **FineNotes: Review proposed icons side by side…** on a build of this branch.

For each candidate, the gallery shows **Current** and **New** side by side, at toolbar size by default. Use **Preview size** to compare both icons from 16 to 48 px. **Approve**, **Reject** and **Clear decision** persist review choices per icon. Test pen ink colors blue, red, green, yellow, black, and white. Switch theme previews between Obsidian, Light, and Dark. **Save feedback** writes the choices and comments to `icon-studio-feedback.json` in the FineNotes plugin folder. Reopening the gallery restores saved comments. **Copy feedback** copies the current choices and comments.

## Rollout and verification gates

1. The code in this branch is only the icon review studio, not actual toolbar activation. Do not merge this draft without acceptance of the visible artwork.
2. Run `npm ci && npm run lint && npm run lint:review && npm run typecheck && npm test && npm run build`, then inspect it in Obsidian desktop and iPad. In particular, ensure the comparison modal opens, light/dark and swatches function, all icons render without clipping, and decisions persist without toggling live icons.
3. Once approved, implement a **small, separate approved-only integration**. Pen icon must remain responsive to pen type and selected ink. Highlighter stays a subtype of Pen, not a new top-level tool. Preserve existing stroke previews in width menus and shape-selection contexts.
4. The upstream modernization branch / PR #1 is separate. Reconcile the approved icon work with that architecture after PR #1 is reviewed rather than assuming independent branches are already integrated.
5. If a redraw looks worse at real size, **keep the original**.

No new tools, no ruler and no decorative previews.
