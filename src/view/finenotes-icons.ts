/**
 * Locked FineNotes Visual Identity — Custom SVG Icon Family.
 *
 * PURE: icon IDs and 24×24 SVG fragments scaled to Obsidian's 100×100
 * `addIcon` viewBox via `scale(4.1667)` so Obsidian's `--icon-stroke`
 * (and FineNotes' `--gob-icon-stroke: 1.6px`) renders at uniform weight
 * across all themes and displays.
 */

export const FN_ICON_NEW_NOTEBOOK = "finenotes-new-notebook";
export const FN_ICON_ERASER = "finenotes-eraser";
export const FN_ICON_LASER = "finenotes-laser";
export const FN_ICON_FILL = "finenotes-fill";
export const FN_ICON_TAPE = "finenotes-tape";
export const FN_ICON_SAVED_PENS = "finenotes-saved-pens";
export const FN_ICON_IMPORT_PDF = "finenotes-import-pdf";
export const FN_ICON_SCAN_DOC = "finenotes-scan-doc";
export const FN_ICON_ADD_PAGE = "finenotes-add-page";
export const FN_ICON_CONVERT_NOTEBOOK = "finenotes-convert-notebook";
export const FN_ICON_MORE_TOOLS = "finenotes-more-tools";

const wrap = (inner: string): string =>
  `<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;

const ICONS: ReadonlyArray<readonly [string, string]> = [
  // P6-NEWNOTE-A: Spiral notebook + pen (Ribbon & File Explorer)
  [
    FN_ICON_NEW_NOTEBOOK,
    wrap(
      '<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/>' +
        '<path d="M2 6h4M2 10h4M2 14h4M2 18h4"/>' +
        '<path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>',
    ),
  ],
  // P1-ERASER-A: Concept #2 balanced two-part block (45° tilt)
  [
    FN_ICON_ERASER,
    wrap(
      '<g transform="rotate(45 12 12)">' +
        '<path d="M8.25 19V5.6A1.6 1.6 0 0 1 9.85 4H14.15A1.6 1.6 0 0 1 15.75 5.6V19L13.75 21H10.25Z"/>' +
        '<path d="M8.25 14.1H15.75" stroke-linecap="butt"/>' +
        "</g>",
    ),
  ],
  // P1-LASER-A: 45° Concept #2 barrel + glowing emitter tip
  [
    FN_ICON_LASER,
    wrap(
      '<g transform="rotate(45 12 12)">' +
        '<path d="M9.75 15.5V4.8A1.8 1.8 0 0 1 11.55 3H12.45A1.8 1.8 0 0 1 14.25 4.8V15.5L13.2 18H10.8Z"/>' +
        '<path d="M9.75 7.4H14.25" stroke-linecap="butt"/>' +
        '<circle cx="12" cy="20.6" r="1.35" fill="currentColor" stroke="none"/>' +
        '<path d="M8.4 20.6H6.9M15.6 20.6H17.1M9.5 18.4L8.5 17.5M14.5 18.4L15.5 17.5"/>' +
        "</g>",
    ),
  ],
  // P1-FILL-A: Paint bucket + drop at exact 1.6px, scale(1)
  [
    FN_ICON_FILL,
    wrap(
      '<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"/>' +
        '<path d="m5 2 5 5"/>' +
        '<path d="M2 13h15"/>' +
        '<path d="M20.5 14.8c0 0-2 2.4-2 3.7a2 2 0 0 0 4 0c0-1.3-2-3.7-2-3.7Z" fill="currentColor" fill-opacity="0.22"/>',
    ),
  ],
  // P1-TAPE-CODEX: Codex tape-fold.svg
  [
    FN_ICON_TAPE,
    '<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M2.8 10.5H12.8Q15.2 10.5 16.7 8.3L18.7 5.3L21.3 11L19.3 14Q17.7 16.5 15.1 16.5H2.8Z" fill="currentColor" fill-opacity="0.12"/>' +
      '<path d="M12.8 10.5Q15.2 10.5 16.7 8.3L18.7 5.3L21.3 11L19.3 14Q17.7 16.5 15.1 16.5Z" fill="currentColor" fill-opacity="0.24" stroke="none"/>' +
      '<path d="M3 6H11M3 20.5H17"/>' +
      "</g>",
  ],
  // P1-SAVEDPENS-A: Harmonized 1.6px 5-point star
  [
    FN_ICON_SAVED_PENS,
    wrap(
      '<path d="M12 3.2l2.62 5.31 5.86.85-4.24 4.13 1 5.84L12 16.57l-5.24 2.76 1-5.84L3.52 9.36l5.86-.85Z"/>',
    ),
  ],
  // P2-PDF-FORK: Concept #2 folded sheet with inward arrow
  [
    FN_ICON_IMPORT_PDF,
    wrap(
      '<path d="M6.5 8V5.5A2 2 0 0 1 8.5 3.5H16L20 7.5V18.5A2 2 0 0 1 18 20.5H8.5A2 2 0 0 1 6.5 18.5V16"/>' +
        '<path d="M16 3.5V7.5H20" stroke-linecap="butt"/>' +
        '<path d="M4 12H13M10.25 9.25L13 12L10.25 14.75"/>',
    ),
  ],
  // P2-SCAN-FORK: Concept #2 sheet framed by camera guides
  [
    FN_ICON_SCAN_DOC,
    wrap(
      '<path d="M3.5 8V5.5A2 2 0 0 1 5.5 3.5H8M16 3.5H18.5A2 2 0 0 1 20.5 5.5V8M20.5 16V18.5A2 2 0 0 1 18.5 20.5H16M8 20.5H5.5A2 2 0 0 1 3.5 18.5V16"/>' +
        '<path d="M9 7H13.5L16 9.5V16A1 1 0 0 1 15 17H9A1 1 0 0 1 8 16V8A1 1 0 0 1 9 7Z"/>' +
        '<path d="M10.5 13.25H13.5"/>',
    ),
  ],
  // P4-ADDPAGE-FORK: Concept #2 loose sheet with folded corner and plus
  [
    FN_ICON_ADD_PAGE,
    wrap(
      '<path d="M7 3.5H14L19 8.5V18.5A2 2 0 0 1 17 20.5H7A2 2 0 0 1 5 18.5V5.5A2 2 0 0 1 7 3.5Z"/>' +
        '<path d="M14 3.5V8.5H19" stroke-linecap="butt"/>' +
        '<path d="M9.5 14H14.5M12 11.5V16.5"/>',
    ),
  ],
  // P4-CONVERT-FORK: Concept #2 open notebook with page turning into place
  [
    FN_ICON_CONVERT_NOTEBOOK,
    wrap(
      '<path d="M12 7.5C9.5 5.5 6.5 5.5 3.5 6.5V18.5C6.5 17.5 9.5 17.5 12 19.5C14.5 17.5 17.5 17.5 20.5 18.5V7.5"/>' +
        '<path d="M12 7.5V19.5" stroke-linecap="butt"/>' +
        '<path d="M12 7.5C13.5 5.5 15.25 4.5 17.25 4.25Q17.75 4.2 17.75 4.75V12.75Q17.75 13.25 17.25 13.35C15.25 13.65 13.5 14.6 12 16.5"/>',
    ),
  ],
  // P5-MORE-TOOLS-A: 1.6px 4-tile grid + plus (Accessories / More tools)
  [
    FN_ICON_MORE_TOOLS,
    wrap(
      '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/>' +
        '<rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/>' +
        '<rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/>' +
        '<path d="M17 14v6M14 17h6"/>',
    ),
  ],
];

let registered = false;

/** Register all custom FineNotes visual-identity icons with Obsidian once. */
export function registerFineNotesIcons(register: (id: string, svg: string) => void): void {
  if (registered) return;
  registered = true;
  for (const [id, svg] of ICONS) {
    register(id, svg);
  }
}
