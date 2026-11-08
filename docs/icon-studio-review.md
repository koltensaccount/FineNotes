# FineNotes Icon Studio — review and implementation gate

Branch: `work/icon-family-approval-gallery-20261107` (separate from `integration/kolten`).

## Purpose

Original, Swiss-technical icon candidates based on the **second approved visual concept**: a slim angled digital stylus, restrained neutral instrument outline, a tiny live ink-coloured tip where meaningful, theme-adaptive surface and selected state. This artwork is independent of the newest upstream FineNotes pen glyphs. No new drawing tools are created.

**This is a design review feature, not a production icon replacement.** Existing toolbars, shortcuts, command IDs, Lasso/Shapes dynamic behavior, notebook content, and Copy Embed remain untouched. Decisions are stored per icon in `settings.iconReviewDecisions`, not used by live icon dispatch. Approving an item does not activate it.

## Where to open

- In Obsidian, **Settings → FineNotes → Support and diagnostics → FineNotes Icon Studio → Review icons…**
- Or command palette: **FineNotes: Review proposed icons side by side…**.
- Each row renders the old icon **next to** the new original SVG at native toolbar size, its proposed usage, and **Approve**, **Reject**, or **Clear decision**.
- Test blue, red, green, black and white ink before deciding. Switch the comparison between Obsidian's current theme, a light sample surface, and a dark sample surface without changing the real app theme.
- Use **Copy decisions** to export every candidate's id/title/approved/rejected/undecided status as JSON for a follow-up agent or chat. This does not export notes or any private vault content.
- Decisions persist in the vault's plugin settings; review choices do **not** affect live notebook rendering.

## Candidate inventory (28)

| Area | Candidate ids | Existing sources to integrate after approval |
| --- | --- | --- |
| Main writing tools | `pen`, `highlighter`, `eraser`, `shapes`, `text` | `src/view/toolbar.ts`, pen options, `styles.css` |
| Pen-type and eraser options | `ballpoint`, `brush`, `erase-stroke` | `toolbar.ts`, `stroke-preview.ts` — keep functional stroke-width samples |
| Selection | `lasso-free`, `lasso-rect`, `crop`, `move` | `toolbar.ts`, `ink-surface.ts`, `selection-bar.ts` |
| Media insertion | `image`, `record`, `scan`, `pdf` | `image-menu.ts`, `audio-ui.ts`, PDF import/export |
| Notebooks and Markdown | `new-notebook`, `new-page`, `bookmark`, `contents`, `templates`, `writing-guides`, `copy-embed`, `handwrite-here` | `main.ts`, `page-sidebar.ts`, `more-panel.ts`, `new-notebook-modal.ts`, `note-settings-modal.ts`, `handwrite-here.ts` |
| PDF lifecycle | `companion-pdf` | `companion-pdf.ts`, `note-settings-modal.ts` |
| Custom circuit editor | `circuit`, `circuit-wire`, `circuit-component` | `circuit-modal.ts`, selection/action menus |

Utility icons remain native and familiar: Undo, Redo, Close, Settings, Search, Help, navigation arrows, disclosure, checkboxes, add/remove generic commands, etc. They use Obsidian's standard appearance and shared optical sizing rather than individually bespoke pictograms. The newer upstream Home/Library, OCR, sticky notes, tape, fill, tables and other **not yet merged** features should use this same system once brought into the fork; don't silently invent unavailable tools or icons for them today.

## Design and implementation requirements

- The candidates register under `finenotes-v2-*` identifiers to avoid any changes to existing Obsidian/Lucide names.
- A 24×24 drawing grid, rounded line ends and joins, 1.8-unit principal stroke and carefully optical-balanced icon geometries.
- Neutral outline inherits `currentColor` from the Obsidian theme. Ink is a separate CSS-var material `--fn-review-ink`, not the entire icon. Ink-coloured details receive a fine neutral rim so white and black don't vanish.
- The actual app should eventually bind `--fn-review-ink` to the currently selected ink colour (including when a preset or pen type changes); the gallery's swatches are a visual test only.
- Existing lasso mode-sensitive button and existing Shapes specific-outline previews are *authoritative*; replacement candidates may improve silhouette but must **not** create redundant indicator strokes or override contextual state.
- Actual stroke-width choices, dash patterns, highlighter opacity and every working setting need to remain exact. Dynamic ink- and pressure-based rendering is separate from static pictograms.
- No hard-coded light/dark chrome backgrounds, no decorative loops, gradients, emoji, or larger-than-native tool glyphs.
- Accessible labels, 44pt iPad touch targets where actionable, reduced-motion setting and focus/keyboard interactions remain functional.
- Full review of all affected UI surfaces before activation: primary and secondary toolbars; in-tool popovers; selection bars; page sidebar/contents; New Notebook; notebook settings; file explorer and ribbon; Markdown Handwrite Here; image, scan, audio, PDF and Companion PDF; circuit editor; command palette; newer upstream Home/Library when ported.
- Preserve the previous icon as a fallback when an unapproved icon is not available.

## Validation

Automated tests added: `tests/view/icon-family.test.ts` checks inventory uniqueness, namespaced registration, meaningful ink fills, and retained Lasso/Shapes behavior metadata. CI (once the draft PR is opened) should run lint, plugin-review lint, TypeScript, Vitest and production build. **Physical iPad legibility, color contrast, dynamic ink state and tap behavior still require device review.**

The gallery is not an icon-switching feature. In the next stage, implement only individually **approved** candidates through a centralized semantic icon registry while preserving rejected icons and existing behavior. This stage must be separately verified and explicitly approved before merging into `integration/kolten`.
