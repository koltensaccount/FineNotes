import { expect, it, vi } from "vitest";
import { Renderer } from "../../src/canvas/renderer";

it("uses the same pixel grid for live ink and the settled tile blit", () => {
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    screen: {dpr: 2}, view: {scale: 0.67, scrollY: 12.3}, originX: 13.25, level: 1.34,
  }) as any;
  const box = {x: 0, y: 100, width: 800, height: 1100};
  const ctx = {save: vi.fn(), setTransform: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn()};
  renderer.enterWetPage(ctx, box);
  expect(ctx.setTransform).toHaveBeenCalledWith(1.34, 0, 0, 1.34, 27, 118);
});

it("keeps current device resolution during an unsettled zoom", () => {
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    screen: {dpr: 2}, view: {scale: 1, scrollY: 0}, originX: 0.25, level: 1,
  }) as any;
  const ctx = {save: vi.fn(), setTransform: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn()};
  renderer.enterWetPage(ctx, {x: 0, y: 0, width: 800, height: 1100});
  expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0.5, 0);
});

it("settles stale tile resolution before committing a stroke", () => {
  const order: string[] = [];
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    layout: {boxes: [{id: "p1"}]}, settle: () => order.push("settle"),
    pathEntry: () => {order.push("outline"); return {runs: [], bounds: null};},
  }) as Renderer;
  renderer.appendCommittedStroke(0, {} as never, false);
  expect(order).toEqual(["settle", "outline"]);
});
