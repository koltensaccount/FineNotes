/** Shape edits operate on existing vector points; width and styling stay separate. */
import type { ShapeKind } from "../model/document";
import { roundRectPoints, type Pt } from "./shape-geometry";

export interface ShapeFrame { cx: number; cy: number; w: number; h: number; angle: number }
export type ShapeHandle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se" | "start" | "end" | "rotate";
export const MIN_SHAPE_DIMENSION = 4;
const boxKinds = ["rect", "roundrect", "ellipse"];
export const independentlyResizable = (kind: ShapeKind): boolean => boxKinds.includes(kind);
const round = (v: number): number => Math.round(v * 100) / 100;

export function shapeFrame(kind: ShapeKind, pts: readonly number[], angleHint?: number): ShapeFrame | null {
  if (pts.length < 6 || pts.length % 3 || pts.some(v => !Number.isFinite(v))) return null;
  if (kind === "line" || kind === "arrow") {
    const dx = pts[3] - pts[0], dy = pts[4] - pts[1];
    return { cx: (pts[0] + pts[3]) / 2, cy: (pts[1] + pts[4]) / 2, w: Math.hypot(dx, dy), h: 0, angle: Math.atan2(dy, dx) };
  }
  let angle = angleHint ?? 0;
  const n = pts.length / 3 - (pts[0] === pts[pts.length - 3] && pts[1] === pts[pts.length - 2] ? 1 : 0);
  if (angleHint === undefined && kind === "rect") angle = Math.atan2(pts[4] - pts[1], pts[3] - pts[0]);
  if (angleHint === undefined && kind === "roundrect") {
    let longest = 0;
    for (let i = 3; i < pts.length; i += 3) {
      const dx = pts[i] - pts[i - 3], dy = pts[i + 1] - pts[i - 2];
      if (dx * dx + dy * dy > longest) { longest = dx * dx + dy * dy; angle = Math.atan2(dy, dx); }
    }
  }
  if (angleHint === undefined && kind === "ellipse") {
    let x = 0, y = 0;
    for (let i = 0; i < n * 3; i += 3) { x += pts[i] / n; y += pts[i + 1] / n; }
    let xx = 0, yy = 0, xy = 0;
    for (let i = 0; i < n * 3; i += 3) { const dx = pts[i] - x, dy = pts[i + 1] - y; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
    angle = Math.abs(xx - yy) + Math.abs(xy) < 0.01 ? 0 : Math.atan2(2 * xy, xx - yy) / 2;
  }
  const c = Math.cos(angle), s = Math.sin(angle);
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i] * c + pts[i + 1] * s, y = -pts[i] * s + pts[i + 1] * c;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  const x = (left + right) / 2, y = (top + bottom) / 2;
  return { cx: x * c - y * s, cy: x * s + y * c, w: right - left, h: bottom - top, angle };
}

export function localPoint(frame: ShapeFrame, p: Pt): Pt {
  const c = Math.cos(frame.angle), s = Math.sin(frame.angle), dx = p.x - frame.cx, dy = p.y - frame.cy;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}
