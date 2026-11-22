/**
 * Calculation notes (FineNotes#178): the glow that says "this ink was read
 * as maths". A canvas in the paper, over the sum's bounds, that draws a soft
 * accent halo along the sum's strokes and a dotted accent line under each
 * group Grape was unsure of. It is chrome, not ink: nothing on the page
 * changes. A tap on it opens the maths card (the surface wires that).
 *
 * The halo is drawn with `shadowBlur`, not `ctx.filter`: WebKit before
 * Safari 18 has no canvas filters.
 */

import { setIcon } from "obsidian";
import { type Bounds, POINT_STRIDE, type Stroke, strokeBounds } from "../model/document";
import { t } from "../i18n/translate";
import { onTap } from "./selection-bar";

/** Room around the sum for the halo, page px at fit zoom. */
const PAD = 18;
/** How far off the canvas the strokes are drawn, for their shadow alone to land on it, device px. */
const SHADOW_SHIFT = 100000;

export interface CalcGlowSpec {
  pageId: string;
  strokes: readonly Stroke[];
  /** Groups of stroke ids Grape was unsure of: a dotted line under each. */
  doubts: readonly (readonly string[])[];
  /** Page-space anchor right beside the "=" where the compact clickable trigger sits. */
  triggerAt?: { x: number; y: number };
  /** Short answer preview shown on the compact trigger pill (empty = icon only). */
  label?: string;
}

export class CalcGlow {
  private readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly triggerBtn: HTMLButtonElement;
  private readonly triggerIcon: HTMLSpanElement;
  private readonly triggerLabel: HTMLSpanElement;
  private spec: CalcGlowSpec | null = null;
  private bounds: Bounds | null = null;
  private triggerSuppressed = false;
  /** The scale it was last drawn at, so a move alone does not redraw. */
  private drawnScale = 0;

  /**
   * `onOpen` runs ONLY when the user deliberately taps the small trigger pill
   * beside the "=". The halo itself is purely visual (`pointer-events: none`)
   * so writing anywhere around the glowing strokes is never interrupted.
   */
  constructor(parent: HTMLElement, onOpen: (doubt: number) => void) {
    this.el = parent.createDiv({ cls: "goodobsidian-calc-glow is-hidden" });
    this.canvas = this.el.createEl("canvas");
    this.triggerBtn = parent.createEl("button", {
      cls: "goodobsidian-calc-trigger clickable-icon is-hidden",
      attr: { "aria-label": t("calculator.mathsMark") },
    });
    this.triggerIcon = this.triggerBtn.createSpan({ cls: "goodobsidian-calc-trigger-icon" });
    setIcon(this.triggerIcon, "calculator");
    this.triggerLabel = this.triggerBtn.createSpan({ cls: "goodobsidian-calc-trigger-label" });
    onTap(this.triggerBtn, () => onOpen(-1));
  }

  /** Whether `node` is the clickable trigger beside "=" (never the passive halo). */
  contains(node: Node | null): boolean {
    return node !== null && this.triggerBtn.contains(node);
  }

  setTriggerHidden(hidden: boolean): void {
    this.triggerSuppressed = hidden;
    this.triggerBtn.toggleClass("is-hidden", hidden || this.bounds === null);
  }

  get pageId(): string | null {
    return this.spec?.pageId ?? null;
  }

  show(spec: CalcGlowSpec): void {
    this.spec = spec;
    let box: Bounds | null = null;
    for (const s of spec.strokes) {
      const b = strokeBounds(s);
      if (!b) continue;
      box = box
        ? {
            minX: Math.min(box.minX, b.minX),
            minY: Math.min(box.minY, b.minY),
            maxX: Math.max(box.maxX, b.maxX),
            maxY: Math.max(box.maxY, b.maxY),
          }
        : { ...b };
    }
    this.bounds = box;
    this.drawnScale = 0;
    this.el.toggleClass("is-hidden", box === null);
    const label = spec.label?.trim() ?? "";
    this.triggerLabel.textContent = label;
    this.triggerLabel.toggleClass("is-empty", label.length === 0);
    this.triggerBtn.toggleClass("is-hidden", this.triggerSuppressed || box === null);
  }

