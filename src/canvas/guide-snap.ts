/**
 * Reusable pure guide-snapping geometry for page objects.
 *
 * Kept DOM-free and axis-generic so the same primitive can later back grid/dot
 * guides, object-to-object alignment, or resize handle snapping.
 */
import type { Bounds, Page } from "../model/document";
import { guidesEligible, type WritingGuideStyle } from "../model/writing-guides";
import { writingGuidePitch } from "./writing-guides";

/** Capture range in CSS screen pixels; converted to page px via `1 / scale`. */
export const IMAGE_GUIDE_SNAP_PX = 8;

export type SnapAxis = "x" | "y";
export type SnapEdge = "start" | "center" | "end";

export interface AxisSnapMatch {
  axis: SnapAxis;
  edge: SnapEdge;
  /** Coordinate of the target line in page px. */
  target: number;
  /** Shift to apply along `axis` in page px. */
  delta: number;
  /** Absolute distance from the unsnapped edge to `target` in page px. */
  distance: number;
}

export interface RuledGuideSnapResult {
  /** Vertical shift to apply in page px (0 when no guide caught). */
  dy: number;
  /** Page-space Y coordinate of the caught ruled guide, or null. */
  guideY: number | null;
  /** Which image edge caught the guide, or null. */
  edge: "top" | "bottom" | null;
}

function edgePosition(box: Bounds, axis: SnapAxis, edge: SnapEdge): number {
  const lo = axis === "x" ? box.minX : box.minY;
  const hi = axis === "x" ? box.maxX : box.maxY;
  if (edge === "start") return lo;
  if (edge === "end") return hi;
  return (lo + hi) / 2;
}

function usableBounds(box: Bounds): boolean {
  return (
    Number.isFinite(box.minX) &&
    Number.isFinite(box.minY) &&
    Number.isFinite(box.maxX) &&
    Number.isFinite(box.maxY) &&
    box.maxX >= box.minX &&
    box.maxY >= box.minY
  );
}

/**
 * Find the closest snap match along `axis` for any of `edges` against `targets`
 * within `radius` page px. Deterministic tie-break: earlier edge, then smaller target.
 */
export function snapAxisToTargets(
  box: Bounds,
  axis: SnapAxis,
  targets: readonly number[],
  radius: number,
  edges: readonly SnapEdge[] = ["start", "end"],
): AxisSnapMatch | null {
  if (!usableBounds(box) || !(radius > 0) || !Number.isFinite(radius) || targets.length === 0) {
    return null;
  }
  let best: AxisSnapMatch | null = null;
  for (const edge of edges) {
    const pos = edgePosition(box, axis, edge);
    for (const target of targets) {
      if (!Number.isFinite(target)) continue;
      const delta = target - pos;
      const distance = Math.abs(delta);
      if (distance > radius) continue;
      if (
        !best ||
        distance < best.distance - 1e-9 ||
        (Math.abs(distance - best.distance) <= 1e-9 &&
          edge === best.edge &&
          target < best.target)
      ) {
        best = { axis, edge, target, delta, distance };
      }
    }
  }
  return best;
}

/**
 * Candidate guide coordinates (`k * pitch` within `[0, pageExtent]`) near
 * `startPos` or `endPos`, matching the exact line positions `paintWritingGuides` draws.
 */
export function nearbyGuideLines(
  startPos: number,
  endPos: number,
  pageExtent: number,
  pitch: number,
): number[] {
  if (!(pitch > 0) || !Number.isFinite(pitch) || !(pageExtent > 0) || !Number.isFinite(pageExtent)) {
    return [];
  }
  const seen = new Set<number>();
  const addIndex = (index: number): void => {
    if (!Number.isFinite(index) || index < 0) return;
    const coord = index * pitch;
    if (coord >= 0 && coord <= pageExtent) seen.add(coord);
  };
  for (const pos of [startPos, endPos]) {
    if (!Number.isFinite(pos)) continue;
    const base = Math.floor(pos / pitch);
    addIndex(base);
    addIndex(base + 1);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Snap an object's top or bottom edge vertically to the nearest visible ruled
 * writing guide on `page`, using the same guide pitch the canvas renders.
 */
export function snapBoundsToRuledGuides(
  bounds: Bounds,
  page: Page,
  style: WritingGuideStyle | null,
  radiusPagePx: number,
  rasterScale: number,
): RuledGuideSnapResult {
  const none: RuledGuideSnapResult = { dy: 0, guideY: null, edge: null };
  if (
    !style ||
    style.style !== "lines" ||
    !guidesEligible(page) ||
    !usableBounds(bounds) ||
    !(radiusPagePx > 0) ||
    !Number.isFinite(radiusPagePx) ||
    !(rasterScale > 0) ||
    !Number.isFinite(rasterScale)
  ) {
    return none;
  }
  const pitch = writingGuidePitch(style, rasterScale);
  const candidates = nearbyGuideLines(bounds.minY, bounds.maxY, page.geometry.height, pitch);
  const match = snapAxisToTargets(bounds, "y", candidates, radiusPagePx, ["start", "end"]);
  if (!match) return none;
  return {
    dy: match.delta,
    guideY: match.target,
    edge: match.edge === "start" ? "top" : "bottom",
  };
}
