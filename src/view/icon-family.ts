/**
 * FineNotes icon studio: original, opt-in glyph candidates.
 *
 * THESE ARE NOT PRODUCTION REPLACEMENTS. The comparison gallery shows the
 * current Obsidian/FineNotes icon beside each candidate; approving stores
 * a review decision without changing live notebook chrome.
 *
 * Every candidate uses a 24-unit grid and a neutral, theme-aware outline.
 * A small <path class="fnv2-ink"> is the only ink-coloured material.
 * Do not merge upstream's newer pen icon paths into this artwork.
 */
import { addIcon } from "obsidian";

export type IconReviewDecision = "approved" | "rejected";
export type IconFamilyGroup =
  | "Writing tools"
  | "Selection and editing"
  | "Notebooks and embeds"
  | "Media and PDF"
  | "Circuit editor";

export interface IconFamilyCandidate {
  readonly id: string;
  readonly title: string;
  readonly category: IconFamilyGroup;
  /** Current Obsidian icon id, or a special preview of the fork's current stroke. */
  readonly original: string;
  /** Actual locations this concept is intended to replace, not a claim it is installed. */
  readonly usage: string;
  readonly svg: string;
  /** Preserve a stateful icon behavior instead of showing a static design everywhere. */
  readonly preserveState?: string;
}

const ink = (d: string): string =>
  `<path class="fnv2-ink" d="${d}" fill="var(--fn-review-ink,#4184df)" stroke="currentColor" stroke-width=".75"/>`;

