/** Toolbar preferences only; notebook ink and geometry never change here. */
import { PALETTE, SIZES, HIGHLIGHTER_COLORS, HIGHLIGHTER_SIZES } from "../constants";
import { parseHexColor } from "./colors";
import { nearestStop, widthStops } from "./pen-widths";

export type WritingTool = "pen" | "highlighter";
export interface ColorPreset {
  id: string;
  color: string;
}
export interface WritingPresets {
  version: 3;
  nextColorId: number;
  widths: number[];
  selectedWidth: number;
  highlighterWidths: number[];
  selectedHighlighterWidth: number;
  palettes: Record<WritingTool, ColorPreset[]>;
  selectedIds: Record<WritingTool, string | null>;
}
export function selectedPreset(
  presets: WritingPresets,
  tool: WritingTool,
): ColorPreset | undefined {
  return presets.palettes[tool].find((preset) => preset.id === presets.selectedIds[tool]);
}
export function selectedColor(presets: WritingPresets, tool: WritingTool): string {
  return selectedPreset(presets, tool)?.color ?? PALETTE[0];
}
export function selectPreset(presets: WritingPresets, tool: WritingTool, id: string): boolean {
  if (!presets.palettes[tool].some((preset) => preset.id === id)) return false;
  presets.selectedIds[tool] = id;
  return true;
}
/** Settings/API color picks reuse a matching preset, or create one. */
export function selectColor(presets: WritingPresets, tool: WritingTool, color: string): void {
  const normalized = parseHexColor(color);
  if (!normalized) return;
  const preset =
    presets.palettes[tool].find((entry) => entry.color === normalized) ??
    saveColor(presets, tool, normalized);
  if (preset) presets.selectedIds[tool] = preset.id;
}
const STOPS = widthStops(SIZES, true);
export function normalizeWidth(width: number): number {
  return STOPS[nearestStop(STOPS, Number.isFinite(width) ? width : SIZES[1])];
}
export function sortedWidths(widths: readonly number[]): number[] {
  return [...new Set(widths.map(normalizeWidth))].sort((a, b) => a - b);
}
export function widthsFor(presets: WritingPresets, tool: WritingTool): number[] {
  return tool === "highlighter" ? presets.highlighterWidths : presets.widths;
}
export function selectedWidthFor(presets: WritingPresets, tool: WritingTool): number {
  return tool === "highlighter" ? presets.selectedHighlighterWidth : presets.selectedWidth;
}
export function selectWidth(presets: WritingPresets, tool: WritingTool, width: number): void {
  if (tool === "highlighter") presets.selectedHighlighterWidth = width;
  else presets.selectedWidth = width;
}
export function saveWidth(
  presets: WritingPresets,
  width: number,
  replacing?: number,
  tool: WritingTool = "pen",
): void {
  const normalized = normalizeWidth(width),
    values = sortedWidths([...widthsFor(presets, tool).filter((v) => v !== replacing), normalized]);
  if (tool === "highlighter") presets.highlighterWidths = values;
  else presets.widths = values;
  if (selectedWidthFor(presets, tool) === replacing) selectWidth(presets, tool, normalized);
}
export function removeWidth(
  presets: WritingPresets,
  width: number,
  tool: WritingTool = "pen",
): void {
  const values = widthsFor(presets, tool).filter((v) => v !== width);
  if (tool === "highlighter") presets.highlighterWidths = values;
  else presets.widths = values;
}
export function restoreWidths(presets: WritingPresets, tool: WritingTool): void {
  if (tool === "highlighter") {
    presets.highlighterWidths = [...HIGHLIGHTER_SIZES];
    presets.selectedHighlighterWidth = HIGHLIGHTER_SIZES[1];
  } else {
    presets.widths = [...SIZES];
    presets.selectedWidth = SIZES[1];
  }
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
  id?: string,
): ColorPreset | null {
  const normalized = parseHexColor(color);
  if (!normalized) return null;
  if (id !== undefined) {
    const preset = presets.palettes[tool].find((entry) => entry.id === id);
    if (!preset) return null; // A stale editor must never edit another row or append.
    preset.color = normalized;
    return preset;
  }
  const preset = { id: `${tool}-${presets.nextColorId++}`, color: normalized };
  presets.palettes[tool].push(preset);
  return preset;
}
export function removeColor(presets: WritingPresets, tool: WritingTool, id: string): void {
  const colors = presets.palettes[tool];
  const index = colors.findIndex((preset) => preset.id === id);
  if (index < 0) return;
  colors.splice(index, 1);
  if (presets.selectedIds[tool] === id)
    presets.selectedIds[tool] = colors[Math.min(index, colors.length - 1)]?.id ?? null;
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
  const previous = selectedColor(presets, tool);
  presets.palettes[tool] = [];
  for (const color of tool === "highlighter" ? HIGHLIGHTER_COLORS : PALETTE)
    saveColor(presets, tool, color);
  presets.selectedIds[tool] = (
    presets.palettes[tool].find((preset) => preset.color === previous) ?? presets.palettes[tool][0]
  ).id;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
/** Upgrade strings/color selection to stable identities, preserving order and selected ink. */
export function migrateWritingPresets(
  settings: {
    writingPresets?: unknown;
    customColors: string[];
    defaultColor: string;
    defaultSize: number;
  },
  initializeDefaults = false,
): WritingPresets {
  const saved = record(settings.writingPresets);
  initializeDefaults = initializeDefaults && Object.keys(saved).length === 0;
  const palettes = record(saved.palettes);
  const ids = record(saved.selectedIds);
  const selected = record(saved.selectedColors);
  const legacy = colorList([
    ...PALETTE,
    ...(Array.isArray(settings.customColors) ? settings.customColors : []),
  ]);
  const result: WritingPresets = {
    version: 3,
    nextColorId:
      Number.isSafeInteger(saved.nextColorId) && (saved.nextColorId as number) > 0
        ? (saved.nextColorId as number)
        : 1,
    widths: Array.isArray(saved.widths)
      ? sortedWidths(saved.widths.filter((v): v is number => typeof v === "number"))
      : [...SIZES],
    selectedWidth:
      typeof saved.selectedWidth === "number" && Number.isFinite(saved.selectedWidth)
        ? saved.selectedWidth
        : settings.defaultSize,
    highlighterWidths: Array.isArray(saved.highlighterWidths)
      ? sortedWidths(saved.highlighterWidths.filter((v): v is number => typeof v === "number"))
      : initializeDefaults
        ? [...HIGHLIGHTER_SIZES]
        : Array.isArray(saved.widths)
          ? sortedWidths(saved.widths.filter((v): v is number => typeof v === "number"))
          : [...SIZES],
    selectedHighlighterWidth:
      typeof saved.selectedHighlighterWidth === "number" &&
      Number.isFinite(saved.selectedHighlighterWidth)
        ? saved.selectedHighlighterWidth
        : initializeDefaults
          ? HIGHLIGHTER_SIZES[1]
          : typeof saved.selectedWidth === "number" && Number.isFinite(saved.selectedWidth)
            ? saved.selectedWidth
            : settings.defaultSize,
    palettes: { pen: [], highlighter: [] },
    selectedIds: { pen: null, highlighter: null },
  };
  const used = new Set<string>();
  for (const tool of ["pen", "highlighter"] as const) {
    const values: unknown[] = Array.isArray(palettes[tool])
      ? palettes[tool]
      : initializeDefaults && tool === "highlighter"
        ? [...HIGHLIGHTER_COLORS]
        : legacy;
    for (const value of values) {
      const entry = record(value);
      const color = parseHexColor(
        typeof value === "string" ? value : typeof entry.color === "string" ? entry.color : "",
      );
      if (!color) continue;
      const match =
        typeof entry.id === "string" ? /^(?:pen|highlighter)-(\d+)$/.exec(entry.id) : null;
      if (match) result.nextColorId = Math.max(result.nextColorId, Number(match[1]) + 1);
      let id =
        typeof entry.id === "string" && entry.id.length > 0 && !used.has(entry.id)
          ? entry.id
          : `${tool}-${result.nextColorId++}`;
      while (used.has(id)) id = `${tool}-${result.nextColorId++}`;
      used.add(id);
      result.palettes[tool].push({ id, color });
    }
    if (saved.version === 2 || saved.version === 3) {
      result.selectedIds[tool] =
        result.palettes[tool].find((preset) => preset.id === ids[tool])?.id ??
        result.palettes[tool][0]?.id ??
        null;
    } else {
      const ink =
        parseHexColor(
          typeof selected[tool] === "string"
            ? selected[tool]
            : initializeDefaults && tool === "highlighter"
              ? HIGHLIGHTER_COLORS[0]
              : settings.defaultColor,
        ) ?? PALETTE[0];
      if (values.length > 0 && !result.palettes[tool].some((preset) => preset.color === ink))
        saveColor(result, tool, ink);
      result.selectedIds[tool] =
        result.palettes[tool].find((preset) => preset.color === ink)?.id ??
        result.palettes[tool][0]?.id ??
        null;
    }
  }
  return result;
}
