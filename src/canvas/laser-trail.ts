/**
 * The laser pointer's neon trail (FineNotes#25): a glowing multi-stroke beam
 * for pointing at a page while presenting or explaining. It is never part of
 * the notebook: nothing here reaches the document, the history or a save.
 *
 * Points are kept in layout space, so the trail stays on the ink it points at
 * while the page scrolls under it. Everything drawn stays 100% solid while the
 * pen is down and across quick consecutive strokes; once you pause writing for
 * {@link LASER_HOLD_MS}, the entire group fades away smoothly over
 * {@link LASER_FADE_MS}.
 *
 * Pure: no DOM, no Obsidian.
 */

/** How long drawn laser strokes stay 100% solid after lifting the pen, ms. */
export const LASER_HOLD_MS = 1000;

/** How long the laser strokes take to fade away after the hold window, ms. */
export const LASER_FADE_MS = 650;

/** The trail's colour: vivid neon red laser. */
export const LASER_COLOR = "#ff3b30";

/** The trail's core width, and its glow's outer radius, in screen px. */
export const LASER_WIDTH_PX = 4;
export const LASER_GLOW_PX = 22;

/** How many opacity steps legacy segmented callers bucket into. */
export const LASER_FADE_STEPS = 24;

export interface LaserPoint {
  x: number;
  y: number;
  /** When it was drawn, ms. */
  t: number;
}

/** One piece of the trail to draw: from `a` to `b`, at `alpha` (0–1). */
export interface LaserSegment {
  a: LaserPoint;
  b: LaserPoint;
  alpha: number;
}

/** One opacity step: each run is a contiguous line, drawn without lifting the pen. */
export interface LaserPath {
  alpha: number;
  runs: LaserPoint[][];
}

/** Snapshot of all currently visible neon laser strokes and their unified alpha. */
export interface LaserFrame {
  strokes: readonly (readonly LaserPoint[])[];
  alpha: number;
  /** Active stylus tip while touching the screen (used to paint a glowing dot even when stationary). */
  tip: LaserPoint | null;
}

/**
 * The trail's segments gathered into opacity steps.
 */
export function laserPaths(segments: readonly LaserSegment[]): LaserPath[] {
  const steps = new Map<number, LaserPoint[][]>();
  for (const { a, b, alpha } of segments) {
    if (!(alpha > 0)) continue;
    const step = Math.min(LASER_FADE_STEPS, Math.max(1, Math.round(alpha * LASER_FADE_STEPS)));
    let runs = steps.get(step);
    if (!runs) {
      runs = [];
      steps.set(step, runs);
    }
    const run = runs[runs.length - 1];
    const last = run?.[run.length - 1];
    if (last && last.x === a.x && last.y === a.y) run.push(b);
    else runs.push([a, b]);
  }
  return [...steps.entries()]
    .sort(([left], [right]) => left - right)
    .map(([step, runs]) => ({ alpha: step / LASER_FADE_STEPS, runs }));
}

export class LaserTrail {
  private strokes: LaserPoint[][] = [];
  /** The pen is currently down: everything stays 100% solid. */
  private down = false;
  /** Timestamp of the most recent pen lift, or null while drawing/empty. */
  private liftedAt: number | null = null;

  /** The pen came down at `p`: starts a new stroke and keeps any visible strokes solid. */
  start(p: LaserPoint): void {
    this.prune(p.t);
    this.down = true;
    this.liftedAt = null;
    this.strokes.push([p]);
  }

  add(p: LaserPoint): void {
    if (!this.down || this.strokes.length === 0) return;
    const current = this.strokes[this.strokes.length - 1];
    const last = current[current.length - 1];
    // Skip duplicate coordinates so quadratic smoothing never collapses on zero-length spans.
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.5) return;
    current.push(p);
  }

  /** The pen lifted at time `t`: hold solid for {@link LASER_HOLD_MS}, then fade out. */
  end(t: number): void {
    if (!this.down) return;
    this.down = false;
    this.liftedAt = t;
  }

  /** Current unified opacity (0–1) for all strokes at time `t`. */
  alpha(t: number): number {
    if (this.strokes.length === 0) return 0;
    if (this.down || this.liftedAt === null) return 1;
    const sinceLift = t - this.liftedAt;
    if (sinceLift <= LASER_HOLD_MS) return 1;
    return fade(sinceLift - LASER_HOLD_MS);
  }

  /** Whether anything is left to draw at time `t` (the frame loop keeps going while so). */
  visible(t: number): boolean {
    this.prune(t);
    return this.down || this.strokes.length > 0;
  }

  /** Complete smooth strokes and live tip for neon rendering at time `t`. */
  activeStrokes(t: number): LaserFrame {
    this.prune(t);
    const a = this.alpha(t);
    if (!(a > 0) || this.strokes.length === 0) {
      return { strokes: [], alpha: 0, tip: null };
    }
    const lastStroke = this.strokes[this.strokes.length - 1];
    const tip = this.down && lastStroke.length > 0 ? lastStroke[lastStroke.length - 1] : null;
    return { strokes: this.strokes, alpha: a, tip };
  }

  /** Legacy segment view at time `t`. */
  segments(t: number): LaserSegment[] {
    const frame = this.activeStrokes(t);
    if (!(frame.alpha > 0)) return [];
    const out: LaserSegment[] = [];
    for (const stroke of frame.strokes) {
      for (let i = 1; i < stroke.length; i++) {
        out.push({ a: stroke[i - 1], b: stroke[i], alpha: frame.alpha });
      }
    }
    return out;
  }

  clear(): void {
    this.strokes = [];
    this.down = false;
    this.liftedAt = null;
  }

  /** Drop all strokes once the post-lift hold + fade has finished. */
  private prune(t: number): void {
    if (!this.down && this.liftedAt !== null && this.alpha(t) <= 0) {
      this.strokes = [];
      this.liftedAt = null;
    }
  }
}

/** Smooth ease-out fade from 1 to 0 over {@link LASER_FADE_MS}. */
export function fade(age: number): number {
  if (age <= 0) return 1;
  if (age >= LASER_FADE_MS) return 0;
  const left = 1 - age / LASER_FADE_MS;
  return left * left;
}
