/**
 * Pointer events on the page, sorted into strokes and finger gestures.
 *
 * A pen or a mouse draws; `palm-rejection.ts` has the rules for who does
 * what. A stroke's moves carry every sample the hardware took since the last
 * event (`getCoalescedEvents`, which the Pencil fills at up to 240 Hz),
 * mapped into the surface's space by the function the surface passes in;
 * nothing here knows the layout. WebKit's predicted samples are not passed
 * on: drawn, they made the ink swing (see `ink/freehand.ts`).
 *
 * Fingers scroll and zoom, through `FingerGesture`. The page has
 * `touch-action: none` because on iOS a Pencil drag over anything the browser
 * could scroll turns into a scroll, which cancels the stroke part-way; the
 * price is that the fingers' movement is ours to report.
 *
 * Two quirks of the iPad shape the stroke's lifecycle:
 *
 * - WebKit ends a pen it wants for a gesture of its own, a long press on a
 *   pen held still, in `pointercancel`. That goes to the surface as a cancel,
 *   never as an end, and the surface decides what the ink was (a hold).
 * - iOS now and then never sends the pointerup when the pen lifts and lands
 *   again quickly: the stem and then the bar of a "T". A pen-down that finds
 *   a stroke still open cancels that stroke before starting its own, and the
 *   surface keeps the cancelled stroke's ink.
 */

import { FingerGesture, type PinchInfo } from "./finger-gesture";
import { roleOf } from "./palm-rejection";

export type { PinchInfo };

export interface PointerSample {
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
}

export type PointerDebugType = "down" | "move" | "up" | "cancel";

export interface PointerDebugRecord {
  type: PointerDebugType;
  pointerType: string;
  pointerId: number;
  pressure: number;
  /** How many samples a move carried; 0 for the other types. */
  coalesced: number;
  /** The event's `timeStamp` (ms), for measuring the gaps between events. */
  timeStamp: number;
  /** Its position is whole CSS px on both axes ({@link isWholePixel}). */
  wholePixel: boolean;
}

/**
 * Whether a pointer position is whole CSS px on both axes. WebKit before
 * Safari 26.2 (iPadOS 26.2) rounds every pointer and touch position to whole
 * px, so a Pencil's samples are each up to half a px off, and a stroke drawn
 * through them wobbles (FineNotes#1: every raw sample of the reporter's
 * notebook sat exactly on the screen-px grid). A pen that reports a position
 * with a fraction is not rounding.
 */
export function isWholePixel(position: { clientX: number; clientY: number }): boolean {
  return Number.isInteger(position.clientX) && Number.isInteger(position.clientY);
}

/**
 * Whether this browser hands over the samples a pointer took between two
 * events (`getCoalescedEvents`; WebKit from iOS 18.2). Without them a pen
 * arrives once a frame, and a stroke is filled in between its samples
 * (`StrokeBuilderOptions.densify`).
 */
export function deliversCoalescedSamples(): boolean {
  return (
    typeof PointerEvent !== "undefined" &&
    typeof PointerEvent.prototype.getCoalescedEvents === "function"
  );
}

export interface PointerControllerCallbacks {
  onStart(sample: PointerSample): void;
  canConstrainShape?(sample: PointerSample): boolean;
  onShapeConstraint?(active: boolean): void;
  onModifierDebug?(state: string): void;
  modifierDebugEnabled?: () => boolean;
  shapeConstraintRejection?: (sample: PointerSample) => string | null;
  /** The samples since the last move. */
  onMove(coalesced: PointerSample[]): void;
  onEnd(sample: PointerSample): void;
  onCancel(): void;
  /** A finger gesture began, or was re-anchored, at this client point. */
  onPanStart?(x: number, y: number, t: number): void;
  /** The gesture's focus moved. */
  onPanMove?(x: number, y: number, t: number): void;
  /** The last finger lifted. */
  onPanEnd?(t: number): void;
  /** Every finger gesture is void (a pen landed). */
  onPanCancel?(): void;
  /** A second finger landed: a pinch begins about the midpoint. */
  onPinchStart?(centerX: number, centerY: number): void;
  onPinch?(info: PinchInfo): void;
  /** Fewer than two fingers remain. */
  onPinchEnd?(): void;
  /** Each event of the drawing pointer as it arrived, for the debug HUD. */
  onDebug?(record: PointerDebugRecord): void;
}

