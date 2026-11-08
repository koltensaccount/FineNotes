/**
 * FineNotes Icon Studio — Concept #2, refinement pass.
 *
 * ONLY the three writing-instrument candidates intentionally remain.
 * The original 28-icon experiment was rejected as visually inconsistent;
 * standard utility icons and stateful Lasso/Shapes glyphs remain unchanged.
 *
 * This module registers review-only SVGs. It does not replace any production
 * icon until the user approves individual candidates in a separate stage.
 */
import { addIcon } from "obsidian";

export type IconReviewDecision = "approved" | "rejected";
export type IconFamilyGroup = "Writing tools";

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
];

export function candidateIconName(id: string): string {
  return `finenotes-concept2-${id}`;
}

export function registerIconFamilyCandidates(): void {
  for (const candidate of ICON_FAMILY_CANDIDATES) {
    try {
      addIcon(
        candidateIconName(candidate.id),
        `<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <g transform="rotate(45 12 12)">${candidate.svg}</g>
        </g>`,
      );
    } catch {
      // The current production icons are untouched if SVG registration fails.
    }
  }
}