  hide(): void {
    this.spec = null;
    this.bounds = null;
    this.triggerSuppressed = false;
    this.el.addClass("is-hidden");
    this.triggerBtn.addClass("is-hidden");
  }

  /** Place halo over the sum and compact trigger pill beside "=". */
  place(left: number, top: number, scale: number): void {
    const b = this.bounds;
    if (!b || !this.spec) return;
    const pad = PAD;
    const x = (b.minX - pad) * scale;
    const y = (b.minY - pad) * scale;
    const w = (b.maxX - b.minX + 2 * pad) * scale;
    const h = (b.maxY - b.minY + 2 * pad) * scale;
    this.el.setCssStyles({
      left: `${left + x}px`,
      top: `${top + y}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
    const anchor = this.spec.triggerAt ?? {
      x: b.maxX + 10,
      y: (b.minY + b.maxY) / 2,
    };
    this.triggerBtn.setCssStyles({
      left: `${left + anchor.x * scale}px`,
      top: `${top + anchor.y * scale}px`,
    });
    if (Math.abs(scale - this.drawnScale) > 1e-6) this.draw(scale, w, h);
  }

  private draw(scale: number, w: number, h: number): void {
    const spec = this.spec;
    const b = this.bounds;
    const ctx = this.canvas.getContext("2d");
    if (!spec || !b || !ctx) return;
    this.drawnScale = scale;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.setCssStyles({ width: `${w}px`, height: `${h}px` });
    const accent = getComputedStyle(this.el).color || "#7b6cd9";
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.translate(PAD - b.minX, PAD - b.minY);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // The halo: only the blurred shadow of the strokes, so the ink under it
    // stays its own colour. The strokes are drawn far off the canvas and
    // their shadow shifted back (a shadow's offset is in device px).
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.shadowColor = accent;
    ctx.globalAlpha = 0.65;
    ctx.shadowBlur = 12 * scale * dpr;
    ctx.shadowOffsetX = SHADOW_SHIFT;
    ctx.translate(-SHADOW_SHIFT / (dpr * scale), 0);
    for (const s of spec.strokes) {
      ctx.lineWidth = Math.max(5, s.size * 3);
      tracePath(ctx, s.pts);
      ctx.stroke();
    }
    ctx.restore();
    // A dotted line under each group Grape was unsure of.
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.2;
    ctx.setLineDash([0.1, 5]);
    for (const ids of spec.doubts) {
      const group = spec.strokes.filter((s) => ids.includes(s.id));
      const gb = unionBounds(group);
      if (!gb) continue;
      ctx.beginPath();
      ctx.moveTo(gb.minX, gb.maxY + 5);
      ctx.lineTo(gb.maxX, gb.maxY + 5);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function tracePath(ctx: CanvasRenderingContext2D, pts: readonly number[]): void {
  ctx.beginPath();
  if (pts.length < POINT_STRIDE) return;
  ctx.moveTo(pts[0], pts[1]);
  if (pts.length === POINT_STRIDE) ctx.lineTo(pts[0] + 0.01, pts[1]);
  for (let i = POINT_STRIDE; i + 1 < pts.length; i += POINT_STRIDE) ctx.lineTo(pts[i], pts[i + 1]);
}

function unionBounds(strokes: readonly Stroke[]): Bounds | null {
  let box: Bounds | null = null;
  for (const s of strokes) {
    const b = strokeBounds(s);
    if (!b) continue;
    box = box
      ? {
          minX: Math.min(box.minX, b.minX),
          minY: Math.min(box.minY, b.minY),
          maxX: Math.max(box.maxX, b.maxX),
          maxY: Math.max(box.maxY, b.maxY),
        }
      : { ...b };
  }
  return box;
}