const PHASES = ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const;
type Phase = (typeof PHASES)[number];

export class PointerController {
  /** The pointer drawing the open stroke; null between strokes. */
  private stroke: number | null = null;
  private penStroke = false;
  private penCaptureLost = false;
  private modifier: { id: number; x: number; y: number; sample: PointerSample; active: boolean; slop: number; timer: ReturnType<typeof setTimeout> | null } | null = null;
  /** Reserved contacts never enter pan, pinch or history, even after Pencil lift. */
  get hasModifierContact(): boolean { return this.modifier !== null; }
  get isPenDrawing(): boolean { return this.stroke !== null && this.penStroke; }
  cancelShapeConstraint(): void {
    const modifier = this.modifier;
    if (!modifier) return;
    if (modifier.timer !== null) clearTimeout(modifier.timer);
    modifier.timer = null;
    if (modifier.active) { modifier.active = false; this.listener.onShapeConstraint?.(false); }
  }
  cancelDrawing(): void {
    this.cancelShapeConstraint();
    if (this.stroke === null) return;
    this.releaseCapture(this.stroke);
    this.stroke = null;
    this.penStroke = false;
    this.listener.onCancel();
  }

  /** A pen has reported a position with a fraction: this device does not round. */
  private penIsPrecise = false;
  /** See {@link strokeRounded}. */
  private rounded = false;
  private readonly fingers: FingerGesture;
  private readonly handlers: Record<Phase, (event: PointerEvent) => void>;

  constructor(
    private readonly element: HTMLElement,
    private readonly toLocal: (clientX: number, clientY: number) => { x: number; y: number },
    private readonly listener: PointerControllerCallbacks,
    /** Space is held: a pen or mouse coming down pans like a finger (FineNotes#7). */
    private readonly handHeld: () => boolean = () => false,
  ) {
    this.fingers = new FingerGesture(listener);
    this.handlers = {
      pointerdown: (event) => this.pressed(event),
      pointermove: (event) => this.moved(event),
      pointerup: (event) => this.released(event, false),
      pointercancel: (event) => this.released(event, true),
    };
  }