export function worldPoint(frame: ShapeFrame, p: Pt): Pt {
  const c = Math.cos(frame.angle), s = Math.sin(frame.angle);
  return { x: frame.cx + p.x * c - p.y * s, y: frame.cy + p.x * s + p.y * c };
}
export function rotateShape(pts: readonly number[], pivot: Pt, angle: number): number[] {
  if (!Number.isFinite(angle)) return pts.slice();
  const c = Math.cos(angle), s = Math.sin(angle), out = pts.slice();
  for (let i = 0; i < out.length; i += 3) { const x = pts[i] - pivot.x, y = pts[i + 1] - pivot.y; out[i] = round(pivot.x + x * c - y * s); out[i + 1] = round(pivot.y + x * s + y * c); }
  return out;
}
export function scaleShape(pts: readonly number[], pivot: Pt, factor: number): number[] {
  if (!(factor > 0) || !Number.isFinite(factor)) return pts.slice();
  const out = pts.slice();
  for (let i = 0; i < out.length; i += 3) { out[i] = round(pivot.x + (pts[i] - pivot.x) * factor); out[i + 1] = round(pivot.y + (pts[i + 1] - pivot.y) * factor); }
  return out;
}
export function resizeShape(kind: ShapeKind, pts: readonly number[], frame: ShapeFrame, width: number, height: number, center: Pt = { x: frame.cx, y: frame.cy }): number[] {
  if (!independentlyResizable(kind) || !Number.isFinite(width + height) || width < MIN_SHAPE_DIMENSION || height < MIN_SHAPE_DIMENSION || frame.w < 0.01 || frame.h < 0.01) return pts.slice();
  const next = { ...frame, cx: center.x, cy: center.y };
  // Rounded corners remain circular rather than being stretched into ellipses.
  if (kind === "roundrect") {
    let cornerDistance = Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      const p = localPoint(frame, { x: pts[i], y: pts[i + 1] });
      cornerDistance = Math.min(cornerDistance, frame.w / 2 - Math.abs(p.x) + frame.h / 2 - Math.abs(p.y));
    }
    const radius = Math.max(0, cornerDistance / (2 - Math.SQRT2));
    const generated = roundRectPoints(-width / 2, -height / 2, width / 2, height / 2, radius).flatMap(p => [p.x, p.y, pts[2]]);
    for (let i = 0; i < generated.length; i += 3) { const p = worldPoint(next, { x: generated[i], y: generated[i + 1] }); generated[i] = round(p.x); generated[i + 1] = round(p.y); generated[i + 2] = pts[Math.min(pts.length - 1, Math.floor((i / 3) * (pts.length / generated.length)) * 3 + 2)]; }
    return generated;
  }
  const out = pts.slice();
  for (let i = 0; i < out.length; i += 3) {
    const p = localPoint(frame, { x: pts[i], y: pts[i + 1] });
    const q = worldPoint(next, { x: p.x * width / frame.w, y: p.y * height / frame.h });
    out[i] = round(q.x); out[i + 1] = round(q.y);
  }
  return out;
}
export function editEndpoint(kind: "line" | "arrow", pts: readonly number[], end: "start" | "end", at: Pt): number[] {
  if (pts.length < 6 || !Number.isFinite(at.x + at.y)) return pts.slice();
  const tail = end === "start" ? at : { x: pts[0], y: pts[1] }, tip = end === "end" ? at : { x: pts[3], y: pts[4] };
  const length = Math.hypot(tip.x - tail.x, tip.y - tail.y);
  if (length < MIN_SHAPE_DIMENSION) return pts.slice();
  const angle = Math.atan2(tip.y - tail.y, tip.x - tail.x) - Math.atan2(pts[4] - pts[1], pts[3] - pts[0]);
  const out = pts.slice(), c = Math.cos(angle), s = Math.sin(angle);
  out[0] = round(tail.x); out[1] = round(tail.y); out[3] = round(tip.x); out[4] = round(tip.y);
  if (kind === "arrow") for (let i = 6; i < out.length; i += 3) {
    const x = pts[i] - pts[3], y = pts[i + 1] - pts[4], head = Math.hypot(x, y);
    const shrink = head > 0 ? Math.min(1, length * 0.45 / head) : 1;
    out[i] = round(tip.x + (x * c - y * s) * shrink); out[i + 1] = round(tip.y + (x * s + y * c) * shrink);
  }
  return out;
}
/** Held creation changes distance only; orientation is never derived from the new pointer angle. */
export function resizeHeldShape(pts: readonly number[], pivot: Pt, from: Pt, to: Pt): number[] {
  const original = Math.hypot(from.x - pivot.x, from.y - pivot.y);
  if (original < 4) return pts.slice();
  return scaleShape(pts, pivot, Math.max(0.02, Math.hypot(to.x - pivot.x, to.y - pivot.y) / original));
}
