import { describe, it, expect } from "vitest";
import { smoothCompletedStroke } from "../../src/ink/stroke-smoothing";
import { penGesturesOf } from "../../src/ink/pen-gestures";
const handwriting = (n = 120): number[] => Array.from({ length: n }, (_, i) => [i * 2, Math.sin(i / 8) * 10 + (i % 2 ? .3 : -.3), .2 + (i % 8) / 10]).flat();
describe("completed handwriting smoothing", () => {
  it("off is the same array and short strokes are untouched", () => {
    const pts = handwriting(); expect(smoothCompletedStroke(pts, 0)).toBe(pts);
    for (const n of [1, 2, 5, 8]) { const short = handwriting(n); expect(smoothCompletedStroke(short, 10)).toBe(short); }
  });
  it("preserves endpoints and all pressure values without mutating raw geometry", () => {
    const pts = handwriting(), raw = pts.slice(), out = smoothCompletedStroke(pts, 8);
    expect(out.slice(0, 9)).toEqual(pts.slice(0, 9)); expect(out.slice(-9)).toEqual(pts.slice(-9));
    expect(out.filter((_, i) => i % 3 === 2)).toEqual(pts.filter((_, i) => i % 3 === 2)); expect(pts).toEqual(raw);
  });
  it("strength controls correction; existing centred correction receives half strength", () => {
    const pts = handwriting(), low = smoothCompletedStroke(pts, 2), high = smoothCompletedStroke(pts, 8), centred = smoothCompletedStroke(pts, 8, true);
    const delta = (out: number[]) => out.reduce((s, v, i) => s + Math.abs(v - pts[i]), 0);
    expect(delta(high)).toBeGreaterThan(delta(low)); expect(delta(centred)).toBeLessThan(delta(high));
    for (let i = 0; i < pts.length; i += 3) expect(Math.hypot(high[i] - pts[i], high[i + 1] - pts[i + 1])).toBeLessThanOrEqual(1.000001);
  });
  it("preserves intentional corners and tight loop closure", () => {
    const corner = Array.from({ length: 21 }, (_, i) => i <= 10 ? [i * 2, 0, .5] : [20, (i - 10) * 2, .5]).flat();
    const out = smoothCompletedStroke(corner, 10); expect(out.slice(24, 39)).toEqual(corner.slice(24, 39));
    const loop = Array.from({ length: 65 }, (_, i) => [5 * Math.cos(i * Math.PI / 32), 5 * Math.sin(i * Math.PI / 32), .5]).flat();
    const smoothed = smoothCompletedStroke(loop, 10); expect(smoothed.slice(0, 3)).toEqual(loop.slice(0, 3)); expect(smoothed.slice(-3)).toEqual(loop.slice(-3));
  });
  it("normalizes and persists the shared 0–10 preference with default off", () => {
    expect(penGesturesOf({}).strokeSmoothing).toBe(0);
    expect(penGesturesOf({ strokeSmoothing: 15 }).strokeSmoothing).toBe(10);
    expect(penGesturesOf({ strokeSmoothing: NaN }).strokeSmoothing).toBe(0);
    expect(penGesturesOf(JSON.parse(JSON.stringify({ strokeSmoothing: 3 }))).strokeSmoothing).toBe(3);
  });
});
