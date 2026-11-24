import { describe, expect, it } from "vitest";
import {
  INLINE_DEFAULT_HEIGHT,
  INLINE_GROW_STEP,
  INLINE_MAX_HEIGHT,
  INLINE_MIN_HEIGHT,
  createInlineSketchPage,
  findLinkedNotebookInMarkdown,
  inlineClampedResizeHeight,
  inlineGrowHeight,
  inlineTrimHeight,
  isInlineSketchPage,
  lowestInlineContentY,
} from "../../src/model/inline-sketch";
import { embedPageLink, embedTarget, pageIndexById } from "../../src/view/page-embed-model";

describe("inline-sketch pure model", () => {
  it("creates transparent expandable sketch pages identified by hw- prefix", () => {
    const page = createInlineSketchPage("hw-a1b2c3d4");
    expect(isInlineSketchPage(page)).toBe(true);
    expect(page.geometry).toEqual({ width: 1024, height: INLINE_DEFAULT_HEIGHT });
    expect(page.backdrop).toEqual({ kind: "blank", paperColor: "transparent" });

    const paper = createInlineSketchPage("hw-paper", { transparent: false });
    expect(paper.backdrop).toEqual({ kind: "blank" });
  });

  it("grows smoothly on pen-up near the bottom without shrinking while writing", () => {
    const page = createInlineSketchPage("hw-1");
    expect(inlineGrowHeight(page)).toBe(INLINE_DEFAULT_HEIGHT);

    page.strokes.push({
      id: "s1",
      tool: "pen",
      color: "#000",
      size: 4,
      pts: [100, 210, 0.5, 200, 220, 0.5],
    });
    expect(lowestInlineContentY(page)).toBe(222);
    expect(inlineGrowHeight(page)).toBe(INLINE_DEFAULT_HEIGHT + INLINE_GROW_STEP);
  });

  it("trims excess bottom whitespace on finish while respecting manual height and min floor", () => {
    const page = createInlineSketchPage("hw-2", { height: 600 });
    expect(inlineTrimHeight(page)).toBe(INLINE_DEFAULT_HEIGHT);

    page.strokes.push({
      id: "s1",
      tool: "pen",
      color: "#000",
      size: 4,
      pts: [50, 140, 0.5],
    });
    expect(inlineTrimHeight(page)).toBe(142 + 28);
    expect(inlineTrimHeight(page, 400)).toBe(400);
    expect(inlineTrimHeight(page, 100)).toBe(170);
  });

  it("clamps manual bottom resize so content is never clipped", () => {
    const page = createInlineSketchPage("hw-3");
    page.strokes.push({
      id: "s1",
      tool: "pen",
      color: "#000",
      size: 4,
      pts: [50, 200, 0.5],
    });
    expect(inlineClampedResizeHeight(page, 50)).toBe(214);
    expect(inlineClampedResizeHeight(page, 500)).toBe(500);
    expect(inlineClampedResizeHeight(page, 99999)).toBe(INLINE_MAX_HEIGHT);

    const empty = createInlineSketchPage("hw-4");
    expect(inlineClampedResizeHeight(empty, 40)).toBe(INLINE_MIN_HEIGHT);
  });

  it("finds existing linked backing notebook from Markdown embeds", () => {
    const md = "Some text\n\n![[School/Lecture 5.notebook#id=hw-8f2a1c09]]\n\nMore text";
    expect(findLinkedNotebookInMarkdown(md)).toBe("School/Lecture 5.notebook");
    expect(findLinkedNotebookInMarkdown("![[Lecture 5.notebook#page=2]]")).toBeNull();
    expect(findLinkedNotebookInMarkdown("Just text")).toBeNull();
  });

  it("parses and resolves #id=<pageId> embed targets", () => {
    const target = embedTarget("#id=hw-a1b2c3d4");
    expect(target).toEqual({ page: 1, whole: false, pageId: "hw-a1b2c3d4" });
    expect(embedPageLink("Lecture 5.notebook#id=hw-a1b2c3d4", target!, 3)).toBe(
      "Lecture 5.notebook#page=3",
    );
    const pages = [{ id: "p1" }, { id: "hw-a1b2c3d4" }, { id: "p3" }];
    expect(pageIndexById(pages, "hw-a1b2c3d4")).toBe(1);
    expect(pageIndexById(pages, "missing")).toBe(-1);
  });
});
