import { afterEach, describe, expect, it, vi } from "vitest";
import { bindColorStripInput } from "../../src/view/color-strip-input";
function setup() {
  const handlers = new Map<string, (e: never) => void>();
  const bind = (prefix: string) => ({
    addEventListener: (name: string, fn: (e: never) => void) => handlers.set(prefix + name, fn),
    removeEventListener: (name: string) => handlers.delete(prefix + name),
  });
  const doc = {
    ...bind("doc:"),
    visibilityState: "hidden",
    defaultView: { ...bind("win:"), setTimeout, clearTimeout },
  };
  const button = { ...bind(""), ownerDocument: doc };
  const strip = bind("strip:");
  const select = vi.fn(),
    context = vi.fn();
  const dispose = bindColorStripInput(
    button as unknown as HTMLElement,
    strip as unknown as HTMLElement,
    select,
    context,
  );
  const fire = (name: string, flags = {}) => {
    const e = {
      pointerType: "touch",
      pointerId: 1,
      button: 0,
      clientX: 0,
      clientY: 0,
      detail: 1,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
      stopPropagation: vi.fn(),
      ...flags,
    };
    handlers.get(name)?.(e as never);
    return e;
  };
  return { fire, select, context, dispose, handlers };
}
afterEach(() => vi.useRealTimers());
describe("quick strip input", () => {
  it("tap selects without blocking native pan", () => {
    const s = setup();
    expect(s.fire("pointerdown").preventDefault).not.toHaveBeenCalled();
    s.fire("pointerup");
    s.fire("click");
    expect(s.select).toHaveBeenCalledOnce();
  });
  it.each(["pointermove", "pointercancel", "strip:scroll"])(
    "%s prevents accidental selection",
    (name) => {
      const s = setup();
      s.fire("pointerdown");
      s.fire(name, { clientX: 20 });
      s.fire("pointerup");
      s.fire("click");
      expect(s.select).not.toHaveBeenCalled();
    },
  );
  it("touch hold opens actions, suppresses selection and preserves keyboard activation", () => {
    vi.useFakeTimers();
    const s = setup();
    s.fire("pointerdown");
    vi.advanceTimersByTime(450);
    expect(s.context).toHaveBeenCalledOnce();
    s.fire("click");
    expect(s.select).not.toHaveBeenCalled();
    s.fire("click", { detail: 0 });
    expect(s.select).toHaveBeenCalledOnce();
  });
  it("Pencil hold does not open actions; mouse right-click does", () => {
    vi.useFakeTimers();
    const s = setup();
    s.fire("pointerdown", { pointerType: "pen" });
    vi.advanceTimersByTime(600);
    expect(s.context).not.toHaveBeenCalled();
    s.fire("contextmenu", { pointerType: "mouse" });
    expect(s.context).toHaveBeenCalledOnce();
  });
  it("dispose cancels a pending hold and removes listeners", () => {
    vi.useFakeTimers();
    const s = setup();
    s.fire("pointerdown");
    s.dispose();
    vi.advanceTimersByTime(600);
    expect(s.context).not.toHaveBeenCalled();
    expect(s.handlers.size).toBe(0);
  });
});
