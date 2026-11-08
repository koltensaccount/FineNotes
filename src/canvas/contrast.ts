/**
 * Consistent color and contrast policy across FineNotes ink surfaces,
 * live embeds, and PNG exports.
 */

export function parseColorToRgb(
  color: string,
): { r: number; g: number; b: number; a?: number } | null {
  const c = color.trim().toLowerCase();
  if (c === "black") return { r: 0, g: 0, b: 0 };
  if (c === "white") return { r: 255, g: 255, b: 255 };
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
  }
  const rgbMatch = /^rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10),
    };
  }
  return null;
}

/**
 * Determine whether a paper background color is dark based on perceived luminance.
 */
export function isPaperDark(paperColor: string): boolean {
  const rgb = parseColorToRgb(paperColor);
  if (!rgb) return false;
  const lum = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return lum < 128;
}

/**
 * Contrast mode for render-time adaptation:
 * - "dark": dark background (e.g. dark theme note / dark paper), adapts monochrome dark ink to white.
 * - "light": light background (e.g. light theme note / light paper), adapts monochrome light ink to dark.
 * - "disabled": no adaptation; preserves authentic stored stroke colors exactly.
 */
export type ContrastMode = "dark" | "light" | "disabled";

/**
 * Intelligently convert black/dark text and strokes to white on dark backgrounds
 * and vice versa, while preserving vibrant colors (blue, red, green, purple, etc.).
 *
 * This policy is applied strictly at RENDER TIME so that the underlying stroke
 * document models and toolState retain the user's authentic chosen color.
 *
 * When mode is "disabled", null, or undefined, the color is returned completely unchanged.
 */
export function adaptColorForTheme(
  color: string,
  mode: ContrastMode | boolean | null | undefined,
): string {
  if (mode === "disabled" || mode === null || mode === undefined) return color;
  const isDark = mode === true || mode === "dark";
  const rgb = parseColorToRgb(color);
  if (!rgb) return color;
  const maxVal = Math.max(rgb.r, rgb.g, rgb.b);
  const minVal = Math.min(rgb.r, rgb.g, rgb.b);
  const isMonochrome = maxVal - minVal <= 35; // grayscale or neutral

  if (isDark) {
    // In dark mode or on dark paper: black or very dark text/strokes become white
    if (isMonochrome && maxVal <= 90) {
      return "#ffffff";
    }
  } else {
    // In light mode or on light paper: white or very light text/strokes become dark
    if (isMonochrome && minVal >= 180) {
      return "#1a1a1a";
    }
  }
  return color;
}
