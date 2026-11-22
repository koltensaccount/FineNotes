import { describe, expect, it } from "vitest";
import { computeDockCandidate, type RectBox } from "../../src/view/bar-direct-gestures";

describe("direct toolbar drag-to-dock edge calculation", () => {
  const host: RectBox = { left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 };

  it("docks to left, right, or bottom when dragging from top", () => {
    expect(computeDockCandidate(420, 30, host, "top", 500, 30)).toBe("left");
    expect(computeDockCandidate(580, 30, host, "top", 500, 30)).toBe("right");
    expect(computeDockCandidate(500, 720, host, "top", 500, 30)).toBe("bottom");
  });

  it("docks to top, bottom, or right when dragging from left", () => {
    expect(computeDockCandidate(30, 340, host, "left", 30, 400)).toBe("top");
    expect(computeDockCandidate(30, 460, host, "left", 30, 400)).toBe("bottom");
    expect(computeDockCandidate(900, 400, host, "left", 30, 400)).toBe("right");
  });

  it("docks to top, left, or right when dragging from bottom", () => {
    expect(computeDockCandidate(500, 80, host, "bottom", 500, 770)).toBe("top");
    expect(computeDockCandidate(400, 770, host, "bottom", 500, 770)).toBe("left");
    expect(computeDockCandidate(600, 770, host, "bottom", 500, 770)).toBe("right");
  });

  it("docks to top, bottom, or left when dragging from right", () => {
    expect(computeDockCandidate(970, 320, host, "right", 970, 400)).toBe("top");
    expect(computeDockCandidate(970, 480, host, "right", 970, 400)).toBe("bottom");
    expect(computeDockCandidate(100, 400, host, "right", 970, 400)).toBe("left");
  });
});
