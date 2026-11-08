import { expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));
const { InkSurface } = await import("../../src/view/ink-surface");

it("shows a table draft only after a drag and still places a default table on tap", () => {
  const box = { index: 0, width: 800, height: 1000 };
  const page = { id: "page" };
  const origin = { x: 40, y: 40 };
  const drag = { preset: "table", origin, to: origin, moved: false };
  const renderer = { renderWetMany: vi.fn(), clearWet: vi.fn() };
  const commitTable = vi.fn();
  const surface = Object.assign(Object.create(InkSurface.prototype), {
    shapeDrag: drag,
    toolState: { tableSize: { rows: 2, cols: 4 } },
    renderer,
    commitTable,
    pageAt: () => page,
    isPaperDark: () => false,
    atFitZoom: (size: number) => size,
    tableStyle: () => ({ color: "#000", size: 1.5 }),
  });

  surface.showShapeDraft(box);
  expect(renderer.renderWetMany).not.toHaveBeenCalled();
  surface.finishShapeDrag(box);
  expect(commitTable).toHaveBeenCalledWith(box, page, expect.arrayContaining([
    expect.objectContaining({ shape: "rect", pts: expect.arrayContaining([520, 152]) }),
  ]));

  surface.shapeDrag = { ...drag, moved: true, to: { x: 260, y: 160 } };
  surface.showShapeDraft(box);
  const [pageIndex, preview] = renderer.renderWetMany.mock.lastCall!;
  expect(pageIndex).toBe(box.index);
  expect(preview).toHaveLength(5);
  surface.finishShapeDrag(box);
  const committed = commitTable.mock.lastCall![2];
  expect(committed.map((stroke: { pts: number[] }) => stroke.pts)).toEqual(preview);
});
