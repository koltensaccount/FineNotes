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
}

/**
 * The small tip fill (and only the tip) takes the selected ink.
 * A subtle outline keeps white/black inks visible against nearby surfaces.
 */
const tip = (d: string): string =>
  `<path class="fnv2-ink" d="${d}" fill="var(--fn-review-ink,#4184df)" stroke="currentColor" stroke-width=".6"/>`;

/**
 * All three:
 * - match the 45° visual rhythm of the approved mockup #2,
 * - use 1.6-unit neutral outlines, with rounded joins and caps,
 * - reserve details for legibility at 24 px; no decorative preview strokes.
 *
 * New ids are intentional: invalidates prior decisions on rejected art.
 */
export const ICON_FAMILY_CANDIDATES: readonly IconFamilyCandidate[] = [
  {
    id: "pen-concept2",
    title: "Pen",
    category: "Writing tools",
    original: "fn-original-pen",
    usage: "Main Pen tool — compare with its real active stroke preview. A minimal digital stylus.",
    svg: `<path d="M7.35 16.30 16.55 4.85Q17.55 3.55 18.70 4.5Q19.85 5.4 18.85 6.68L9.65 18.10Z"/><path d="M7.35 16.30 9.65 18.10 5.15 21.75Z"/><path d="M16.8 4.55 19.0 6.25"/>${tip("M5.15 21.75 5.95 20.35 6.55 20.68Z")}`,
  },
  {
    id: "highlighter-concept2",
    title: "Highlighter",
    category: "Writing tools",
    original: "fn-original-highlighter",
    usage: "Pen-type picker and highlighter state — same axis, wider barrel and chisel tip.",
    svg: `<path d="M7.85 14.75 15.85 4.45Q16.45 3.6 17.55 4.15L19.5 5.65Q20.55 6.45 19.85 7.35L11.85 17.6Z"/><path d="M7.85 14.75 11.85 17.6 7.45 21.35 4.85 19.3Z"/><path d="M16.2 4.1 20.0 7.05"/>${tip("M4.85 19.3 7.45 21.35 8.9 19.9 6.3 17.85Z")}`,
  },
  {
    id: "eraser-concept2",
    title: "Eraser",
    category: "Writing tools",
    original: "eraser",
    usage: "Main Eraser tool — recognizable two-part block, without extra decoration.",
    svg: `<path d="M4.5 14.25 14.3 4.6Q15.2 3.7 16.2 4.55L20.15 8.35Q21 9.2 20.1 10.1L10.3 19.9H7.75L4.5 16.7Q3.3 15.5 4.5 14.25Z"/><path d="M8.45 10.2 14.6 16.2"/>`,
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
        `<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${candidate.svg}</g>`,
      );
    } catch {
      // The current production icons are untouched if SVG registration fails.
    }
  }
}
