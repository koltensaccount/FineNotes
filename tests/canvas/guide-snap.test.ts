import { describe, expect, it } from "vitest";
import { blankPage } from "../../src/model/document";
import { DEFAULT_WRITING_GUIDES, type WritingGuideStyle } from "../../src/model/writing-guides";
import { writingGuidePitch } from "../../src/canvas/writing-guides";
import {
  IMAGE_GUIDE_SNAP_PX,
  nearbyGuideLines,
  snapAxisToTargets,
  snapBoundsToRuledGuides,
} from "../../src/canvas/guide-snap";

const page = blankPage("p1", { width: 1024, height: 1448 });
const ruled = (overrides: Partial<WritingGuideStyle> = {}): WritingGuideStyle => ({
  ...DEFAULT_WRITING_GUIDES,
  style: "lines",
  spacing: 32,
  ...overrides,
});

describe("guide-snap", () => {
  it("snaps an image's top edge to a nearby visible ruled guide", () => {
    // Guide at y = 96 (3 * 32). Top edge at 92 is 4 page px away (< 8).
    const result = snapBoundsToRuledGuides(
      { minX: 120, minY: 92, maxX: 320, maxY: 205 },
      page,
      ruled(),
      IMAGE_GUIDE_SNAP_PX,
      1,
    );
    expect(result).toEqual({ dy: 4, guideY: 96, edge: "top" });
  });

  it("snaps an image's bottom edge when it is closer to a ruled guide than the top edge", () => {
    // Top at 110 (14px from 96/128), bottom at 222 (2px from 224 = 7 * 32).
    const result = snapBoundsToRuledGuides(
      { minX: 50, minY: 110, maxX: 250, maxY: 222 },
      page,
      ruled(),
      IMAGE_GUIDE_SNAP_PX,
      1,
    );
    expect(result).toEqual({ dy: 2, guideY: 224, edge: "bottom" });
  });

  it("lets the image pull away once both edges leave the capture range", () => {
    // Top at 106 (10px from 96), bottom at 212 (12px from 224) — outside 8px radius.
    const result = snapBoundsToRuledGuides(
      { minX: 50, minY: 106, maxX: 250, maxY: 212 },
      page,
      ruled(),
      IMAGE_GUIDE_SNAP_PX,
      1,
    );
    expect(result).toEqual({ dy: 0, guideY: null, edge: null });
  });

  it("keeps screen-space capture range consistent across zoom levels", () => {
    // At 2x zoom, 8 CSS px = 4 page px: 6 page px away should NOT snap.
    const zoomedInRadius = IMAGE_GUIDE_SNAP_PX / 2;
    const zoomedIn = snapBoundsToRuledGuides(
      { minX: 0, minY: 90, maxX: 100, maxY: 206 },
      page,
      ruled(),
      zoomedInRadius,
      2,
    );
    expect(zoomedIn.guideY).toBeNull();

    // At 0.5x zoom, 8 CSS px = 16 page px: 10 page px away (96 - 86) DOES snap.
    const zoomedOutRadius = IMAGE_GUIDE_SNAP_PX / 0.5;
    const zoomedOut = snapBoundsToRuledGuides(
      { minX: 0, minY: 86, maxX: 100, maxY: 206 },
      page,
      ruled(),
      zoomedOutRadius,
      0.5,
    );
    expect(zoomedOut).toEqual({ dy: 10, guideY: 96, edge: "top" });
  });

  it("does not snap when guides are hidden or not ruled lines", () => {
    const bounds = { minX: 0, minY: 95, maxX: 100, maxY: 200 };
    expect(snapBoundsToRuledGuides(bounds, page, null, 8, 1)).toEqual({
      dy: 0,
      guideY: null,
      edge: null,
    });
    expect(snapBoundsToRuledGuides(bounds, page, ruled({ style: "grid" }), 8, 1)).toEqual({
      dy: 0,
      guideY: null,
      edge: null,
    });
    expect(snapBoundsToRuledGuides(bounds, page, ruled({ style: "dots" }), 8, 1)).toEqual({
      dy: 0,
      guideY: null,
      edge: null,
    });
  });

  it("matches the strided guide pitch used by paintWritingGuides at tiny raster scales", () => {
    const style = ruled({ spacing: 16 });
    // At rasterScale = 0.05, spacing * rasterScale = 0.8 < 2 -> stride = 4 -> pitch = 64.
    expect(writingGuidePitch(style, 0.05)).toBe(64);
    // y = 32 is skipped at stride 4; y = 64 is rendered.
    const nearSkipped = snapBoundsToRuledGuides(
      { minX: 0, minY: 31, maxX: 100, maxY: 145 },
      page,
      style,
      8,
      0.05,
    );
    expect(nearSkipped.guideY).toBeNull();

    const nearRendered = snapBoundsToRuledGuides(
      { minX: 0, minY: 61, maxX: 100, maxY: 145 },
      page,
      style,
      8,
      0.05,
    );
    expect(nearRendered).toEqual({ dy: 3, guideY: 64, edge: "top" });
  });

  it("exposes reusable axis/edge snapping for future grid, object, or resize snapping", () => {
    const box = { minX: 98, minY: 10, maxX: 200, maxY: 110 };
    // Horizontal snapping (grid / object alignment)
    expect(snapAxisToTargets(box, "x", [100, 150], 5, ["start", "center", "end"])).toEqual({
      axis: "x",
      edge: "center",
      target: 150,
      delta: 1,
      distance: 1,
    });
    // Single-edge snapping (resize handle)
    expect(snapAxisToTargets(box, "x", [100, 150], 5, ["start"])).toEqual({
      axis: "x",
      edge: "start",
      target: 100,
      delta: 2,
      distance: 2,
    });
    expect(nearbyGuideLines(30, 95, 120, 32)).toEqual([0, 32, 64, 96]);
    expect(nearbyGuideLines(30, 95, 0, 32)).toEqual([]);
  });
});
