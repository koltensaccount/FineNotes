/**
 * Floating window placement and bounds clamping.
 * Pure: no DOM, no Obsidian.
 */

/** Where a floating window sat: px from the view's top-left, its size, minimised. */
export interface WindowPlace {
  x: number;
  y: number;
  w: number;
  h: number;
  minimised?: true;
}

/** A floating window is never smaller than this. */
export const WINDOW_MIN = { w: 240, h: 200 };
/** A minimised window: the pill it shrinks to. */
export const WINDOW_PILL = { w: 132, h: 40 };
export const WINDOW_MARGIN = 8;

/**
 * Where a window first opens by default: top right.
 */
export function defaultPlace(bounds: { w: number; h: number }): WindowPlace {
  const w = Math.max(WINDOW_MIN.w, Math.min(560, Math.round(bounds.w * 0.45)));
  const h = Math.max(WINDOW_MIN.h, Math.min(380, Math.round(bounds.h / 2)));
  return clampPlace({ x: bounds.w - w - 16, y: 64, w, h }, bounds);
}

/**
 * `place` kept inside a view `bounds` (a split view, a rotation): no
 * smaller than `min` ({@link WINDOW_MIN} unless given), no larger than the
 * view, and with its title bar (or the pill) wholly inside.
 */
export function clampPlace(
  place: WindowPlace,
  bounds: { w: number; h: number },
  min: { w: number; h: number } = WINDOW_MIN,
): WindowPlace {
  const roomW = Math.max(min.w, bounds.w - 2 * WINDOW_MARGIN);
  const roomH = Math.max(min.h, bounds.h - 2 * WINDOW_MARGIN);
  const w = Math.min(roomW, Math.max(min.w, place.w));
  const h = Math.min(roomH, Math.max(min.h, place.h));
  const shownW = place.minimised ? WINDOW_PILL.w : w;
  const shownH = place.minimised ? WINDOW_PILL.h : h;
  const clamp = (v: number, size: number, room: number): number =>
    Math.max(WINDOW_MARGIN, Math.min(room - size - WINDOW_MARGIN, v));
  const next: WindowPlace = {
    x: Math.round(clamp(place.x, shownW, bounds.w)),
    y: Math.round(clamp(place.y, shownH, bounds.h)),
    w: Math.round(w),
    h: Math.round(h),
  };
  if (place.minimised) next.minimised = true;
  return next;
}
