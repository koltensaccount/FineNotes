import type { InkRun } from "./freehand";
import { inkRuns, penOptions } from "./freehand";
import type { StrokeBuilder } from "./stroke-builder";

/** Settle provisional smoothing on a copy, exactly as the committed stroke does. */
export function highlighterWetRuns(builder: StrokeBuilder, width: number): InkRun[] {
  return inkRuns(builder.points(), penOptions(width, false));
}

/** One positive-winding fill: segment strips and bevel joins, caps only at ends.
 * No sample-point circles and no per-segment translucent paint operations.
 */
export function highlighterPolygons(runs: readonly InkRun[], width: number): number[][] {
  const out: number[][] = [];
  const r = Math.max(0.01, width / 2);
  const polygon = (xy: number[]): void => {
    let area = 0;
    for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2)
      area += xy[j] * xy[i + 1] - xy[i] * xy[j + 1];
    if (area < 0) {
      const reversed: number[] = [];
      for (let i = xy.length - 2; i >= 0; i -= 2) reversed.push(xy[i], xy[i + 1]);
      xy = reversed;
    }
    out.push(xy);
  };
  const cap = (x: number, y: number, angle: number, full = false): void => {
    const xy = [x, y], sweep = full ? Math.PI * 2 : Math.PI;
    for (let i = 0; i <= (full ? 32 : 16); i++) {
      const a = angle + sweep * i / (full ? 32 : 16);
      xy.push(x + r * Math.cos(a), y + r * Math.sin(a));
    }
    polygon(xy);
  };
  for (const run of runs) {
    const pts: number[] = [];
    for (let i = 0; i + 1 < run.pts.length; i += 2) {
      const x = run.pts[i], y = run.pts[i + 1], n = pts.length;
      if (!Number.isFinite(x + y)) continue;
      if (n && Math.hypot(x - pts[n - 2], y - pts[n - 1]) < 1e-6) continue;
      pts.push(x, y);
    }
    if (!pts.length) continue;
    const closed = run.closed || (pts.length > 4 && Math.hypot(pts[0] - pts[pts.length - 2], pts[1] - pts[pts.length - 1]) < 1e-6);
    if (closed && (pts[0] !== pts[pts.length - 2] || pts[1] !== pts[pts.length - 1])) pts.push(pts[0], pts[1]);
    if (pts.length === 2) { cap(pts[0], pts[1], 0, true); continue; }
    const normals: number[][] = [];
    for (let i = 2; i < pts.length; i += 2) {
      const x = pts[i - 2], y = pts[i - 1], dx = pts[i] - x, dy = pts[i + 1] - y;
      const len = Math.hypot(dx, dy), nx = -dy * r / len, ny = dx * r / len;
      normals.push([nx, ny]);
      polygon([x + nx, y + ny, x - nx, y - ny, pts[i] - nx, pts[i + 1] - ny, pts[i] + nx, pts[i + 1] + ny]);
    }
    const join = (x: number, y: number, a: number[], b: number[]): void => {
      polygon([x, y, x + a[0], y + a[1], x + b[0], y + b[1]]);
      polygon([x, y, x - a[0], y - a[1], x - b[0], y - b[1]]);
    };
    for (let i = 1; i < normals.length; i++) join(pts[i * 2], pts[i * 2 + 1], normals[i - 1], normals[i]);
    if (closed) join(pts[0], pts[1], normals[normals.length - 1], normals[0]);
    else {
      const first = Math.atan2(pts[3] - pts[1], pts[2] - pts[0]);
      const n = pts.length, last = Math.atan2(pts[n - 1] - pts[n - 3], pts[n - 2] - pts[n - 4]);
      cap(pts[0], pts[1], first + Math.PI / 2);
      cap(pts[n - 2], pts[n - 1], last - Math.PI / 2);
    }
  }
  return out;
}
