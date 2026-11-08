/**
 * A finger tap on a picture with a pen in hand picks the lasso and selects
 * the picture (`InkSurface.fingerPicksPicture`).
 */

import { describe, expect, it, vi } from "vitest";
import type { ActiveTool } from "../../src/view/toolbar";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { InkSurface } = await import("../../src/view/ink-surface");

type Fake = Record<string, unknown>;
const run = (obj: Fake, method: string, ...args: unknown[]): unknown =>
  (obj[method] as (...args: unknown[]) => unknown).apply(obj, args);

const picture = { id: "i1", path: "a.png", x: 100, y: 100, w: 200, h: 100 };

function surface(tool: ActiveTool, practice: object | null = null) {
  const s: Fake = Object.assign(Object.create(InkSurface.prototype), {
    toolState: { tool },
    practice,
    callbacks: { onToolChange: vi.fn() },
    setTool: vi.fn((next: ActiveTool) => {
      (s.toolState as { tool: ActiveTool }).tool = next;
    }),
    setImageSelection: vi.fn(),
  });
  return s;
}

describe("a finger tap on a picture", () => {
  it.each(["pen", "highlighter", "eraser", "shape"] as ActiveTool[])(
    "with the %s in hand picks the lasso and selects it",
    (tool) => {
      const s = surface(tool);
      const page = { id: "p1", images: [picture] };
      expect(run(s, "fingerPicksPicture", page, { x: 150, y: 150 })).toBe(true);
      expect(s.setTool).toHaveBeenCalledWith("select");
      expect(
        (s.callbacks as { onToolChange: ReturnType<typeof vi.fn> }).onToolChange,
      ).toHaveBeenCalledWith("select");
      expect(s.setImageSelection).toHaveBeenCalledWith("p1", picture);
    },
  );

  it("does nothing beside a picture, on a locked one, with the Text tool or in a practice file", () => {
    const page = { id: "p1", images: [picture] };
    const locked = { id: "p1", images: [{ ...picture, locked: true }] };
    const cases: Array<[Fake, object, { x: number; y: number }]> = [
      [surface("pen"), page, { x: 50, y: 50 }],
      [surface("pen"), locked, { x: 150, y: 150 }],
      [surface("text"), page, { x: 150, y: 150 }],
      [surface("pen", { device: "ipad" }), page, { x: 150, y: 150 }],
    ];
    for (const [s, p, at] of cases) {
      expect(run(s, "fingerPicksPicture", p, at)).toBe(false);
      expect(s.setTool).not.toHaveBeenCalled();
      expect(s.setImageSelection).not.toHaveBeenCalled();
    }
  });

  it("takes the topmost unlocked picture where two overlap", () => {
    const s = surface("pen");
    const top = { ...picture, id: "i2", x: 120 };
    const page = { id: "p1", images: [picture, top] };
    run(s, "fingerPicksPicture", page, { x: 150, y: 150 });
    expect(s.setImageSelection).toHaveBeenCalledWith("p1", top);
  });
});
