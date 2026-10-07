import { afterEach, describe, expect, it, vi } from "vitest";
import { bindMultiTouchInput } from "../../src/view/multitouch-input";
class El extends EventTarget {
  control = false;
  inside = true;
  ownerDocument!: El & { defaultView: El; visibilityState: string };
  closest(): El | null {
    return this.control ? this : null;
  }
  contains(target: unknown): boolean {
    return target instanceof El && target.inside;
  }
}
function rig() {
  vi.stubGlobal("Element", El);
  const el = new El(),
    doc = new El() as El & { defaultView: El; visibilityState: string };
  doc.defaultView = new El();
  doc.visibilityState = "visible";
  el.ownerDocument = doc;
  const undo = vi.fn(),
    redo = vi.fn();
  let blocked = false;
  let binding = bindMultiTouchInput(el as unknown as HTMLElement, {
    undo,
    redo,
    blocked: () => blocked,
  });
  const send = (
    phase: string,
    id: number,
    t: number,
    target: El = el,
    type = "touch",
    x = id * 30,
  ) => {
    const event = new Event(phase, { cancelable: true });
    for (const [key, value] of Object.entries({
      target,
      pointerId: id,
      pointerType: type,
      timeStamp: t,
      clientX: x,
      clientY: 100,
    }))
      Object.defineProperty(event, key, { value });
    doc.dispatchEvent(event);
    return event;
  };
  const tap = (n: number, start: number, target: El = el) => {
    for (let i = 1; i <= n; i++)
      expect(send("pointerdown", i, start + i * 5, target).defaultPrevented).toBe(false);
    for (let i = 1; i <= n; i++) send("pointerup", i, start + 60 + i * 5, target);
  };
  return {
    el,
    doc,
    undo,
    redo,
    send,
    tap,
    block: () => {
      blocked = true;
    },
    dispose: () => binding.dispose(),
    reset: () => binding.reset(),
    rebind: () => {
      binding.dispose();
      binding = bindMultiTouchInput(el as unknown as HTMLElement, {
        undo,
        redo,
        blocked: () => blocked,
      });
    },
  };
}
afterEach(() => vi.unstubAllGlobals());
describe("multitouch page adapter", () => {
  it("invokes the existing host undo/redo callbacks without preventing pointers", () => {
    const r = rig();
    r.tap(2, 0);
    r.tap(2, 150);
    r.tap(3, 300);
    r.tap(3, 450);
    expect(r.undo).toHaveBeenCalledOnce();
    expect(r.redo).toHaveBeenCalledOnce();
    r.dispose();
  });
  it.each(["control", "outside"])(
    "does not fire inside %s and drops a pending paper tap",
    (kind) => {
      const r = rig(),
        target = new El();
      target.control = kind === "control";
      target.inside = kind !== "outside";
      r.tap(2, 0);
      r.tap(2, 150, target);
      r.tap(2, 300);
      expect(r.undo).not.toHaveBeenCalled();
      r.dispose();
    },
  );
  it("does not fire while the page reports active pen/selection/crop work", () => {
    const r = rig();
    r.tap(2, 0);
    r.block();
    r.tap(2, 150);
    expect(r.undo).not.toHaveBeenCalled();
    r.dispose();
  });
  it("ignores Pencil chords and click compatibility events", () => {
    const r = rig();
    r.send("pointerdown", 9, 0, r.el, "pen");
    r.tap(2, 10);
    r.tap(2, 150);
    r.doc.dispatchEvent(new Event("click"));
    expect(r.undo).not.toHaveBeenCalled();
    r.dispose();
  });
  it("pointercancel, reset and a hidden document cannot bridge two taps", () => {
    for (const reason of ["cancel", "reset", "hide", "blur"]) {
      const r = rig();
      r.tap(2, 0);
      if (reason === "cancel") r.send("pointercancel", 1, 100);
      if (reason === "reset") r.reset();
      if (reason === "hide") {
        r.doc.visibilityState = "hidden";
        r.doc.dispatchEvent(new Event("visibilitychange"));
      }
      if (reason === "blur") r.doc.defaultView.dispatchEvent(new Event("blur"));
      r.tap(2, 150);
      expect(r.undo).not.toHaveBeenCalled();
      r.dispose();
    }
  });
  it("repeated initialization leaves one listener and disposal removes pending state", () => {
    const r = rig();
    r.tap(2, 0);
    r.rebind();
    r.tap(2, 150);
    expect(r.undo).not.toHaveBeenCalled();
    r.tap(2, 300);
    expect(r.undo).toHaveBeenCalledOnce();
    r.dispose();
    r.tap(2, 450);
    r.tap(2, 600);
    expect(r.undo).toHaveBeenCalledOnce();
  });
});
