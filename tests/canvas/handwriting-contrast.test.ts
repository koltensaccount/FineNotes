import { describe, expect, it } from "vitest";
import { blankPage } from "../../src/model/document";
import { handwritingForBackground, handwritingInk } from "../../src/canvas/handwriting-contrast";

describe("embedded handwriting contrast", () => {
  it("switches neutral ink for the destination and preserves accent colors and alpha", () => {
    expect(handwritingInk("white", false)).toBe("#1a1a1a");
    expect(handwritingInk("#222", true)).toBe("#ffffff");
    expect(handwritingInk("#e63946", true)).toBe("#e63946");
    expect(handwritingInk("rgba(255, 255, 255, 0.5)", false)).toBe("rgba(26, 26, 26, 0.5)");
  });

  it("adapts a render copy of ink and text without changing the notebook or dark text fills", () => {
    const page = blankPage("block-test", { width: 800, height: 360 });
    page.strokes.push({ id: "ink", pts: [1, 1, 0.5], color: "#fff", size: 3, tool: "pen" });
    page.textBoxes.push(
      { id: "a", x: 10, y: 10, w: 80, text: "Note", color: "#fff", fontSize: 18 },
      { id: "b", x: 10, y: 40, w: 80, text: "Label", color: "#fff", fill: "#222", fontSize: 18 },
    );
    const printed = handwritingForBackground(page, false);
    expect(printed.strokes[0].color).toBe("#1a1a1a");
    expect(printed.textBoxes.map((box) => box.color)).toEqual(["#1a1a1a", "#fff"]);
    expect(page.strokes[0].color).toBe("#fff");
    expect(page.textBoxes[0].color).toBe("#fff");
  });
});
