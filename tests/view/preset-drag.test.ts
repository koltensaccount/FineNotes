import { afterEach, describe, expect, it, vi } from "vitest";
import { bindPresetDrag } from "../../src/view/preset-drag";
function setup() {
  const handlers = new Map<string, (event: never) => void>();
  const captures = new Set<number>();
  const classes = new Set<string>();
  const parent = {
    querySelectorAll: () => [],
    scrollTop: 0,
    getBoundingClientRect: () => ({ top: 0, bottom: 300 }),
  };
  const hit = { parentElement: parent, dataset: { presetIndex: "2" }, addClass: vi.fn() };
  const handle = {
    addEventListener: (name: string, fn: (event: never) => void) => handlers.set(name, fn),
    removeEventListener: (name: string) => handlers.delete(name),
    setPointerCapture: (id: number) => captures.add(id),
    hasPointerCapture: (id: number) => captures.has(id),
    releasePointerCapture: (id: number) => {
      captures.delete(id);
      handlers.get("lostpointercapture")?.({} as never);
    },
  };
  const row = {
    parentElement: parent,
    addClass: (s: string) => classes.add(s),
    removeClass: (s: string) => classes.delete(s),
    ownerDocument: {
      defaultView: { setTimeout, clearTimeout },
      elementFromPoint: () => ({ closest: () => hit }),
    },
  };
  const drop = vi.fn();
  const dragging = vi.fn();
  const bind = () =>
    bindPresetDrag(
      handle as unknown as HTMLElement,
      row as unknown as HTMLElement,
      0,
      drop,
      dragging,
    );
  const dispose = bind();
  const fire = (name: string, flags = {}) => {
    const e = {
      pointerId: 1,
      button: 0,
      clientX: 50,
      clientY: 100,
      pointerType: "mouse",
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      ...flags,
    };
    handlers.get(name)?.(e as never);
    return e;
  };
  return { handlers, captures, classes, drop, dragging, dispose, fire, bind };
}
afterEach(() => vi.useRealTimers());
describe("preset pointer reorder", () => {
  it("captures mouse drag, blocks drawing and selection, and commits exactly once", () => {
    const s = setup();
    for (const name of ["pointerdown", "pointermove", "pointerup", "click"]) {
      const e = s.fire(name);
      expect(e.preventDefault).toHaveBeenCalledOnce();
      expect(e.stopPropagation).toHaveBeenCalledOnce();
    }
    expect(s.drop).toHaveBeenCalledExactlyOnceWith(0, 2);
    expect(s.captures.size).toBe(0);
    expect(s.classes.size).toBe(0);
  });
  it("requires a stationary touch long press", () => {
    vi.useFakeTimers();
    const s = setup();
    s.fire("pointerdown", { pointerType: "touch" });
    vi.advanceTimersByTime(349);
    expect(s.dragging).not.toHaveBeenCalledWith(true);
    vi.advanceTimersByTime(1);
    expect(s.dragging).toHaveBeenCalledWith(true);
    s.fire("pointermove");
    s.fire("pointerup");
    expect(s.drop).toHaveBeenCalledExactlyOnceWith(0, 2);
  });
  it("cancels a moving finger before the long press", () => {
    vi.useFakeTimers();
    const s = setup();
    s.fire("pointerdown", { pointerType: "touch" });
    s.fire("pointermove", { clientY: 150 });
    vi.advanceTimersByTime(500);
    s.fire("pointerup");
    expect(s.drop).not.toHaveBeenCalled();
    expect(s.dragging).not.toHaveBeenCalledWith(true);
  });
  it.each(["pointercancel", "lostpointercapture"])("cancels on %s", (name) => {
    const s = setup();
    s.fire("pointerdown");
    s.fire("pointermove");
    s.fire(name);
    s.fire("pointerup");
    expect(s.drop).not.toHaveBeenCalled();
  });
  it("ignores another pointer and supports keyboard movement", () => {
    const s = setup();
    s.fire("pointerdown");
    s.fire("pointerup", { pointerId: 2 });
    expect(s.drop).not.toHaveBeenCalled();
    s.fire("pointercancel");
    s.fire("keydown", { key: "ArrowDown" });
    expect(s.drop).toHaveBeenCalledExactlyOnceWith(0, 1);
  });
  it("dispose/reinitialize leaves one listener set and no pending long press", () => {
    vi.useFakeTimers();
    const s = setup();
    s.fire("pointerdown", { pointerType: "touch" });
    s.dispose();
    expect(s.handlers.size).toBe(0);
    expect(s.captures.size).toBe(0);
    vi.advanceTimersByTime(500);
    expect(s.dragging).not.toHaveBeenCalledWith(true);
    const dispose = s.bind();
    expect(s.handlers.size).toBe(7);
    s.fire("keydown", { key: "ArrowDown" });
    expect(s.drop).toHaveBeenCalledOnce();
    dispose();
    expect(s.handlers.size).toBe(0);
  });
});
