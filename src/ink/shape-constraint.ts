import type { ShapeKind } from "../model/document";
import { ellipsePoints, presetGeometry } from "./shape-geometry";
export const CONSTRAINABLE_SHAPES: readonly ShapeKind[] = ["line", "arrow", "rect", "roundrect", "ellipse", "circle"];
const STEP = Math.PI / 12;
const difference = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));
/** Always derive from unconstrained geometry; a released modifier cannot distort its base. */
export function constrainShape(kind: ShapeKind, pts: readonly number[], previousAngle?: number): { pts: number[]; angle?: number } {
  const out = pts.slice();
  if (!CONSTRAINABLE_SHAPES.includes(kind) || pts.length < 6 || !pts.every(Number.isFinite)) return { pts: out };
  if (kind === "line" || kind === "arrow") {
    const x = pts[0], y = pts[1], dx = pts[3] - x, dy = pts[4] - y;
    if (Math.hypot(dx, dy) < 1e-6) return { pts: out };
    const raw = Math.atan2(dy, dx);
    const angle = previousAngle !== undefined && Math.abs(difference(raw, previousAngle)) <= STEP / 2 + Math.PI / 60
      ? previousAngle : Math.round(raw / STEP) * STEP;
    const c = Math.cos(angle - raw), s = Math.sin(angle - raw);
    for (let i = 0; i + 2 < out.length; i += 3) {
      const u = pts[i] - x, v = pts[i + 1] - y;
      out[i] = x + u * c - v * s; out[i + 1] = y + u * s + v * c;
    }
    return { pts: out, angle };
  }
  if (kind === "circle") return { pts: out };
  let n = pts.length / 3;
  if (n > 1 && Math.hypot(pts[0] - pts[pts.length - 3], pts[1] - pts[pts.length - 2]) < 0.02) n--;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += pts[i * 3]; cy += pts[i * 3 + 1]; }
  cx /= n; cy /= n;
  let xx = 0, yy = 0, xy = 0;
  for (let i = 0; i < n; i++) { const x = pts[i * 3] - cx, y = pts[i * 3 + 1] - cy; xx += x * x; yy += y * y; xy += x * y; }
  if (kind === "roundrect" && Math.abs(xx - yy) + Math.abs(xy) < Math.max(xx, yy) * 1e-5) return { pts: out };
  const theta = kind === "rect" ? Math.atan2(pts[4] - pts[1], pts[3] - pts[0]) : Math.atan2(2 * xy, xx - yy) / 2;
  const c = Math.cos(theta), s = Math.sin(theta);
  const local: number[][] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 2 < pts.length; i += 3) {
    const dx = pts[i] - cx, dy = pts[i + 1] - cy, x = dx * c + dy * s, y = -dx * s + dy * c;
    local.push([x, y]); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const w = maxX - minX, h = maxY - minY;
  if (w < 1e-6 || h < 1e-6) return { pts: out };
  const side = Math.max(w, h), mx = (maxX + minX) / 2, my = (maxY + minY) / 2;
  cx += mx * c - my * s; cy += mx * s + my * c;
  if (kind === "ellipse") {
    const phase = Math.atan2((local[0][1] - my) / h, (local[0][0] - mx) / w);
    const cross = (local[0][0] - mx) * (local[1][1] - my) - (local[0][1] - my) * (local[1][0] - mx);
    const ring = ellipsePoints(cx, cy, side / 2, side / 2, theta, phase, cross < 0 ? -1 : 1);
    return { pts: ring.flatMap(point => [point.x, point.y, pts[2]]) };
  }
  if (kind === "roundrect") {
    const square = presetGeometry("roundrect", { x: -side / 2, y: -side / 2 }, { x: side / 2, y: side / 2 }, pts[2]);
    for (let i = 0; i < square.length; i += 3) { const x = square[i], y = square[i + 1]; square[i] = cx + x * c - y * s; square[i + 1] = cy + x * s + y * c; }
    return { pts: square };
  }
  for (let i = 0; i < local.length; i++) {
    const x = (local[i][0] - mx) * side / w, y = (local[i][1] - my) * side / h;
    out[i * 3] = cx + x * c - y * s; out[i * 3 + 1] = cy + x * s + y * c;
  }
  return { pts: out };
}
