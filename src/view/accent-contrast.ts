/**
 * Automatic WCAG contrast guard for `--gob-active-fg` on the Neutral Well.
 *
 * Some Obsidian themes use a muted/dark accent in dark mode (or a pale pastel
 * accent in light mode) that falls well below WCAG contrast on the active tool
 * well. This module measures the real contrast ratio and, only when contrast
 * is below 4.5:1, lifts (dark mode) or deepens (light mode) the user's own
 * accent lightness in the same hue until it reaches >= 4.5:1.
 *
 * PURE math helpers + tiny DOM binder.
 */

export type Rgb = readonly [number, number, number];

/** Parse `rgb(r, g, b)`, `rgba(r, g, b, a)`, or `#rgb` / `#rrggbb` into 0..255 RGB. */
export function parseCssColor(value: string): Rgb | null {
  const s = value.trim();
  const rgbMatch = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)/i.exec(s);
  if (rgbMatch) {
    return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  }
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hexMatch) {
    const h = hexMatch[1];
    if (h.length === 3) {
      return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
    }
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  return null;
}

/** Alpha-composite `fg` at opacity `alpha` over opaque `bg`. */
export function compositeOver(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  const a = Math.max(0, Math.min(1, alpha));
  return [
    Math.round(fg[0] * a + bg[0] * (1 - a)),
    Math.round(fg[1] * a + bg[1] * (1 - a)),
    Math.round(fg[2] * a + bg[2] * (1 - a)),
  ];
}

function channelLum(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 relative luminance (0..1). */
export function rgbLuminance(rgb: Rgb): number {
  return 0.2126 * channelLum(rgb[0]) + 0.7152 * channelLum(rgb[1]) + 0.0722 * channelLum(rgb[2]);
}

/** WCAG 2.1 contrast ratio (1..21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = rgbLuminance(a);
  const l2 = rgbLuminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number): number => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [
    Math.round(hue(h + 1 / 3) * 255),
    Math.round(hue(h) * 255),
    Math.round(hue(h - 1 / 3) * 255),
  ];
}

function rgbToHex([r, g, b]: Rgb): string {
  const hex = (n: number): string => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * Returns `null` when `accent` already meets `minContrast` against `surface`,
 * otherwise returns a contrast-safe color in the same hue (or `"var(--text-normal)"`
 * if the accent is nearly achromatic gray).
 */
export function ensureReadableAccent(
  accent: Rgb,
  surface: Rgb,
  darkTheme: boolean,
  minContrast = 4.5,
): string | null {
  if (contrastRatio(accent, surface) >= minContrast) return null;
  const [h, s, l] = rgbToHsl(accent);
  if (s < 0.08) return "var(--text-normal)";
  // Keep hue intact, gently lift saturation floor if very muddy so it still reads as colored.
  const targetS = Math.max(s, 0.42);
  let lo = darkTheme ? l : 0;
  let hi = darkTheme ? 1 : l;
  let best: Rgb = hslToRgb(h, targetS, darkTheme ? 0.92 : 0.15);
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    const candidate = hslToRgb(h, targetS, mid);
    if (contrastRatio(candidate, surface) >= minContrast) {
      best = candidate;
      if (darkTheme) hi = mid;
      else lo = mid;
    } else {
      if (darkTheme) lo = mid;
      else hi = mid;
    }
  }
  return rgbToHex(best);
}

function defaultDoc(): Document | null {
  if (typeof activeDocument !== "undefined") return activeDocument;
  if (typeof document !== "undefined") return document;
  return null;
}

/**
 * Measure the current Obsidian theme's `--interactive-accent` against the
 * Neutral Well background and set `--gob-active-fg` on `body` only if needed.
 */
export function syncActiveAccentContrast(doc: Document | null = defaultDoc()): void {
  if (!doc?.body || typeof getComputedStyle !== "function") return;
  const darkTheme = doc.body.classList.contains("theme-dark");
  const probe = doc.body.createDiv({
    attr: {
      style:
        "position:fixed;visibility:hidden;pointer-events:none;" +
        "color:var(--interactive-accent);background:var(--background-secondary);",
    },
  });
  try {
    const style = getComputedStyle(probe);
    const accent = parseCssColor(style.color);
    const barBg =
      parseCssColor(style.backgroundColor) ?? (darkTheme ? [36, 36, 36] : [242, 242, 242]);
    if (!accent) {
      doc.body.style.removeProperty("--gob-active-fg");
      return;
    }
    // Neutral Well is `--gob-well-strong` (12% mono-rgb-100 over the toolbar surface).
    const wellOverlay: Rgb = darkTheme ? [255, 255, 255] : [0, 0, 0];
    const wellSurface = compositeOver(wellOverlay, 0.12, barBg);
    const fixed = ensureReadableAccent(accent, wellSurface, darkTheme, 4.5);
    if (fixed) doc.body.style.setProperty("--gob-active-fg", fixed);
    else doc.body.style.removeProperty("--gob-active-fg");
  } finally {
    probe.remove();
  }
}

export function clearActiveAccentContrast(doc: Document | null = defaultDoc()): void {
  doc?.body?.style.removeProperty("--gob-active-fg");
}
