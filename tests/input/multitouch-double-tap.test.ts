import { describe, expect, it, vi } from "vitest";
import { MultiTouchDoubleTap, type GesturePointer } from "../../src/input/multitouch-double-tap";
import { FingerGesture } from "../../src/input/finger-gesture";
function rig() {
  const invoke = vi.fn();
  const gesture = new MultiTouchDoubleTap(invoke);
  const pointer = (
    id: number,
    t: number,
    x = id * 30,
    y = 100,
    type = "touch",
  ): GesturePointer => ({ pointerId: id, pointerType: type, clientX: x, clientY: y, timeStamp: t });
  const tap = (n: number, start: number, offset = 0) => {
    for (let i = 1; i <= n; i++) gesture.down(pointer(i, start + i * 5, i * 30 + offset));
    for (let i = 1; i <= n; i++) gesture.up(pointer(i, start + 60 + i * 5, i * 30 + offset));
  };
  return { invoke, gesture, pointer, tap };
}
describe("touch chord double taps", () => {
  it.each([
    [2, "undo"],
    [3, "redo"],
  ] as const)("%s fingers invoke exactly one %s", (count, action) => {
    const r = rig();
    r.tap(count, 0);
    expect(r.invoke).not.toHaveBeenCalled();
    r.tap(count, 150);
    expect(r.invoke).toHaveBeenCalledExactlyOnceWith(action);
  });
  it.each([1, 4])("%s fingers never invoke history", (count) => {
    const r = rig();
    r.tap(count, 0);
    r.tap(count, 150);
    expect(r.invoke).not.toHaveBeenCalled();
  });
  it("requires the same finger count in both taps", () => {
    const r = rig();
    r.tap(2, 0);
    r.tap(3, 150);
    expect(r.invoke).not.toHaveBeenCalled();
  });
  it("expires the first tap and accepts a fresh pair afterward", () => {
    const r = rig();
    r.tap(2, 0);
    r.tap(2, 500);
    expect(r.invoke).not.toHaveBeenCalled();
    r.tap(2, 650);
    expect(r.invoke).toHaveBeenCalledExactlyOnceWith("undo");
  });
  it("rejects spatially unrelated taps", () => {
    const r = rig();
    r.tap(2, 0);
    r.tap(2, 150, 100);
    expect(r.invoke).not.toHaveBeenCalled();
  });
  it("rejects a long chord", () => {
    const r = rig();
    r.tap(2, 0);
    r.gesture.down(r.pointer(1, 150));
    r.gesture.down(r.pointer(2, 155));
    r.gesture.up(r.pointer(1, 400));
    r.gesture.up(r.pointer(2, 405));
    expect(r.invoke).not.toHaveBeenCalled();
  });
  it("rejects fingers assembled too slowly", () => {
    const r = rig();
    r.tap(2, 0);
    r.gesture.down(r.pointer(1, 150));
    r.gesture.down(r.pointer(2, 250));
    r.gesture.up(r.pointer(1, 270));
    r.gesture.up(r.pointer(2, 275));
    expect(r.invoke).not.toHaveBeenCalled();
  });
  it("all fingers must belong to one overlapping chord", () => {
    const r = rig();
    r.tap(3, 0);
    r.gesture.down(r.pointer(1, 150));
    r.gesture.down(r.pointer(2, 155));
    r.gesture.up(r.pointer(1, 160));
    r.gesture.down(r.pointer(3, 165));
    r.gesture.up(r.pointer(2, 170));
    r.gesture.up(r.pointer(3, 175));
    expect(r.invoke).not.toHaveBeenCalled();
  });
  it("cancels excessive movement including an up without a move event", () => {
    for (const phase of ["move", "up"] as const) {
      const r = rig();
      r.tap(2, 0);
      r.gesture.down(r.pointer(1, 150));
      r.gesture.down(r.pointer(2, 155));
      r.gesture[phase](r.pointer(1, 160, 60));
      r.gesture.up(r.pointer(1, 170, 60));
      r.gesture.up(r.pointer(2, 175));
      expect(r.invoke).not.toHaveBeenCalled();
    }
  });
  it("cancels a small pinch even if both contacts stay within per-finger slop", () => {
    const r = rig();
    r.tap(2, 0);
    r.gesture.down(r.pointer(1, 150));
    r.gesture.down(r.pointer(2, 155));
    r.gesture.move(r.pointer(1, 160, 27));
    r.gesture.move(r.pointer(2, 165, 63));
    r.gesture.up(r.pointer(1, 170, 27));
    r.gesture.up(r.pointer(2, 175, 63));
    expect(r.invoke).not.toHaveBeenCalled();
  });
  it("cancels a page pan", () => {
    const r = rig();
    r.tap(2, 0);
    r.gesture.down(r.pointer(1, 150));
    r.gesture.down(r.pointer(2, 155));
    r.gesture.move(r.pointer(1, 160, 37));
    r.gesture.move(r.pointer(2, 165, 67));
    r.gesture.up(r.pointer(1, 170, 37));
    r.gesture.up(r.pointer(2, 175, 67));
    expect(r.invoke).not.toHaveBeenCalled();
  });
  it("tolerates tiny natural jitter", () => {
    const r = rig();
    r.tap(2, 0);
    r.gesture.down(r.pointer(1, 150));
    r.gesture.down(r.pointer(2, 155));
    r.gesture.move(r.pointer(1, 160, 31));
    r.gesture.up(r.pointer(1, 170, 31));
    r.gesture.up(r.pointer(2, 175));
    expect(r.invoke).toHaveBeenCalledExactlyOnceWith("undo");
  });
  it("pointercancel invalidates the full double-tap sequence", () => {
    const r = rig();
    r.tap(2, 0);
    r.gesture.down(r.pointer(1, 150));
    r.gesture.down(r.pointer(2, 155));
    r.gesture.cancel(r.pointer(1, 160));
    r.gesture.up(r.pointer(2, 170));
    r.tap(2, 220);
    expect(r.invoke).not.toHaveBeenCalled();
  });
  it("Pencil plus two fingers never counts the pen or undoes active writing", () => {
    const r = rig();
    r.gesture.down(r.pointer(9, 0, 0, 0, "pen"));
    r.tap(2, 10);
    r.tap(2, 150);
    expect(r.invoke).not.toHaveBeenCalled();
    r.gesture.up(r.pointer(9, 250, 0, 0, "pen"));
    r.tap(2, 300);
    r.tap(2, 450);
    expect(r.invoke).toHaveBeenCalledExactlyOnceWith("undo");
  });
  it.each([2, 3])(
    "supports repeated %s-finger gestures without overlapping duplicate commands",
    (n) => {
      const r = rig();
      for (let i = 0; i < 6; i++) r.tap(n, i * 150);
      expect(r.invoke).toHaveBeenCalledTimes(3);
    },
  );
  it("duplicate ups cannot invoke twice", () => {
    const r = rig();
    r.tap(2, 0);
    r.tap(2, 150);
    r.gesture.up(r.pointer(2, 230));
    expect(r.invoke).toHaveBeenCalledOnce();
  });
  it("outside/controls contacts and mouse input invalidate a pending sequence", () => {
    const r = rig();
    r.tap(2, 0);
    r.gesture.down(r.pointer(1, 150), false);
    r.gesture.down(r.pointer(2, 155), false);
    r.gesture.up(r.pointer(1, 170));
    r.gesture.up(r.pointer(2, 175));
    expect(r.invoke).not.toHaveBeenCalled();
    r.tap(2, 220);
    r.gesture.down(r.pointer(9, 300, 0, 0, "mouse"));
    r.tap(2, 370);
    expect(r.invoke).not.toHaveBeenCalled();
  });
  it("reset drops old contacts and pending taps on document replacement/disposal", () => {
    const r = rig();
    r.tap(2, 0);
    r.gesture.reset();
    r.tap(2, 150);
    expect(r.invoke).not.toHaveBeenCalled();
  });
  it("observing the same events leaves the existing pan/pinch model operating normally", () => {
    const r = rig(),
      pan = vi.fn(),
      pinch = vi.fn();
    const fingers = new FingerGesture({
      onPanStart: vi.fn(),
      onPanMove: pan,
      onPanEnd: vi.fn(),
      onPinchStart: vi.fn(),
      onPinch: pinch,
      onPinchEnd: vi.fn(),
    });
    r.gesture.down(r.pointer(1, 0));
    fingers.down(1, 30, 100, 0);
    r.gesture.move(r.pointer(1, 20, 60));
    fingers.move(1, 60, 100, 20);
    expect(pan).toHaveBeenCalled();
    r.gesture.down(r.pointer(2, 30));
    fingers.down(2, 90, 100, 30);
    r.gesture.move(r.pointer(2, 40, 130));
    fingers.move(2, 130, 100, 40);
    expect(pinch).toHaveBeenCalled();
    r.gesture.up(r.pointer(1, 50, 60));
    fingers.lift(1, 50);
    r.gesture.up(r.pointer(2, 60, 130));
    fingers.lift(2, 60);
    expect(r.invoke).not.toHaveBeenCalled();
    expect(fingers.active).toBe(false);
  });
});