  get modifierStatus(): Record<string, unknown> {
    return { penPointerId: this.stroke, realPen: this.penStroke, penCaptureLost: this.penCaptureLost, penCaptured: this.stroke !== null && this.element.hasPointerCapture(this.stroke), fingerPointerId: this.modifier?.id ?? null, active: this.modifier?.active ?? false, waiting: this.modifier?.timer !== null && this.modifier !== null };
  }
  private readonly gotCapture = (event: PointerEvent): void => {
    if (event.pointerId === this.stroke && this.element.hasPointerCapture(event.pointerId)) this.penCaptureLost = false;
    this.listener.onModifierDebug?.(`capture acquired: ${event.pointerType}#${event.pointerId}, owned=${this.element.hasPointerCapture(event.pointerId)}`);
  };
  private readonly lostModifier = (event: PointerEvent): void => {
    // Capture loss bubbles from old child targets during transfer. The pending
    // target still belongs to us in that case; it is not gesture cancellation.
    if (this.element.hasPointerCapture(event.pointerId)) {
      this.listener.onModifierDebug?.(`capture transferred: ${event.pointerType}#${event.pointerId}, still owned`);
      return;
    }
    if (event.pointerId === this.stroke) { this.penCaptureLost = true; this.cancelShapeConstraint(); this.listener.onModifierDebug?.("Pencil capture lost"); return; }
    if (event.pointerId !== this.modifier?.id) return;
    this.cancelShapeConstraint();
    this.modifier = null;
    this.listener.onModifierDebug?.("finger capture lost; modifier cleared");
  };
  private readonly modifierBlur = (): void => {
    const modifier = this.modifier;
    if (!modifier) return;
    this.cancelDrawing();
    this.releaseCapture(modifier.id);
    if (this.modifier === modifier) this.modifier = null;
  };
  private readonly modifierVisibility = (): void => {
    if (this.element.ownerDocument?.visibilityState === "hidden") this.modifierBlur();
  };
  // Only modifier touches are intercepted in capture phase; ordinary input keeps its routing.
  private readonly modifierDown = (event: PointerEvent): void => {
    if (this.tryModifier(event)) event.stopPropagation();
  };
  private tryModifier(event: PointerEvent): boolean {
    if (event.pointerType !== "touch") return false;
    this.listener.onModifierDebug?.(`finger pointerdown received: id=${event.pointerId}, contact=${event.width ?? 1}x${event.height ?? 1}`);
    if (!this.isPenDrawing) { this.listener.onModifierDebug?.("rejected: no active real Pencil"); return false; }
    if (this.penCaptureLost) { this.listener.onModifierDebug?.("rejected: Pencil capture genuinely lost"); return false; }
    if (this.modifier) { this.listener.onModifierDebug?.("rejected: another modifier contact already reserved"); return false; }
    const target = event.target as HTMLElement | null;
    if (target?.closest?.("button, input, textarea, [contenteditable=true], .goodobsidian-selection-ui, .goodobsidian-image-ui, .goodobsidian-textboxes")) { this.listener.onModifierDebug?.("rejected: control/text/selection target"); return false; }
    const sample = this.sample(event);
    if (!this.listener.canConstrainShape?.(sample)) { this.listener.onModifierDebug?.(`rejected: ${this.listener.shapeConstraintRejection?.(sample) ?? "ineligible shape or disabled"}`); return false; }
    const w = Math.max(1, event.width ?? 1), h = Math.max(1, event.height ?? 1);
    if (w > 56 || h > 56 || w * h > 2500 || Math.max(w / h, h / w) > 2.5) { this.listener.onModifierDebug?.("palm contact rejected"); return false; }
    const modifier = { id: event.pointerId, x: event.clientX, y: event.clientY, sample, active: false, slop: Math.max(8, Math.min(16, Math.max(w, h) * 0.4)), timer: null as ReturnType<typeof setTimeout> | null };
    this.modifier = modifier;
    try { this.element.setPointerCapture(event.pointerId); } catch { /* Capture may be unavailable during teardown. */ }
    event.preventDefault();
    this.listener.onModifierDebug?.("eligible contact; waiting");
    modifier.timer = setTimeout(() => {
      modifier.timer = null;
      if (this.modifier === modifier && this.isPenDrawing && this.listener.canConstrainShape?.(modifier.sample)) {
        modifier.active = true;
        this.listener.onModifierDebug?.("activated");
        this.listener.onShapeConstraint?.(true);
      } else this.listener.onModifierDebug?.("eligibility lost before hold");
    }, 140);
    return true;
  }
  // Diagnostics only: observe both browser streams without routing or claiming
  // raw touches. This distinguishes missing PointerEvents from eligibility failure.
  private readonly observeDocumentPointer = (event: PointerEvent): void => {
    if (!this.listener.modifierDebugEnabled?.() || event.pointerType !== "touch") return;
    this.listener.onModifierDebug?.(`document finger pointerdown: id=${event.pointerId}, inside=${this.element.contains(event.target as Node)}`);
  };
  private readonly observeDocumentTouch = (event: TouchEvent): void => {
    if (!this.listener.modifierDebugEnabled?.()) return;
    for (const touch of Array.from(event.changedTouches)) {
      this.listener.onModifierDebug?.(`document ${event.type}: ${(touch as Touch & { touchType?: string }).touchType ?? "unknown"}#${touch.identifier}, inside=${this.element.contains(event.target as Node)}`);
    }
  };
  attach(): void {
    this.element.addEventListener("pointerdown", this.modifierDown, true);
    this.element.addEventListener("gotpointercapture", this.gotCapture);
    this.element.ownerDocument?.addEventListener("pointerdown", this.observeDocumentPointer, true);
    for (const type of ["touchstart", "touchend", "touchcancel"] as const) this.element.ownerDocument?.addEventListener(type, this.observeDocumentTouch, true);
    this.element.addEventListener("lostpointercapture", this.lostModifier);
    this.element.ownerDocument?.addEventListener("visibilitychange", this.modifierVisibility);
    this.element.ownerDocument?.defaultView?.addEventListener("blur", this.modifierBlur);
    for (const phase of PHASES) this.element.addEventListener(phase, this.handlers[phase]);
  }

