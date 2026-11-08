/**
 * FineNotes Icon Studio — Concept #2, refinement pass.
 *
 * Review-only candidates, grouped by the batch in which they were proposed.
 */
import { addIcon } from "obsidian";
import { ICON_NEW_NOTEBOOK } from "../constants";

export type IconReviewDecision = "approved" | "rejected";
export type IconFamilyGroup = "Writing tools" | "Notebook and pages" | "Import and convert";

export interface IconFamilyCandidate {
  readonly id: string;
  readonly title: string;
  readonly category: IconFamilyGroup;
  /** The current FineNotes icon or live stroke-preview source. */
  readonly original: string;
  readonly usage: string;
  /** Original 24×24 SVG fragments, drawn from one shared design grammar. */
  readonly svg: string;
  /** Optional note explaining preserved live behavior. */
  readonly preserveState?: string;
}

// Paint the ink beneath the outline. Its edges share the outer path's coordinates.
const tip = (d: string): string =>
  `<path class="fnv2-ink" d="${d}" fill="var(--fn-review-ink,#4184df)" stroke="none"/>`;

// Each profile is drawn tip-down, then tilted 45° about the center of the 24-unit grid.
// Butt-ended seams meet the centerline of the outline without protruding past it.
const seam = (d: string): string => `<path d="${d}" stroke-linecap="butt"/>`;

export const ICON_FAMILY_CANDIDATES: readonly IconFamilyCandidate[] = [
  {
    id: "pen-concept2",
    title: "Pen",
    category: "Writing tools",
    original: "fn-original-pen",
    usage: "Main Pen tool — compare with its real active stroke preview. A minimal digital stylus.",
    svg: `
      ${tip("M10.25 17H13.75L12 22Z")}
      <path d="M9.9 16V4.9A2.1 2.1 0 0 1 14.1 4.9V16L12 22Z"/>
      ${seam("M9.9 7.4H14.1")}
    `,
  },
  {
    id: "highlighter-concept2",
    title: "Highlighter",
    category: "Writing tools",
    original: "fn-original-highlighter",
    usage: "Pen-type picker and highlighter state — same axis, wider barrel and chisel tip.",
    svg: `
      ${tip("M10 18.8H14L13.85 21.6H10.15Z")}
      <path d="M9.25 14.8V4.4A1.6 1.6 0 0 1 10.85 2.8H13.15A1.6 1.6 0 0 1 14.75 4.4V14.8L14 18.8L13.85 21.6H10.15L10 18.8Z"/>
      ${seam("M9.25 14.8H14.75")}
    `,
  },
  {
    id: "eraser-concept2",
    title: "Eraser",
    category: "Writing tools",
    original: "eraser",
    usage: "Main Eraser tool — recognizable two-part block, without extra decoration.",
    svg: `
      <path d="M8.25 19V5.6A1.6 1.6 0 0 1 9.85 4H14.15A1.6 1.6 0 0 1 15.75 5.6V19L13.75 21H10.25Z"/>
      ${seam("M8.25 14.1H15.75")}
    `,
  },
  {
    id: "new-notebook-concept2",
    title: "New notebook",
    category: "Notebook and pages",
    original: ICON_NEW_NOTEBOOK,
    usage: "Ribbon and file actions — a bound notebook with a small plus.",
    svg: `
      <path d="M7 3.5H17A2 2 0 0 1 19 5.5V18.5A2 2 0 0 1 17 20.5H7A2 2 0 0 1 5 18.5V5.5A2 2 0 0 1 7 3.5Z"/>
      ${seam("M8.5 3.5V20.5")}
      <path d="M11.5 12H16M13.75 9.75V14.25"/>
    `,
  },
  {
    id: "page-thumbnails-concept2",
    title: "Page thumbnails",
    category: "Notebook and pages",
    original: "panel-left",
    usage: "Notebook toolbar — a strip of page thumbnails beside the open page.",
    svg: `
      <path d="M5.5 4H18.5A2 2 0 0 1 20.5 6V18A2 2 0 0 1 18.5 20H5.5A2 2 0 0 1 3.5 18V6A2 2 0 0 1 5.5 4Z"/>
      ${seam("M9.5 4V20")}
      <path d="M6.5 8V10M6.5 14V16M13 9H17M13 13H16"/>
    `,
  },
  {
    id: "add-page-concept2",
    title: "Add page",
    category: "Notebook and pages",
    original: "plus",
    usage: "Notebook toolbar — a loose sheet with a folded corner and a plus.",
    svg: `
      <path d="M7 3.5H14L19 8.5V18.5A2 2 0 0 1 17 20.5H7A2 2 0 0 1 5 18.5V5.5A2 2 0 0 1 7 3.5Z"/>
      ${seam("M14 3.5V8.5H19")}
      <path d="M9.5 14H14.5M12 11.5V16.5"/>
    `,
  },
  {
    id: "import-pdf-concept2",
    title: "Import PDF",
    category: "Import and convert",
    original: "file-text",
    usage: "PDF file actions and notebook menu — a folded sheet with an inward arrow.",
    svg: `
      <path d="M9 8V5.5A2 2 0 0 1 11 3.5H16L20 7.5V18.5A2 2 0 0 1 18 20.5H11A2 2 0 0 1 9 18.5V16"/>
      ${seam("M16 3.5V7.5H20")}
      <path d="M3.5 12H14M11 9L14 12L11 15"/>
    `,
  },
  {
    id: "scan-document-concept2",
    title: "Scan document",
    category: "Import and convert",
    original: "scan-line",
    usage: "Scan document action — a sheet framed by camera guides.",
    svg: `
      <path d="M3.5 8V5.5A2 2 0 0 1 5.5 3.5H8M16 3.5H18.5A2 2 0 0 1 20.5 5.5V8M20.5 16V18.5A2 2 0 0 1 18.5 20.5H16M8 20.5H5.5A2 2 0 0 1 3.5 18.5V16"/>
      <path d="M8 7.5H14L16 9.5V16.5H8Z"/>
      <path d="M10.5 13H13.5"/>
    `,
  },
  {
    id: "convert-notebook-concept2",
    title: "Convert to notebook",
    category: "Import and convert",
    original: "book-open",
    usage: "Single-page menu — an open notebook with a page turning into place.",
    svg: `
      <path d="M12 7.5C9.5 5.5 6.5 5.5 3.5 6.5V18.5C6.5 17.5 9.5 17.5 12 19.5C14.5 17.5 17.5 17.5 20.5 18.5V6.5"/>
      ${seam("M12 7.5V19.5")}
      <path d="M12 7.5C14 5.5 16 4.5 18 4.5V13.5C16 13.5 14 14.5 12 16.5"/>
    `,
  },
];

export function candidateIconName(id: string): string {
  return `finenotes-concept2-${id}`;
}

export function registerIconFamilyCandidates(): void {
  for (const candidate of ICON_FAMILY_CANDIDATES) {
    const artwork = candidate.category === "Writing tools"
      ? `<g transform="rotate(45 12 12)">${candidate.svg}</g>`
      : candidate.svg;
    try {
      addIcon(
        candidateIconName(candidate.id),
        `<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          ${artwork}
        </g>`,
      );
    } catch {
      // The current production icons are untouched if SVG registration fails.
    }
  }
}
