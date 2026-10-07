/** Stroke-wide arc-length patterns, independent of sample/coalescing boundaries. */
import type { InkRun } from "./freehand";
import type { LineStyle } from "../model/document";
export function lineStyleOf(value: unknown): LineStyle {
  return value === "dashed" || value === "dotted" ? value : "solid";
}
export function patternedRuns(
  runs: readonly InkRun[],
  style: LineStyle,
  size: number,
  offset = 0,
): InkRun[] {
  if (style === "solid") return [...runs];
  const unit = Math.max(0.1, Number.isFinite(size) ? size : 3);
  const cycle = unit * (style === "dotted" ? 3 : 6),
    dash = unit * 3;
  let distance = Number.isFinite(offset) ? Math.max(0, offset) : 0;
  let nextDot = Math.ceil((distance - 1e-9) / cycle) * cycle;
  const out: InkRun[] = [];
  let open: InkRun | null = null;
  for (const run of runs) {
    const pts = run.closed ? [...run.pts, ...run.pts.slice(0, 2)] : run.pts;
    if (pts.length === 2 && distance === 0) {
      out.push({ width: run.width, pts: [...pts], ...(style === "dotted" ? { dot: true } : {}) });
      if (style === "dotted") nextDot = cycle;
    }
    for (let i = 2; i < pts.length; i += 2) {
      const ax = pts[i - 2],
        ay = pts[i - 1],
        dx = pts[i] - ax,
        dy = pts[i + 1] - ay,
        length = Math.hypot(dx, dy);
      if (!(length > 1e-9)) continue;
      if (style === "dotted") {
        while (nextDot <= distance + length + 1e-9) {
          const t = Math.max(0, Math.min(1, (nextDot - distance) / length));
          out.push({ width: run.width, pts: [ax + dx * t, ay + dy * t], dot: true });
          nextDot += cycle;
        }
      } else {
        let at = 0;
        while (at < length - 1e-9) {
          let phase = (distance + at) % cycle;
          if (cycle - phase < 1e-8) phase = 0;
          const on = phase < dash - 1e-9;
          const step = Math.min(length - at, (on ? dash : cycle) - phase);
          if (step < 1e-9) {
            at += 1e-8;
            continue;
          }
          if (on) {
            const x = ax + (dx * at) / length,
              y = ay + (dy * at) / length;
            if (
              !open ||
              open.width !== run.width ||
              Math.hypot(open.pts[open.pts.length - 2] - x, open.pts[open.pts.length - 1] - y) >
                1e-7
            ) {
              open = { width: run.width, pts: [x, y] };
              out.push(open);
            }
            open.pts.push(ax + (dx * (at + step)) / length, ay + (dy * (at + step)) / length);
          } else open = null;
          at += step;
        }
      }
      distance += length;
    }
  }
  return out;
}
/** A retained eraser fragment begins at this distance along the original raw polyline. */
export function distanceAlongPoints(
  pts: readonly number[],
  x: number,
  y: number,
  minimum = 0,
): number {
  let travelled = 0,
    best = Infinity,
    result = minimum;
  for (let i = 3; i + 2 < pts.length; i += 3) {
    const ax = pts[i - 3],
      ay = pts[i - 2],
      dx = pts[i] - ax,
      dy = pts[i + 1] - ay,
      length = Math.hypot(dx, dy);
    const t =
      length > 0
        ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (length * length)))
        : 0;
    const position = travelled + t * length,
      error = Math.hypot(x - ax - dx * t, y - ay - dy * t);
    if (position >= minimum - 1e-6 && error < best) {
      best = error;
      result = position;
    }
    travelled += length;
  }
  return result;
}
