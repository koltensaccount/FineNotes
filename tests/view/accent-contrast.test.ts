import { describe, expect, it } from "vitest";
import {
  compositeOver,
  contrastRatio,
  ensureReadableAccent,
  parseCssColor,
} from "../../src/view/accent-contrast";

describe("accent contrast guard", () => {
  const darkWell = compositeOver([255, 255, 255], 0.12, [34, 34, 34]);
  const lightWell = compositeOver([0, 0, 0], 0.12, [244, 244, 245]);

  it("leaves already-readable accents untouched", () => {
    expect(ensureReadableAccent([130, 170, 255], darkWell, true)).toBeNull();
    expect(ensureReadableAccent([42, 82, 190], lightWell, false)).toBeNull();
  });

  it("lifts muted dark slate-blue in dark mode to >= 4.5:1 while keeping hue", () => {
    const mutedBlue = parseCssColor("#475d73")!;
    expect(contrastRatio(mutedBlue, darkWell)).toBeLessThan(2.5);
    const boosted = ensureReadableAccent(mutedBlue, darkWell, true);
    expect(boosted).not.toBeNull();
    const boostedRgb = parseCssColor(boosted!)!;
    expect(contrastRatio(boostedRgb, darkWell)).toBeGreaterThanOrEqual(4.5);
    // Blue channel remains dominant (same hue family)
    expect(boostedRgb[2]).toBeGreaterThan(boostedRgb[0]);
  });

  it("darkens pale pastel accent in light mode to >= 4.5:1", () => {
    const paleYellow = parseCssColor("#f5e68b")!;
    const fixed = ensureReadableAccent(paleYellow, lightWell, false);
    expect(fixed).not.toBeNull();
    const fixedRgb = parseCssColor(fixed!)!;
    expect(contrastRatio(fixedRgb, lightWell)).toBeGreaterThanOrEqual(4.5);
  });

  it("falls back to --text-normal for nearly achromatic gray accents", () => {
    expect(ensureReadableAccent([95, 95, 95], darkWell, true)).toBe("var(--text-normal)");
  });
});
