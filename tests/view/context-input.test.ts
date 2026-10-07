import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindContextInput, bindPressDismissal } from "../../src/view/context-input";
class Surface extends EventTarget {
  setTimeout = globalThis.setTimeout;
  clearTimeout = globalThis.clearTimeout;
  ownerDocument!: Surface & { defaultView: Surface; visibilityState: string };
  closest(): null {
    return null;
  }
  contains(target: unknown): boolean {
    return target === this;
  }
}
function send(el: EventTarget, type: string, values: Record<string, unknown> = {}) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(
    event,
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])),
  );
  el.dispatchEvent(event);
  return event;
}
let cleanup: () => void;
function setup() {
  const el = new Surface();
  const doc = new Surface() as Surface & { defaultView: Surface; visibilityState: string };
  doc.defaultView = new Surface();
  doc.visibilityState = "visible";
  el.ownerDocument = doc;
  const open = vi.fn();
  const remember = vi.fn();
  let blocked = false;
  cleanup = bindContextInput(el as unknown as HTMLElement, {
    open,
    remember,
    blocked: () => blocked,
  });
  const pointer = (type: string, pointerType = "touch", pointerId = 1, x = 50, y = 70) =>
    send(doc, type, { target: el, pointerType, pointerId, clientX: x, clientY: y });
  return {
    el,
    doc,
    open,
    remember,
    pointer,
    block: () => {
      blocked = true;
    },
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Element", Surface);
});
afterEach(() => {
  cleanup?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("context input modality and lifetime", () => {
  it("opens once after a stationary finger hold, without preventing ordinary pointer input", () => {
    const s = setup();
    expect(s.pointer("pointerdown").defaultPrevented).toBe(false);
    vi.advanceTimersByTime(499);
    expect(s.open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(s.open).toHaveBeenCalledExactlyOnceWith(50, 70);
    vi.advanceTimersByTime(1000);
    s.pointer("pointerup");
    expect(s.open).toHaveBeenCalledOnce();
    expect(s.remember).toHaveBeenCalledWith(50, 70);
  });
  it.each(["pen", "mouse"])("does not open a hold for %s", (type) => {
    const s = setup();
    s.pointer("pointerdown", type);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(s.open).not.toHaveBeenCalled();
  });
  it.each(["pointerup", "pointercancel"])("cancels on %s", (phase) => {
    const s = setup();
    s.pointer("pointerdown");
    s.pointer(phase);
    vi.advanceTimersByTime(1000);
    expect(s.open).not.toHaveBeenCalled();
  });
  it("cancels real movement and does not rearm when the finger stops", () => {
    const s = setup();
    s.pointer("pointerdown");
    s.pointer("pointermove", "touch", 1, 59);
    s.pointer("pointermove");
    vi.advanceTimersByTime(1000);
    expect(s.open).not.toHaveBeenCalled();
  });
  it("allows tiny jitter", () => {
    const s = setup();
    s.pointer("pointerdown");
    s.pointer("pointermove", "touch", 1, 52);
    vi.advanceTimersByTime(500);
    expect(s.open).toHaveBeenCalledOnce();
  });
  it("cancels on a second finger anywhere and never rearms after pinch", () => {
    const s = setup();
    s.pointer("pointerdown");
    send(s.doc, "pointerdown", { pointerType: "touch", pointerId: 2 });
    s.pointer("pointerup", "touch", 2);
    vi.advanceTimersByTime(1000);
    expect(s.open).not.toHaveBeenCalled();
  });
  it("a landing pen cancels the hold and its context event never opens the menu", () => {
    const s = setup();
    s.pointer("pointerdown");
    s.pointer("pointerdown", "pen", 2);
    vi.advanceTimersByTime(1000);
    expect(send(s.el, "contextmenu", { pointerType: "pen" }).defaultPrevented).toBe(false);
    expect(s.open).not.toHaveBeenCalled();
  });
  it("opens right-click at the mouse point", () => {
    const s = setup();
    s.pointer("pointerdown", "mouse");
    expect(
      send(s.el, "contextmenu", { pointerType: "mouse", clientX: 80, clientY: 90 })
        .defaultPrevented,
    ).toBe(true);
    expect(s.open).toHaveBeenCalledWith(80, 90);
  });
  it("checks a newly active drawing/crop blocker before firing", () => {
    const s = setup();
    s.pointer("pointerdown");
    s.block();
    vi.advanceTimersByTime(500);
    expect(s.open).not.toHaveBeenCalled();
  });
  it.each(["blur", "hide", "dispose"])("cancels pending work on %s", (reason) => {
    const s = setup();
    s.pointer("pointerdown");
    if (reason === "blur") send(s.doc.defaultView, "blur");
    if (reason === "hide") {
      s.doc.visibilityState = "hidden";
      send(s.doc, "visibilitychange");
    }
    if (reason === "dispose") cleanup();
    vi.advanceTimersByTime(1000);
    expect(s.open).not.toHaveBeenCalled();
  });
  it("detach/rebind leaves only one recognizer", () => {
    const s = setup();
    cleanup();
    cleanup = bindContextInput(s.el as unknown as HTMLElement, {
      blocked: () => false,
      remember: s.remember,
      open: s.open,
    });
    s.pointer("pointerdown");
    vi.advanceTimersByTime(500);
    expect(s.open).toHaveBeenCalledOnce();
  });
});

describe("transient Paste bar dismissal", () => {
  it.each(["touch", "pen", "mouse"])(
    "outside %s down dismisses without preventing the underlying action",
    (pointerType) => {
      const s = setup();
      let opened = true;
      const dismiss = vi.fn(() => {
        opened = false;
      });
      const dispose = bindPressDismissal(s.el as unknown as HTMLElement, () => opened, dismiss);
      const inside = send(s.doc, "pointerdown", { composedPath: () => [s.el], pointerType });
      expect(dismiss).not.toHaveBeenCalled();
      expect(inside.defaultPrevented).toBe(false);
      const outside = send(s.doc, "pointerdown", { composedPath: () => [], pointerType });
      expect(dismiss).toHaveBeenCalledOnce();
      expect(outside.defaultPrevented).toBe(false);
      opened = true;
      dispose();
      send(s.doc, "pointerdown", { composedPath: () => [], pointerType });
      expect(dismiss).toHaveBeenCalledOnce();
    },
  );
  it("Escape and keyboard popup activation dismiss, but the hold release click does not", () => {
    const s = setup();
    const dismiss = vi.fn();
    const dispose = bindPressDismissal(s.el as unknown as HTMLElement, () => true, dismiss);
    send(s.doc, "click", { detail: 1, composedPath: () => [] });
    expect(dismiss).not.toHaveBeenCalled();
    send(s.doc, "click", { detail: 0, composedPath: () => [] });
    send(s.doc, "keydown", { key: "Escape" });
    expect(dismiss).toHaveBeenCalledTimes(2);
    dispose();
  });
});
