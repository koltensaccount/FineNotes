/** Optional completed-stroke correction. No work is added to pointermove. */
import { CENTRED_WEIGHTS } from "./stroke-builder";
export function smoothCompletedStroke(pts: number[], strength: number, alreadyCentred = false): number[] {
  if (!(strength > 0) || pts.length < 27) return pts;
  const n = pts.length / 3, blend = Math.min(10, strength) / 10 * (alreadyCentred ? 0.5 : 1);
  const out = pts.slice();
  const sharp = (i: number): boolean => {
    if (i <= 0 || i >= n - 1) return false;
    const j = i * 3, ax = pts[j] - pts[j - 3], ay = pts[j + 1] - pts[j - 2], bx = pts[j + 3] - pts[j], by = pts[j + 4] - pts[j + 1];
    const product = (ax * ax + ay * ay) * (bx * bx + by * by), dot = ax * bx + ay * by;
    return product > 0 && (dot < 0 || dot * dot < 0.25 * product);
  };
  let corners = 0;
  for (let i = 1; i <= 5; i++) if (sharp(i)) corners |= 1 << (i - 1);
  for (let i = 3; i < n - 3; i++) {
    const protectedCorner = corners !== 0;
    corners = (corners >>> 1) | (sharp(i + 3) ? 16 : 0);
    if (protectedCorner) continue;
    const weights = CENTRED_WEIGHTS[3];
    let x = 0, y = 0, loX = Infinity, hiX = -Infinity, loY = Infinity, hiY = -Infinity;
    for (let k = -3; k <= 3; k++) {
      const j = (i + k) * 3;
      x += pts[j] * weights[k + 3] / 21; y += pts[j + 1] * weights[k + 3] / 21;
      loX = Math.min(loX, pts[j]); hiX = Math.max(hiX, pts[j]); loY = Math.min(loY, pts[j + 1]); hiY = Math.max(hiY, pts[j + 1]);
    }
    const j = i * 3;
    let dx = (Math.max(loX, Math.min(hiX, x)) - pts[j]) * blend, dy = (Math.max(loY, Math.min(hiY, y)) - pts[j + 1]) * blend;
    // Bound visible correction by local spacing and one page pixel; retain tight loops.
    const limit = Math.min(1, 0.35 * Math.min(Math.hypot(pts[j] - pts[j - 3], pts[j + 1] - pts[j - 2]), Math.hypot(pts[j + 3] - pts[j], pts[j + 4] - pts[j + 1])));
    const d = Math.hypot(dx, dy); if (d > limit) { dx *= limit / d; dy *= limit / d; }
    out[j] = pts[j] + dx; out[j + 1] = pts[j + 1] + dy;
  }
  return out;
}
