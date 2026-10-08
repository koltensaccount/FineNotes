import { describe, expect, it, vi } from "vitest";
import { AnchoredNativeMenus, claimTransient, dismissTransient } from "../../src/view/transient-popover";

class Events {
  listeners = new Map<string, Set<(event: unknown) => void>>();
  addEventListener(type: string, callback: (event: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(callback);
  }
  removeEventListener(type: string, callback: (event: unknown) => void) { this.listeners.get(type)?.delete(callback); }
  fire(type: string, target: unknown = null) { for (const callback of this.listeners.get(type) ?? []) callback({ target }); }
}
class NativeMenu {
  hidden = false;
  callbacks: Array<() => void> = [];
  onHide(callback: () => void) { this.callbacks.push(callback); }
  hide() { if (!this.hidden) { this.hidden = true; for (const callback of this.callbacks) callback(); } }
}
function fixture() {
  const events = new Events();
  const doc = { defaultView: events } as unknown as Document;
  const anchor = { contains: (node: unknown) => node === anchor } as unknown as HTMLElement;
  return { events, doc, anchor, owner: new AnchoredNativeMenus<NativeMenu>(doc) };
}
describe("anchored native menu coordination", () => {
  it("toggles an open anchor and suppresses reopening after native pointerdown dismissal", () => {
    const { events, anchor, owner } = fixture();
    const create = vi.fn(() => new NativeMenu());
    const menu = owner.open(anchor, create)!;
    events.fire("pointerdown", anchor); menu.hide(); // native document dismissal runs after window capture
    expect(owner.open(anchor, create)).toBeNull(); expect(create).toHaveBeenCalledOnce();
    events.fire("pointerdown", anchor);
    expect(owner.open(anchor, create)).not.toBeNull();
    expect(owner.open(anchor, create)).toBeNull();
    owner.destroy();
  });
  it("native outside/Escape/item dismissal clears state without replacing native handlers", () => {
    const { events, anchor, owner } = fixture();
    for (const reason of ["outside", "escape", "item"]) {
      const menu = owner.open(anchor, () => new NativeMenu())!;
      if (reason === "outside") events.fire("pointerdown", {});
      if (reason === "escape") events.fire("keydown");
      menu.hide();
      expect(owner.open(anchor, () => new NativeMenu())).not.toBeNull();
      owner.close();
    }
    owner.destroy();
  });
  it("different anchors replace the menu and coordinate with custom transients both ways", () => {
    const { events, anchor, doc, owner } = fixture();
    const other = { contains: (node: unknown) => node === other } as unknown as HTMLElement;
    const first = owner.open(anchor, () => new NativeMenu())!;
    events.fire("pointerdown", other);
    const second = owner.open(other, () => new NativeMenu())!;
    expect(first.hidden).toBe(true);
    const close = vi.fn();
    const release = claimTransient(doc, {}, close);
    expect(second.hidden).toBe(true);
    owner.open(anchor, () => new NativeMenu()); expect(close).toHaveBeenCalledOnce();
    release(); dismissTransient(doc);
    expect(owner.open(anchor, () => new NativeMenu())).not.toBeNull();
    owner.destroy();
  });
  it("cancellation and keyboard activation do not retain a cancelled pointer toggle", () => {
    const { events, anchor, owner } = fixture();
    for (const reset of ["pointercancel", "keydown"]) {
      const menu = owner.open(anchor, () => new NativeMenu())!;
      events.fire("pointerdown", anchor); menu.hide(); events.fire(reset);
      expect(owner.open(anchor, () => new NativeMenu())).not.toBeNull(); owner.close();
    }
    owner.destroy();
  });
  it("teardown closes the menu and removes every anchor-tracking listener", () => {
    const { events, anchor, doc, owner } = fixture();
    const menu = owner.open(anchor, () => new NativeMenu())!;
    owner.destroy(); expect(menu.hidden).toBe(true);
    expect([...events.listeners.values()].every(set => set.size === 0)).toBe(true);
    const close = vi.fn(); claimTransient(doc, {}, close); expect(menu.callbacks).toHaveLength(1);
    dismissTransient(doc); expect(close).toHaveBeenCalledOnce();
  });
});