  detach(): void {
    this.element.removeEventListener("pointerdown", this.modifierDown, true);
    this.element.removeEventListener("gotpointercapture", this.gotCapture);
    this.element.ownerDocument?.removeEventListener("pointerdown", this.observeDocumentPointer, true);
    for (const type of ["touchstart", "touchend", "touchcancel"] as const) this.element.ownerDocument?.removeEventListener(type, this.observeDocumentTouch, true);
    this.element.removeEventListener("lostpointercapture", this.lostModifier);
    this.element.ownerDocument?.removeEventListener("visibilitychange", this.modifierVisibility);
    this.element.ownerDocument?.defaultView?.removeEventListener("blur", this.modifierBlur);
    this.cancelShapeConstraint();
    if (this.modifier) this.releaseCapture(this.modifier.id);
    this.modifier = null;
    for (const phase of PHASES) this.element.removeEventListener(phase, this.handlers[phase]);
  }

  /** Whether a finger gesture is in progress. */
  get isTouching(): boolean {
    return this.fingers.active;
  }

  /**
   * The stroke under way is a pen's, and this device's pen positions arrive
   * rounded to whole px: no pen event so far, its pen-down included, had a
   * fraction. Decided at the pen-down and kept for the stroke. A mouse is
   * never counted (desktop mice report whole px and need nothing smoothed).
   */
  get strokeRounded(): boolean {
    return this.rounded;
  }

  private pressed(event: PointerEvent): void {
    if (event.pointerType === "mouse" && event.button != null && event.button !== 0) return;
    const { pointerId, clientX, clientY, timeStamp } = event;
    const role = roleOf(event.pointerType, this.stroke !== null);
    if (event.pointerId === this.modifier?.id || this.tryModifier(event)) return;
    if (role === "draw" && this.stroke === null && this.handHeld()) {
      // A stroke already under way is left to finish; only a new one pans.
      event.preventDefault();
      if (this.fingers.down(pointerId, clientX, clientY, timeStamp)) {
        this.element.setPointerCapture(pointerId);
      }
    } else if (role === "draw") {
      this.beginStroke(event);
    } else if (role === "finger" && this.fingers.down(pointerId, clientX, clientY, timeStamp)) {
      // Capture, so a fast swipe that leaves the pane still scrolls it.
      this.element.setPointerCapture(pointerId);
    }
  }

  private beginStroke(event: PointerEvent): void {
    this.cancelShapeConstraint();
    for (const finger of this.fingers.cancel()) this.releaseCapture(finger);
    if (this.stroke !== null) {
      // The last stroke's pointerup never came (see the top of the file).
      this.releaseCapture(this.stroke);
      this.stroke = null;
      this.listener.onCancel();
    }
    this.penCaptureLost = false;
    this.stroke = event.pointerId;
    this.element.setPointerCapture(event.pointerId);
    event.preventDefault();
    const pen = event.pointerType === "pen";
    this.penStroke = pen;
    this.listener.onModifierDebug?.(`drawing pointer started: ${event.pointerType}#${event.pointerId}, real Pencil=${pen}`);
    if (pen) this.notePen(event);
    this.rounded = pen && !this.penIsPrecise;
    this.debug("down", event, 0);
    this.listener.onStart(this.sample(event));
  }

