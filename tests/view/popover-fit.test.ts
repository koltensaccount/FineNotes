import { describe, expect, it } from "vitest";
import { fitPopover, type PopoverRect } from "../../src/view/writing-popover-fit";

const rect = (left: number, top: number, width: number, height: number): PopoverRect => ({left, top, right: left + width, bottom: top + height});
describe("floating menu viewport bounds", () => {
  it.each(["top", "bottom", "left", "right"] as const)("keeps all %s-docked menu content reachable at narrow and short sizes", dock => {
    for (const [width, height] of [[320, 480], [240, 180], [1024, 320], [600, 800]]) {
      const visible = rect(28, 42, width - 16, height - 16);
      for (const anchor of [rect(32, 46, 44, 44), rect(width - 40, height - 30, 44, 44), rect(50, 900, 44, 44)]) {
        const fit = fitPopover(visible, anchor, {width: 390, height: 1000}, dock);
        expect(fit.left).toBeGreaterThanOrEqual(visible.left);
        expect(fit.top).toBeGreaterThanOrEqual(visible.top);
        expect(fit.left + Math.min(390, fit.maxWidth)).toBeLessThanOrEqual(visible.right);
        expect(fit.top + Math.min(1000, fit.maxHeight)).toBeLessThanOrEqual(visible.bottom);
        expect(fit.maxHeight).toBeGreaterThan(0);
        expect(fit.maxWidth).toBeGreaterThan(0);
      }
    }
  });
  it("uses the viewport when neither side of an anchor can fit usable rows", () => {
    const visible = rect(0, 0, 300, 180);
    expect(fitPopover(visible, rect(100, 70, 44, 44), {width: 320, height: 600}).maxHeight).toBe(180);
  });
  it("flips above a bottom anchor and preserves room for scrolling", () => {
    const fit = fitPopover(rect(0, 0, 320, 500), rect(240, 450, 44, 44), {width: 300, height: 700});
    expect(fit.top).toBe(0);
    expect(fit.maxHeight).toBe(442);
  });
});
