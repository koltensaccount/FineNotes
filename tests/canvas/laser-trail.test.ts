/** `src/canvas/laser-trail.ts` — the laser pointer's neon multi-stroke trail (FineNotes#25). */

import { describe, expect, it } from "vitest";
import {
  LASER_FADE_MS,
  LASER_FADE_STEPS,
  LASER_HOLD_MS,
  LaserTrail,
  fade,
  laserPaths,
} from "../../src/canvas/laser-trail";

describe("fade", () => {
  it("is full when new, nothing once faded, and falls in between", () => {
    expect(fade(-5)).toBe(1);
    expect(fade(0)).toBe(1);
    expect(fade(LASER_FADE_MS)).toBe(0);
    expect(fade(LASER_FADE_MS * 2)).toBe(0);
    const half = fade(LASER_FADE_MS / 2);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(1);
    expect(fade(10)).toBeGreaterThan(fade(20));
  });
});

describe("LaserTrail", () => {
  it("holds the entire stroke 100% solid while the pen stays down", () => {
    const trail = new LaserTrail();
    trail.start({ x: 0, y: 0, t: 0 });
    trail.add({ x: 10, y: 0, t: 100 });
    trail.add({ x: 20, y: 0, t: 5000 });
    const frame = trail.activeStrokes(5000);
    expect(frame.alpha).toBe(1);
    expect(frame.strokes).toHaveLength(1);
    expect(frame.strokes[0]).toHaveLength(3);
    expect(frame.tip).toEqual({ x: 20, y: 0, t: 5000 });
    const segments = trail.segments(5000);
    expect(segments).toHaveLength(2);
    expect(segments.every((s) => s.alpha === 1)).toBe(true);
  });

  it("holds for LASER_HOLD_MS after lift, then fades out smoothly over LASER_FADE_MS", () => {
    const trail = new LaserTrail();
    trail.start({ x: 0, y: 0, t: 0 });
    trail.add({ x: 10, y: 0, t: 10 });
    trail.end(2000);
    expect(trail.alpha(2000)).toBe(1);
    expect(trail.alpha(2000 + LASER_HOLD_MS)).toBe(1);
    expect(trail.visible(2000 + LASER_HOLD_MS)).toBe(true);

    const midFade = trail.alpha(2000 + LASER_HOLD_MS + LASER_FADE_MS / 2);
    expect(midFade).toBeGreaterThan(0);
    expect(midFade).toBeLessThan(1);

    expect(trail.visible(2000 + LASER_HOLD_MS + LASER_FADE_MS)).toBe(false);
    expect(trail.segments(2000 + LASER_HOLD_MS + LASER_FADE_MS)).toEqual([]);
  });

  it("keeps previous strokes alive across quick consecutive strokes and resets hold on pen down", () => {
    const trail = new LaserTrail();
    trail.start({ x: 0, y: 0, t: 0 });
    trail.add({ x: 10, y: 0, t: 10 });
    trail.end(20);

    // Start a second stroke before the hold + fade finishes: both stay solid and separate.
    trail.start({ x: 100, y: 100, t: 500 });
    trail.add({ x: 110, y: 100, t: 520 });
    const frame = trail.activeStrokes(520);
    expect(frame.alpha).toBe(1);
    expect(frame.strokes).toHaveLength(2);
    const segments = trail.segments(520);
    expect(segments.some(({ a, b }) => a.x === 10 && b.x === 100)).toBe(false);
    expect(segments.some(({ a, b }) => a.x === 100 && b.x === 110)).toBe(true);

    trail.end(600);
    expect(trail.alpha(600 + LASER_HOLD_MS)).toBe(1);
    expect(trail.visible(600 + LASER_HOLD_MS + LASER_FADE_MS)).toBe(false);
  });

  describe("laserPaths", () => {
    const point = (x: number, t: number) => ({ x, y: 0, t });

    it("joins contiguous pieces of one opacity step into a single run", () => {
      const paths = laserPaths([
        { a: point(0, 0), b: point(10, 10), alpha: 1 },
        { a: point(10, 10), b: point(20, 20), alpha: 1 },
      ]);
      expect(paths).toHaveLength(1);
      expect(paths[0].alpha).toBe(1);
      expect(paths[0].runs).toHaveLength(1);
      expect(paths[0].runs[0].map((each) => each.x)).toEqual([0, 10, 20]);
    });

    it("keeps a break in the trail as separate runs of the same step", () => {
      const paths = laserPaths([
        { a: point(0, 0), b: point(10, 10), alpha: 1 },
        { a: point(100, 20), b: point(110, 30), alpha: 1 },
      ]);
      expect(paths).toHaveLength(1);
      expect(paths[0].runs).toHaveLength(2);
    });

    it("groups by opacity step, so each step is stroked once", () => {
      const segments = [
        { a: point(0, 0), b: point(10, 10), alpha: 0.1 },
        { a: point(10, 10), b: point(20, 20), alpha: 0.5 },
        { a: point(20, 20), b: point(30, 30), alpha: 1 },
      ];
      const paths = laserPaths(segments);
      expect(paths).toHaveLength(3);
      expect(paths.map((path) => path.alpha)).toEqual([
        Math.round(0.1 * LASER_FADE_STEPS) / LASER_FADE_STEPS,
        Math.round(0.5 * LASER_FADE_STEPS) / LASER_FADE_STEPS,
        1,
      ]);
      for (const path of paths) expect(path.runs).toHaveLength(1);
    });
  });

  it("takes no points while the pen is up, and a lift with none is nothing", () => {
    const trail = new LaserTrail();
    trail.add({ x: 1, y: 1, t: 0 });
    trail.end(0);
    expect(trail.visible(0)).toBe(false);
    trail.start({ x: 0, y: 0, t: 0 });
    trail.clear();
    expect(trail.visible(0)).toBe(false);
  });
});