  private moved(event: PointerEvent): void {
    if (event.pointerId === this.modifier?.id) {
      event.preventDefault();
      if ((this.modifier.active || this.modifier.timer !== null) && Math.hypot(event.clientX - this.modifier.x, event.clientY - this.modifier.y) > this.modifier.slop) { this.listener.onModifierDebug?.("contact moved"); this.cancelShapeConstraint(); }
      return;
    }
    if (this.modifier?.active && !this.listener.canConstrainShape?.(this.modifier.sample)) this.cancelShapeConstraint();
    if (event.pointerId !== this.stroke) {
      this.fingers.move(event.pointerId, event.clientX, event.clientY, event.timeStamp);
      return;
    }
    event.preventDefault();
    const taken = event.getCoalescedEvents?.() ?? [];
    // Where the browser has no coalesced list, the event is the one sample.
    const samples = taken.length > 0 ? taken.map((e) => this.sample(e)) : [this.sample(event)];
    if (event.pointerType === "pen")
      for (const e of taken.length > 0 ? taken : [event]) this.notePen(e);
    this.debug("move", event, samples.length);
    this.listener.onMove(samples);
  }

  private released(event: PointerEvent, cancelled: boolean): void {
    const id = event.pointerId;
    if (id === this.modifier?.id) {
      event.preventDefault();
      this.cancelShapeConstraint();
      this.releaseCapture(id);
      this.modifier = null;
      this.listener.onModifierDebug?.(cancelled ? "contact cancelled" : "contact released");
      return;
    }
    if (id !== this.stroke) {
      if (this.fingers.lift(id, event.timeStamp)) this.releaseCapture(id);
      return;
    }
    this.stroke = null;
    this.penStroke = false;
    this.releaseCapture(id);
    this.listener.onModifierDebug?.(cancelled ? "Pencil pointercancel; gesture ending" : "Pencil pointerup; committing visible geometry");
    if (cancelled) {
      this.debug("cancel", event, 0);
      this.cancelShapeConstraint();
      this.listener.onCancel();
      return;
    }
    event.preventDefault();
    this.debug("up", event, 0);
    this.listener.onEnd(this.sample(event));
    this.cancelShapeConstraint();
  }

  /** The event as a stroke sample, in the surface's space. */
  private sample(event: PointerEvent): PointerSample {
    const at = this.toLocal(event.clientX, event.clientY);
    const { pressure, tiltX, tiltY } = event;
    return { x: at.x, y: at.y, pressure, tiltX, tiltY };
  }

  /** One position with a fraction is enough: this device's pen does not round. */
  private notePen(position: { clientX: number; clientY: number }): void {
    if (!this.penIsPrecise && !isWholePixel(position)) this.penIsPrecise = true;
  }

  private debug(type: PointerDebugType, event: PointerEvent, coalesced: number): void {
    const { pointerType, pointerId, pressure, timeStamp } = event;
    const wholePixel = isWholePixel(event);
    this.listener.onDebug?.({
      type,
      pointerType,
      pointerId,
      pressure,
      coalesced,
      timeStamp,
      wholePixel,
    });
  }

  /**
   * Release a capture only while the pointer still holds it: by the time a
   * stuck stroke is cancelled WebKit may have forgotten its pointer, and
   * releasing an unknown pointer throws.
   */
  private releaseCapture(id: number): void {
    if (this.element.hasPointerCapture(id)) this.element.releasePointerCapture(id);
  }
}
