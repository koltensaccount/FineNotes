/** Illustrative SVG samples only: never changes sampling, ink, or notebook storage. */
import { DEFAULT_HIGHLIGHTER_ALPHA } from "../constants";
import { parseHexColor } from "../model/colors";
import { CSS_PX_PER_MM, formatMm, PAGE_PX_PER_MM } from "../model/units";
export type PreviewTool = "ball" | "fountain" | "brush" | "highlighter";
export interface StrokePreviewOptions {
  type: PreviewTool;
  width: number;
  color?: string;
  lineStyle?: "solid" | "dashed" | "dotted";
  highlighterAlpha?: number;
  pressure?: boolean;
  paper?: string;
  compact?: boolean;
}
export const TOOL_HINTS: Record<PreviewTool, string> = {
  ball: "Even, uniform ink",
  fountain: "Fine nib · optional pressure",
  brush: "Expressive · wider nib",
  highlighter: "Broad, translucent marker",
};
export function effectivePreviewWidth(type: PreviewTool, width: number): number {
  return Math.max(
    0.5,
    Math.max(type === "highlighter" ? 2 : 0, width) *
      (type === "highlighter" ? 4 : type === "brush" ? 1.8 : 1),
  );
}
export function previewThicknessLabel(type: PreviewTool, width: number): string {
  return formatMm(effectivePreviewWidth(type, width));
}
/** The same multiply/alpha treatment used by FineNotes highlighter ink, against paper. */
export function highlighterSwatch(
  color: string,
  alpha = DEFAULT_HIGHLIGHTER_ALPHA,
  paper = "#ffffff",
): string {
  const ink = parseHexColor(color) ?? "#000000",
    background = parseHexColor(paper) ?? "#ffffff";
  const a = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : DEFAULT_HIGHLIGHTER_ALPHA));
  return (
    "#" +
    [1, 3, 5]
      .map((i) =>
        Math.round(
          parseInt(background.slice(i, i + 2), 16) *
            (1 - a + (a * parseInt(ink.slice(i, i + 2), 16)) / 255),
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export function strokePreviewGeometry(options: StrokePreviewOptions) {
  const compact = options.compact === true,
    h = compact ? 32 : 64,
    w = compact ? 96 : 160;
  const width = Math.max(
    0.7,
    Math.min(
      h - 12,
      (effectivePreviewWidth(options.type, options.width) * CSS_PX_PER_MM * (compact ? 2 : 1)) /
        PAGE_PX_PER_MM,
    ),
  );
  const centre = h / 2,
    from = 12,
    to = w - 12;
  const expressive =
    options.pressure !== false && (options.type === "fountain" || options.type === "brush");
  const path =
    options.type === "ball" || options.type === "highlighter"
      ? `M${from} ${centre}H${to}`
      : options.type === "fountain"
        ? `M${from} ${centre + 4}Q${w * 0.38} ${centre - 8} ${w * 0.56} ${centre}T${to} ${centre - 3}`
        : `M${from} ${centre + 6}C${w * 0.3} ${centre - 13} ${w * 0.53} ${centre + 13} ${to} ${centre - 6}`;
  // Width varies smoothly in a single illustrative ribbon, with no dependency on the ink engine.
  const ribbon =
    options.type === "brush"
      ? `M${from} ${centre + 6}C${w * 0.3} ${centre - 13 - width * 0.5} ${w * 0.52} ${centre + 13 - width * 0.7} ${to} ${centre - 6}C${w * 0.52} ${centre + 13 + width * 0.7} ${w * 0.3} ${centre - 13 + width * 0.5} ${from} ${centre + 6}Z`
      : `M${from} ${centre + 4}Q${w * 0.38} ${centre - 8 - width * 0.35} ${w * 0.56} ${centre - width * 0.5}Q${w * 0.8} ${centre + 5 - width * 0.3} ${to} ${centre - 3}Q${w * 0.8} ${centre + 5 + width * 0.3} ${w * 0.56} ${centre + width * 0.5}Q${w * 0.38} ${centre - 8 + width * 0.35} ${from} ${centre + 4}Z`;
  return {
    w,
    h,
    width,
    path,
    ribbon,
    expressive,
    style: options.type === "highlighter" ? "solid" : (options.lineStyle ?? "solid"),
  };
}
/** Local UI contrast only; stored and rendered notebook colors are untouched. */
function uiBackground(doc: Document): string {
  const win = doc.defaultView;
  let surface: Element | null = doc.querySelector?.(".goodobsidian-popover, .goodobsidian-options") ?? doc.body;
  let value = "";
  while (surface && win) {
    value = win.getComputedStyle(surface).backgroundColor;
    if (value !== "transparent" && !/rgba\([^)]*,\s*0\s*\)/.test(value)) break;
    surface = surface.parentElement;
  }
  const rgb = value.match(/rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/);
  return rgb ? "#" + rgb.slice(1, 4).map(v => Number(v).toString(16).padStart(2, "0")).join("") : "#ffffff";
}
function luminance(color: string): number {
  const hex = parseHexColor(color) ?? "#ffffff";
  const channels = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
const NS = "http://www.w3.org/2000/svg";
export function createStrokePreview(options: StrokePreviewOptions, doc: Document): SVGSVGElement {
  const g = strokePreviewGeometry(options),
    svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${g.w} ${g.h}`);
  svg.setAttribute("class", "goodobsidian-stroke-preview");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `${options.type} ${previewThicknessLabel(options.type, options.width)} thickness${g.style !== "solid" ? `, ${g.style}` : ""}`,
  );
  svg.setAttribute("data-preview-tool", options.type);
  svg.setAttribute("data-preview-style", g.style);
  const color = options.color ?? "currentColor";
  const background = uiBackground(doc);
  const path = doc.createElementNS(NS, "path");
  path.setAttribute("d", g.expressive && g.style === "solid" ? g.ribbon : g.path);
  path.setAttribute("fill", g.expressive && g.style === "solid" ? color : "none");
  if (!g.expressive || g.style !== "solid") {
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", String(g.width));
    path.setAttribute("stroke-linecap", "round");
    if (g.style === "dashed")
      path.setAttribute("stroke-dasharray", `${g.width * 3} ${g.width * 3}`);
    if (g.style === "dotted") path.setAttribute("stroke-dasharray", `0 ${g.width * 3}`);
  }
  if (options.type === "highlighter") {
    {
      path.setAttribute("stroke", color);
      path.setAttribute("opacity", String(options.highlighterAlpha ?? DEFAULT_HIGHLIGHTER_ALPHA));
    }
    svg.setAttribute(
      "data-highlighter-alpha",
      String(options.highlighterAlpha ?? DEFAULT_HIGHLIGHTER_ALPHA),
    );
  }
  const ink = options.type === "highlighter" ? highlighterSwatch(color, options.highlighterAlpha, background) : color;
  if (parseHexColor(color)) {
    const a = luminance(ink), b = luminance(background);
    if ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) < 2) {
      const halo = path.cloneNode(true) as SVGPathElement;
      halo.setAttribute("class", "goodobsidian-stroke-halo");
      halo.setAttribute("fill", "none");
      halo.setAttribute("stroke", "var(--text-muted)");
      halo.setAttribute("stroke-width", String(g.expressive && g.style === "solid" ? 1.5 : g.width + 1.5));
      halo.setAttribute("stroke-linejoin", "round");
      halo.setAttribute("opacity", "0.55");
      halo.setAttribute("aria-hidden", "true");
      // Clone retains the exact dash/dot intervals: the underlay never bridges gaps.
      svg.append(halo);
    }
  }
  svg.append(path);
  return svg;
}
