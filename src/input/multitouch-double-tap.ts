/** Stationary touch chords only; platform-independent and separate from pan/pinch ownership. */
export interface GesturePointer {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  timeStamp: number;
  isPrimary?: boolean;
}
type Action = "undo" | "redo";
interface Contact {
  x: number;
  y: number;
  startX: number;
  startY: number;
}
interface Tap {
  count: number;
  x: number;
  y: number;
  ended: number;
}
export class MultiTouchDoubleTap {
  private contacts = new Map<number, Contact>();
  private pens = new Set<number>();
  private first: Tap | null = null;
  private started = 0;
  private valid = false;
  private peak = 0;
  private seen = 0;
  private anchor = { x: 0, y: 0 };
  constructor(private readonly invoke: (action: Action) => void) {}
  down(pointer: GesturePointer, allowed = true): void {
    if (pointer.pointerType === "pen") {
      this.pens.clear(); // The page controller owns only one active Pencil stroke.
      this.pens.add(pointer.pointerId);
      this.invalidate();
      return;
    }
    if (pointer.pointerType !== "touch") {
      this.invalidate();
      return;
    }
    // A new primary touch (or reused ID) proves an earlier stream ended,
    // even when WebKit omitted its terminal pointer event.
    if ((pointer.isPrimary && this.contacts.size > 0) || this.contacts.has(pointer.pointerId))
      this.reset();
    if (this.contacts.size === 0) {
      this.started = pointer.timeStamp;
      this.valid = allowed && this.pens.size === 0;
      this.peak = 0;
      this.seen = 0;
      if (
        this.first &&
        (pointer.timeStamp - this.first.ended > 350 || pointer.timeStamp < this.first.ended)
      )
        this.first = null;
    }
    this.contacts.set(pointer.pointerId, {
      x: pointer.clientX,
      y: pointer.clientY,
      startX: pointer.clientX,
      startY: pointer.clientY,
    });
    this.seen++;
    this.peak = Math.max(this.peak, this.contacts.size);
    if (!allowed || this.pens.size || this.seen > 3 || pointer.timeStamp - this.started > 80)
      this.invalidate();
    this.anchor = this.centre(true);
  }
  move(pointer: GesturePointer): void {
    if (pointer.pointerType !== "touch") return;
    const contact = this.contacts.get(pointer.pointerId);
    if (!contact) return;
    contact.x = pointer.clientX;
    contact.y = pointer.clientY;
    if (Math.hypot(contact.x - contact.startX, contact.y - contact.startY) > 8) this.invalidate();
    const points = [...this.contacts.values()];
    for (let a = 0; a < points.length; a++)
      for (let b = a + 1; b < points.length; b++) {
        const before = Math.hypot(
          points[a].startX - points[b].startX,
          points[a].startY - points[b].startY,
        );
        const after = Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
        if (Math.abs(after - before) > 4) this.invalidate();
      }
    const start = this.centre(true),
      now = this.centre(false);
    if (Math.hypot(now.x - start.x, now.y - start.y) > 6) this.invalidate();
  }
  up(pointer: GesturePointer): void {
    if (pointer.pointerType === "pen") {
      this.pens.delete(pointer.pointerId);
      return;
    }
    if (pointer.pointerType !== "touch" || !this.contacts.has(pointer.pointerId)) return;
    this.move(pointer);
    this.contacts.delete(pointer.pointerId);
    if (this.contacts.size) return;
    const duration = pointer.timeStamp - this.started;
    if (
      !this.valid ||
      duration < 0 ||
      duration > 220 ||
      this.seen !== this.peak ||
      (this.peak !== 2 && this.peak !== 3)
    ) {
      this.invalidate();
      this.clearChord(); // An independently active Pencil still owns its contact.
      return;
    }
    const first = this.first;
    if (
      first &&
      first.count === this.peak &&
      Math.hypot(first.x - this.anchor.x, first.y - this.anchor.y) <= 32
    ) {
      const action = this.peak === 2 ? "undo" : "redo";
      this.reset();
      this.invoke(action);
    } else {
      this.first = { count: this.peak, ...this.anchor, ended: pointer.timeStamp };
      this.clearChord();
    }
  }
  cancel(_pointer?: GesturePointer): void {
    this.reset();
  }
  reset(): void {
    this.invalidate();
    this.clearChord();
    this.pens.clear();
  }
  private clearChord(): void {
    this.contacts.clear();
    this.started = 0;
    this.valid = false;
    this.peak = 0;
    this.seen = 0;
    this.anchor = { x: 0, y: 0 };
  }
  private invalidate(): void {
    this.valid = false;
    this.first = null;
  }
  private centre(initial: boolean): { x: number; y: number } {
    const points = [...this.contacts.values()];
    return {
      x: points.reduce((sum, p) => sum + (initial ? p.startX : p.x), 0) / points.length,
      y: points.reduce((sum, p) => sum + (initial ? p.startY : p.y), 0) / points.length,
    };
  }
}
