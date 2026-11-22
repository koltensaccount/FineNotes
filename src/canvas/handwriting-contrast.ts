import type { Page } from "../model/document";
import { parseCssColor } from "./night";

function colorChannels(color: string) {
  const value = color.trim().toLowerCase();
  return parseCssColor(value === "white" ? "#fff" : value === "black" ? "#000" : value);
}

/** Adapt light and dark neutral ink to its destination, preserving accent colors and alpha. */
export function handwritingInk(color: string, dark: boolean): string {
  const rgba = colorChannels(color);
  if (!rgba) return color;
  const min = Math.min(rgba.r, rgba.g, rgba.b);
  const max = Math.max(rgba.r, rgba.g, rgba.b);
  if ((max - min) * 255 > 35 || (dark ? max * 255 > 90 : min * 255 < 180)) return color;
  const channel = dark ? 255 : 26;
  return rgba.a === 1
    ? dark
      ? "#ffffff"
      : "#1a1a1a"
    : `rgba(${channel}, ${channel}, ${channel}, ${rgba.a})`;
}

/** The saved notebook keeps its original colors. Only this render copy is adapted. */
export function handwritingForBackground(page: Page, dark: boolean): Page {
  return {
    ...page,
    strokes: page.strokes.map((stroke) =>
      stroke.onSticky || stroke.tool === "highlighter"
        ? stroke
        : { ...stroke, color: handwritingInk(stroke.color, dark) },
    ),
    textBoxes: page.textBoxes.map((box) => {
      if (box.onSticky || box.onShape) return box;
      const fill = box.fill && colorChannels(box.fill);
      const onDark =
        fill && fill.a >= 0.75 ? 0.299 * fill.r + 0.587 * fill.g + 0.114 * fill.b < 0.5 : dark;
      return { ...box, color: handwritingInk(box.color, onDark) };
    }),
    equations: page.equations?.map((equation) => ({
      ...equation,
      color: handwritingInk(equation.color, dark),
    })),
  };
}
