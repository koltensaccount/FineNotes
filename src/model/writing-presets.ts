/** Toolbar preferences only; notebook ink and geometry never change here. */
import { PALETTE, SIZES } from "../constants";
import { parseHexColor } from "./colors";
import { nearestStop, widthStops } from "./pen-widths";

export type WritingTool = "pen" | "highlighter";
export interface WritingPresets {
  version: 1;
  widths: number[];
  selectedWidth: number;
  palettes: Record<WritingTool, string[]>;
  selectedColors: Record<WritingTool, string>;
}
const STOPS = widthStops(SIZES, true);
export function normalizeWidth(width: number): number {
  return STOPS[nearestStop(STOPS, Number.isFinite(width) ? width : SIZES[1])];
}
export function sortedWidths(widths: readonly number[]): number[] {
  return [...new Set(widths.map(normalizeWidth))].sort((a, b) => a - b);
}
export function saveWidth(presets: WritingPresets, width: number, replacing?: number): void {
  const normalized = normalizeWidth(width);
  presets.widths = sortedWidths([...presets.widths.filter((v) => v !== replacing), normalized]);
  if (presets.selectedWidth === replacing) presets.selectedWidth = normalized;
}
export function removeWidth(presets: WritingPresets, width: number): void {
  presets.widths = presets.widths.filter((v) => v !== width);
}
export function colorList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.flatMap((v: unknown) => {
        const color = typeof v === "string" ? parseHexColor(v) : null;
        return color ? [color] : [];
      }),
    ),
  ];
}
export function saveColor(
  presets: WritingPresets,
  tool: WritingTool,
  color: string,
  index?: number,
): boolean {
  const normalized = parseHexColor(color);
  if (!normalized) return false;
  const colors = presets.palettes[tool];
  if (colors.some((v, i) => v === normalized && i !== index)) return false;
  if (index === undefined) colors.push(normalized);
  else {
    if (presets.selectedColors[tool] === colors[index]) presets.selectedColors[tool] = normalized;
    colors[index] = normalized;
  }
  return true;
}
export function moveColor(
  presets: WritingPresets,
  tool: WritingTool,
  from: number,
  to: number,
): void {
  const colors = presets.palettes[tool];
  if (from < 0 || to < 0 || from >= colors.length || to >= colors.length || from === to) return;
  const [color] = colors.splice(from, 1);
  colors.splice(to, 0, color);
}
export function restoreColors(presets: WritingPresets, tool: WritingTool): void {
  presets.palettes[tool] = [...PALETTE];
}
/** Idempotent upgrade: clone shared legacy colours into two independent palettes. */
export function migrateWritingPresets(settings: {
  writingPresets?: WritingPresets;
  customColors: string[];
  defaultColor: string;
  defaultSize: number;
}): WritingPresets {
  const saved = settings.writingPresets;
  const legacy = colorList([
    ...PALETTE,
    ...(Array.isArray(settings.customColors) ? settings.customColors : []),
  ]);
  const selected = parseHexColor(settings.defaultColor) ?? PALETTE[0];
  return {
    version: 1,
    widths: saved && Array.isArray(saved.widths) ? sortedWidths(saved.widths) : [...SIZES],
    // Preserve existing selected widths exactly, including values outside the slider.
    selectedWidth: Number.isFinite(saved?.selectedWidth)
      ? saved!.selectedWidth
      : settings.defaultSize,
    palettes: {
      pen:
        saved && Array.isArray(saved.palettes?.pen) ? colorList(saved.palettes.pen) : [...legacy],
      highlighter:
        saved && Array.isArray(saved.palettes?.highlighter)
          ? colorList(saved.palettes.highlighter)
          : [...legacy],
    },
    selectedColors: {
      pen: parseHexColor(saved?.selectedColors?.pen ?? "") ?? selected,
      highlighter: parseHexColor(saved?.selectedColors?.highlighter ?? "") ?? selected,
    },
  };
}