/** Original SVG artwork, deliberately independent of the newer upstream glyph files. */
export const ICON_FAMILY_CANDIDATES: readonly IconFamilyCandidate[] = [
  {
    id: "pen", title: "Pen", category: "Writing tools", original: "fn-original-pen",
    usage: "Primary Pen tool; shared with the active pen-type picker",
    svg: `<path d="M5.1 17.8 16.8 4.5a2.2 2.2 0 0 1 3.3 2.9L8.4 20.7 3.8 22z"/><path d="m16.1 5.3 3 2.8M14.8 6.8l3.1 2.8"/>${ink("M5.1 17.8 8.4 20.7 3.8 22z")}`,
  },
  {
    id: "highlighter", title: "Highlighter", category: "Writing tools", original: "fn-original-highlighter",
    usage: "Highlighter pen type, palettes and writing options",
    svg: `<path d="m6.8 14.9 8.5-9.7c.6-.7 1.6-.8 2.3-.2l2 1.8c.7.6.8 1.6.2 2.3L11 18.9"/><path d="m6.8 14.9 4.2 4-3.5 3-4.4-4.1zM15 9.2l3.4 3.1"/>${ink("m3.1 17.8 4.4 4.1-4.1.1z")}`,
  },
  {
    id: "ballpoint", title: "Ballpoint", category: "Writing tools", original: "fn-original-pen",
    usage: "Pen type chooser; representative instrument artwork, not a second toolbar preview",
    svg: `<path d="m5.9 17.3 9.4-11.9 3.3 2.6-9.3 11.9-4.3 2zM15.3 5.4l1-1.2a1.8 1.8 0 0 1 2.6-.3l1.6 1.2a1.8 1.8 0 0 1 .2 2.6l-2.1 2.2"/><path d="m6 17.3 3.3 2.6"/>${ink("m5 21.9 1-4.6 3.3 2.6z")}`,
  },
  {
    id: "brush", title: "Brush", category: "Writing tools", original: "fn-original-brush",
    usage: "Brush pen-type chooser; minimal bristle silhouette",
    svg: `<path d="m9 13.2 6.8-8.6a2 2 0 0 1 2.8-.4 2 2 0 0 1 .4 2.8L12 15.8M9 13.2l3 2.6"/><path d="M9 13.2c-2.8 1-3.2 3.5-3.7 5.5-.3 1.2-1.3 2.4-2.4 3.1 3.5-.2 7.3-1.5 9.1-6z"/>${ink("M9 13.2c-2.8 1-3.2 3.5-3.7 5.5-.3 1.2-1.3 2.4-2.4 3.1 3.5-.2 7.3-1.5 9.1-6z")}`,
  },
  {
    id: "eraser", title: "Eraser", category: "Writing tools", original: "eraser",
    usage: "Primary eraser; existing eraser mode and footprint remain unchanged",
    svg: `<path d="m3.6 13.4 8.9-9a2.4 2.4 0 0 1 3.4 0l4 4a2.4 2.4 0 0 1 0 3.4l-8.4 8.4H7.8l-4.2-4.1a2 2 0 0 1 0-2.7Z"/><path d="m8.6 8.4 7.3 7.3M11.5 20.2H21"/>`,
  },
  {
    id: "erase-stroke", title: "Erase whole stroke", category: "Writing tools", original: "spline",
    usage: "Eraser mode picker only; the main eraser remains a plain eraser",
    svg: `<path d="M3.4 18.1c3.4-9.8 8.4-3 12.9-12.2" stroke-dasharray="3.2 2.4"/><path d="m12.5 13.1 3.9-4 4.3 4.2-3.9 4H13z"/><path d="M15.3 17.3H22"/>`,
  },
  {
    id: "lasso-free", title: "Freehand lasso", category: "Selection and editing", original: "lasso",
    usage: "Main Lasso icon in freehand mode, plus its selection-mode menu",
    preserveState: "Current freehand/rectangle switching remains authoritative",
    svg: `<path d="M5.1 17.2C1.7 13.2 4 6.8 10.3 5.2c8.5-2.3 12.2 3.2 9.1 9.2-2.3 4.7-7.5 3.8-10 3.3" stroke-dasharray="3 3"/><path d="m7.8 17.4-2.6 4-2-4.4"/>`,
  },
  {
    id: "lasso-rect", title: "Rectangular lasso", category: "Selection and editing", original: "finenotes-rectangular-lasso",
    usage: "Main Lasso icon in rectangle mode, plus its selection-mode menu",
    preserveState: "Current freehand/rectangle switching remains authoritative",
    svg: `<rect x="4" y="4" width="16" height="15" rx="1.8" stroke-dasharray="3.1 2.6"/><path d="m8 19-2 3-2-3"/>`,
  },
  {
    id: "shapes", title: "Shapes", category: "Writing tools", original: "shapes",
    usage: "Primary Shapes tool chrome (not the shape-specific drawing previews)",
    preserveState: "Keep existing shape-specific preview glyphs unchanged",
    svg: `<rect x="3.6" y="4.3" width="12.1" height="12.1" rx="1.7"/><circle cx="16.3" cy="16.1" r="5.2"/>`,
  },
  {
    id: "text", title: "Text", category: "Writing tools", original: "type",
    usage: "Text tool, insertion and text-editing entry points",
    svg: `<path d="M4.3 7V4.5h15.4V7M12 4.5v15M8.7 19.5h6.6"/>`,
  },
  {
    id: "image", title: "Image", category: "Media and PDF", original: "image",
    usage: "Insert Image tool, gallery and picture actions",
    svg: `<rect x="3.3" y="4.2" width="17.4" height="15.6" rx="2.3"/><circle cx="8.3" cy="9" r="1.65"/><path d="m4.9 17 5-5 3.5 3 2.3-2.2 3.4 4.2"/>`,
  },
  {
    id: "record", title: "Record", category: "Media and PDF", original: "mic",
    usage: "Record toolbar button and microphone actions",
    svg: `<rect x="9.1" y="2.6" width="5.8" height="12.4" rx="2.9"/><path d="M6.2 11.7a5.8 5.8 0 0 0 11.6 0M12 17.6v3.6M8.6 21.2h6.8"/>`,
  },
  {
    id: "new-notebook", title: "New notebook", category: "Notebooks and embeds", original: "notebook-pen",
    usage: "Ribbon, file explorer and creation menus",
    svg: `<rect x="5.3" y="3.4" width="14.2" height="17.5" rx="2.3"/><path d="M8.4 3.4v17.5M11.5 8.5h5.1M11.5 12h4"/><path d="m15.6 16 3.8-4.1 1.5 1.4-3.8 4.2-2.5.6z"/>`,
  },
  {
    id: "new-page", title: "Add page", category: "Notebooks and embeds", original: "file-plus",
    usage: "Page sidebar, add-page and page creation controls",
    svg: `<path d="M5.2 3.3h9.2l4.2 4.2v13.2H5.2zM14.4 3.3v4.2h4.2"/><path d="M12 11v7M8.5 14.5h7"/>`,
  },
  {
    id: "bookmark", title: "Bookmark", category: "Notebooks and embeds", original: "bookmark",
    usage: "Pages sidebar bookmark actions and bookmarked-state controls",
    svg: `<path d="M6.1 4.1h11.8v16.1l-5.9-4.1-5.9 4.1z"/>`,
  },
  {
    id: "contents", title: "Contents", category: "Notebooks and embeds", original: "list",
    usage: "Contents sidebar and add/remove contents actions",
    svg: `<path d="M8 5.7h12M8 11.9h12M8 18.1h12"/><path d="m3.4 5.4 1 1 1.7-1.9M3.4 11.6l1 1 1.7-1.9M3.4 17.8l1 1 1.7-1.9"/>`,
  },
  {
    id: "templates", title: "Templates", category: "Notebooks and embeds", original: "layout-template",
    usage: "New notebook templates and change-template actions",
    svg: `<rect x="3.3" y="3.5" width="17.4" height="17" rx="1.8"/><path d="M3.3 9.4h17.4M10 9.4v11.1M13.5 6.4h4.2"/>`,
  },
  {
    id: "writing-guides", title: "Writing guides", category: "Notebooks and embeds", original: "notebook-pen",
    usage: "Writing-guide tool controls and notebook guide settings",
    svg: `<rect x="4" y="4" width="16" height="16" rx="1.8"/><path d="M4 9h16M4 14h16M8 4v16" opacity=".65"/><path d="m11 16 2.5-2.8 3.5 3.4"/>`,
  },
  {
    id: "copy-embed", title: "Copy embed", category: "Notebooks and embeds", original: "file-code-2",
    usage: "Selection bar, page sidebar and More menu (preserve Copy Embed workflow)",
    svg: `<path d="M7 3.5h8.5l3.5 3.7v11.3H7zM15.5 3.5v3.7H19"/><path d="m11 11-2 2 2 2m4-4 2 2-2 2M4 7.5v13h10"/>`,
  },
  {
    id: "handwrite-here", title: "Handwrite Here", category: "Notebooks and embeds", original: "pen-tool",
    usage: "Markdown insertion command and future inline block control",
    svg: `<rect x="3.3" y="4.1" width="14.8" height="16" rx="1.9"/><path d="M6.2 8.3h8M6.2 11.9h5.5"/><path d="m11 17 7.1-8.1 2.4 2.1-7.1 8.1-3 .7z"/>${ink("m10.4 19.8.6-2.8 2.4 2.1z")}`,
  },
  {
    id: "scan", title: "Scan document", category: "Media and PDF", original: "scan-line",
    usage: "Image insertion and camera/document scanning commands",
    svg: `<path d="M8 3.9H5a1.2 1.2 0 0 0-1.2 1.2v3M16 3.9h3a1.2 1.2 0 0 1 1.2 1.2v3M3.8 16v2.9A1.2 1.2 0 0 0 5 20.1h3M20.2 16v2.9a1.2 1.2 0 0 1-1.2 1.2h-3"/><path d="M6.4 12h11.2M8.1 8.5h7.8M8.1 15.5h7.8"/>`,
  },
  {
    id: "pdf", title: "PDF", category: "Media and PDF", original: "file-text",
    usage: "PDF insertion, import, page background and export entry points",
    svg: `<path d="M5.8 3.3h8.5l4 4.2v13.2H5.8zM14.3 3.3v4.2h4"/><path d="M8.9 12.4h6.1M8.9 15.4h6.1M8.9 18.4h3.7"/>`,
  },
  {
    id: "companion-pdf", title: "Companion PDF", category: "Media and PDF", original: "file-check",
    usage: "Companion PDF settings/status and refresh actions",
    svg: `<path d="M5.1 3.3h8.8L18 7.5v13H5.1zM13.9 3.3v4.2H18"/><path d="m8.4 14.2 2.5 2.4 5-5.3"/>`,
  },
  {
    id: "crop", title: "Crop", category: "Selection and editing", original: "crop",
    usage: "Image selection action menu and crop controls",
    svg: `<path d="M5.5 3.4v13.1h13.1M3.4 5.5h13.1v13.1M8.6 8.5h7.9v7.9" stroke-linejoin="miter"/>`,
  },
  {
    id: "move", title: "Move item", category: "Selection and editing", original: "move",
    usage: "Selection/group actions and move-page controls",
    svg: `<path d="M12 2.9v18.2M2.9 12h18.2M9.1 5.8 12 2.9l2.9 2.9M9.1 18.2l2.9 2.9 2.9-2.9M5.8 9.1 2.9 12l2.9 2.9M18.2 9.1l2.9 2.9-2.9 2.9"/>`,
  },
  {
    id: "circuit", title: "Circuit editor", category: "Circuit editor", original: "cpu",
    usage: "Existing bespoke circuit creation and editing actions",
    svg: `<rect x="4.4" y="5.2" width="15.2" height="13.6" rx="1.4"/><path d="M7.5 12h2.1l1.2-3.2 2.3 6.3 1.3-3.1h2.1M8 2.8v2.4M16 2.8v2.4M8 18.8v2.4M16 18.8v2.4M2.3 9h2.1M19.6 9h2.1M2.3 15h2.1M19.6 15h2.1"/>`,
  },
  {
    id: "circuit-wire", title: "Circuit wire", category: "Circuit editor", original: "git-branch",
    usage: "Visual circuit editor: wire and connection tools",
    svg: `<path d="M5 19V6h8v6h6"/><circle cx="5" cy="19" r="1.8"/><circle cx="5" cy="5" r="1.8"/><circle cx="19" cy="12" r="1.8"/>`,
  },
  {
    id: "circuit-component", title: "Circuit component", category: "Circuit editor", original: "git-commit",
    usage: "Visual circuit editor: electronic components",
    svg: `<path d="M2.5 12h4l1.5-3 3 6 3-6 3 6 1.5-3h3"/><circle cx="2.5" cy="12" r="1"/><circle cx="21.5" cy="12" r="1"/>`,
  },
] as const;

export function candidateIconName(id: string): string {
  return `finenotes-v2-${id}`;
}

export function registerIconFamilyCandidates(): void {
  for (const candidate of ICON_FAMILY_CANDIDATES) {
    try {
      addIcon(
        candidateIconName(candidate.id),
        `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${candidate.svg}</g>`,
      );
    } catch {
      // Keep an older Obsidian build usable: the current icon is always retained.
    }
  }
}
