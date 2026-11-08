# FineNotes Icon Studio — Concept #2 refinement

## Current design target

This replaces the **rejected 28-icon replacement proposal** with **three** deliberately designed candidate instruments: **Pen, Highlighter, Eraser**. The second mockup ("Lecture Notes", light interface, slim tilted stylus with a blue tip, yellow highlighter) is the approved visual reference.

The old 28 SVG concepts are *not* endorsed. They have been removed from the candidate registry, and their previous per-item review decisions are not reused; the three revised candidates have new ids (`*-concept2`).

### Candidate behavior

| Candidate | Original shown in review | Revised artwork |
| --- | --- | --- |
| Pen | Existing live-style FineNotes stroke preview, reflecting configured pen type and width | Slim tilted digital stylus, neutral outline, tiny live-color tip, quiet end cap |
| Highlighter | Existing FineNotes highlighter stroke preview | Same tilted axis, wider barrel, squared chisel tip, live-color nib |
| Eraser | Obsidian `eraser` icon used by current primary toolbar | Simple two-part eraser block with one seam, no ink coloration |

All three use one 24×24 grid, a 1.6-unit neutral outline, rounded joins and caps, and minimal detail. Test at displayed tool size, not just enlarged.

**Existing behavior stays untouched.** Pen presets, highlighter opacity, pressure rules, lasso modes, shape-specific previews, color swatches, record, text, notebook layout, circuit tools and Obsidian utility icons are unchanged. SVG registrations are review-only and use `finenotes-concept2-*` ids. Approval stores a decision and does not apply icons to the toolbar.

## Side-by-side review

Open **FineNotes settings → Support and diagnostics → FineNotes Icon Studio → Review icons…**, or command palette **FineNotes: Review proposed icons side by side…** on a build of this branch.

For each of the **three** proposed replacements, the gallery shows **Current** and **New** side by side, at toolbar size by default. Use **Preview size** to compare both icons from 16 to 48 px. **Approve**, **Reject** and **Clear decision** persist review choices per icon. Test pen ink colors blue, red, green, yellow, black, and white. Switch theme previews between Obsidian, Light, and Dark. **Save feedback** writes the three choices and comments to `icon-studio-feedback.json` in the FineNotes plugin folder. Reopening the gallery restores saved comments. **Copy feedback** copies the current choices and comments.

## Rollout and verification gates

1. The code in this branch is only the icon review studio, not actual toolbar activation. Do not merge this draft without acceptance of the visible artwork.
2. Run `npm ci && npm run lint && npm run lint:review && npm run typecheck && npm test && npm run build`, then inspect it in Obsidian desktop and iPad. In particular, ensure the comparison modal opens, light/dark and swatches function, all three icons render without clipping, and decisions persist without toggling live icons.
3. Once approved, implement a **small, separate approved-only integration**. Pen icon must remain responsive to pen type and selected ink. Highlighter stays a subtype of Pen, not a new top-level tool. Preserve existing stroke previews in width menus and shape-selection contexts.
4. The upstream modernization branch / PR #1 is separate. Reconcile the approved icon work with that architecture after PR #1 is reviewed rather than assuming independent branches are already integrated.
5. If any of these three redraws looks worse at real size, **keep the original**.

No new tools, no ruler and no decorative previews.
