import { describe, expect, it, vi } from "vitest";
import { blankPage, type ImageElement, type InkDocument } from "../../src/model/document";
import { History } from "../../src/model/history";
import { DEFAULT_WRITING_GUIDES } from "../../src/model/writing-guides";
import { InkSurface } from "../../src/view/ink-surface";
import { Toolbar } from "../../src/view/toolbar";

vi.mock("obsidian", () => import("./fake-obsidian"));

class FakeEl {
  children: FakeEl[] = [];
  attrs: Record<string, string> = {};
  classes = new Set<string>();
  style: Record<string, string> = {};
  handlers = new Map<string, Array<() => void>>();
  textContent = "";
  ownerDocument = { defaultView: { devicePixelRatio: 1 } };

  constructor(readonly tag = "div") {}

  addClass(...cls: string[]): void {
    for (const c of cls) for (const p of c.split(/\s+/).filter(Boolean)) this.classes.add(p);
  }
  removeClass(...cls: string[]): void {
    for (const c of cls) for (const p of c.split(/\s+/).filter(Boolean)) this.classes.delete(p);
  }
  toggleClass(cls: string, on: boolean): void {
    if (on) this.addClass(cls);
    else this.removeClass(cls);
  }
  hasClass(cls: string): boolean {
    return this.classes.has(cls);
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  getAttribute(k: string): string | null {
    return this.attrs[k] ?? null;
  }
  setCssStyles(styles: Record<string, string>): void {
    Object.assign(this.style, styles);
  }
  addEventListener(type: string, fn: () => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }
  removeEventListener(type: string, fn: () => void): void {
    const list = this.handlers.get(type);
    if (!list) return;
    this.handlers.set(type, list.filter((f) => f !== fn));
  }
  hasPointerCapture(): boolean {
    return false;
  }
  releasePointerCapture(): void {}
  click(): void {
    for (const fn of this.handlers.get("click") ?? []) fn();
  }
  createEl(tag: string, opts?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeEl {
    const child = new FakeEl(tag);
    if (opts?.cls) child.addClass(opts.cls);
    if (opts?.text) child.textContent = opts.text;
    if (opts?.attr) for (const [k, v] of Object.entries(opts.attr)) child.setAttribute(k, v);
    this.children.push(child);
    return child;
  }
  createDiv(opts?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeEl {
    return this.createEl("div", opts);
  }
  querySelectorAll(selector: string): FakeEl[] {
    const cls = selector.startsWith(".") ? selector.slice(1) : selector;
    const out: FakeEl[] = [];
    const walk = (el: FakeEl): void => {
      for (const child of el.children) {
        if (child.hasClass(cls)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector: string): FakeEl | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  remove(): void {}
  empty(): void {
    this.children = [];
    this.textContent = "";
  }
  setText(text: string): void {
    this.textContent = text;
  }
}

describe("image ruled-guide snapping integration", () => {
  it("snaps vertically to visible ruled guides, keeps X free, highlights, and clears on end/cancel", () => {
    const paperEl = new FakeEl("div");
    const imageFrameEl = new FakeEl("div");
    const imageUiEl = new FakeEl("div");
    const container = new FakeEl("div");

    const image: ImageElement = {
      id: "img1",
      path: "pic.png",
      x: 100,
      y: 80,
      w: 200,
      h: 110,
    };
    const page = blankPage("p1", { width: 1024, height: 1448 });
    page.images.push(image);
    const doc: InkDocument = { version: 1, pages: [page], view: { scrollY: 0, width: 1024, scale: 1 } };
    const box = { id: "p1", index: 0, x: 20, y: 40, width: 1024, height: 1448 };
    const changed = vi.fn();

    const surface = Object.assign(Object.create(InkSurface.prototype), {
      doc,
      history: new History(),
      container,
      paperEl,
      imageFrameEl,
      imageUiEl,
      direction: "vertical",
      pageLayout: { boxes: [box] },
      activeWritingGuides: { ...DEFAULT_WRITING_GUIDES, style: "lines", spacing: 32 },
      imageGuideSnapEnabled: true,
      guideSnapEl: null,
      imageDrag: null,
      selectionDragPointer: null,
      selectionScrollAt: 0,
      renderer: {
        setHiddenImages: vi.fn(),
        clearWet: vi.fn(),
        invalidateRegion: vi.fn(),
      },
      requestFrame: vi.fn(),
      renderDry: vi.fn(),
      syncImageOverlay: vi.fn(),
      changed,
    });
    Object.defineProperty(surface, "unitScale", { value: 1 });

    const drag = {
      pointerId: 1,
      part: "body" as const,
      pageId: "p1",
      targetPageId: "p1",
      image,
      start: { x: 100, y: 80, w: 200, h: 110 },
      from: { x: 150, y: 120 },
      grab: { x: 0, y: 0 },
      clientX: 150,
      clientY: 120,
      draft: { x: 100, y: 80, w: 200, h: 110 },
      lifted: true,
    };
    surface.imageDrag = drag;

    // Move by dx=+37, dy=+12 -> raw x=137, raw y=92 (4px from guide y=96).
    surface.moveImageBody(drag, box, { x: 187, y: 132 });
    expect(drag.draft.x).toBe(137);
    expect(drag.draft.y).toBe(96);
    const highlight = paperEl.querySelector(".goodobsidian-guide-snap-line");
    expect(highlight).not.toBeNull();
    expect(highlight?.hasClass("is-hidden")).toBe(false);
    expect(highlight?.style.top).toBe("136px");

    // Pull away past capture range: dy=+25 -> raw y=105 (9px from 96; bottom=215, 9px from 224).
    surface.moveImageBody(drag, box, { x: 187, y: 145 });
    expect(drag.draft.y).toBe(105);
    expect(highlight?.hasClass("is-hidden")).toBe(true);

    // Snap again, then commit drag -> highlight clears, TransformImage pushes 1 undo step, changed fires.
    surface.moveImageBody(drag, box, { x: 187, y: 132 });
    expect(highlight?.hasClass("is-hidden")).toBe(false);
    surface.endImageDrag(true);
    expect(highlight?.hasClass("is-hidden")).toBe(true);
    expect(image.x).toBe(137);
    expect(image.y).toBe(96);
    expect(surface.history.canUndo()).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);

    // Turning snap off lets image move freely even with visible ruled guides.
    surface.setImageGuideSnap(false);
    const drag2 = {
      ...drag,
      start: { x: 100, y: 80, w: 200, h: 110 },
      draft: { x: 100, y: 80, w: 200, h: 110 },
    };
    surface.imageDrag = drag2;
    surface.moveImageBody(drag2, box, { x: 187, y: 132 });
    expect(drag2.draft.y).toBe(92);
    expect(highlight?.hasClass("is-hidden")).toBe(true);

    // Turning snap back on, then hiding guides stops snapping.
    surface.setImageGuideSnap(true);
    surface.setWritingGuides(false, DEFAULT_WRITING_GUIDES);
    surface.moveImageBody(drag2, box, { x: 187, y: 132 });
    expect(drag2.draft.y).toBe(92);
    expect(highlight?.hasClass("is-hidden")).toBe(true);

    // Cancel drag clears highlight without committing.
    surface.setWritingGuides(true, DEFAULT_WRITING_GUIDES);
    surface.moveImageBody(drag2, box, { x: 187, y: 132 });
    expect(highlight?.hasClass("is-hidden")).toBe(false);
    surface.cancelImageDrag();
    expect(highlight?.hasClass("is-hidden")).toBe(true);
  });

  it("syncs the Snap toolbar button with guide visibility and omits it when not configured", () => {
    const optionsEl = new FakeEl("div");
    let guidesOn = false;
    let snapOn = true;
    const toggle = vi.fn(() => {
      snapOn = !snapOn;
    });

    const toolbar = Object.assign(Object.create(Toolbar.prototype), {
      optionsEl,
      callbacks: {
        onWritingGuides: vi.fn(),
        writingGuidesEnabled: () => guidesOn,
        onWritingGuideSnapToggle: toggle,
        writingGuideSnapEnabled: () => snapOn,
      },
    });

    toolbar.appendWritingGuideSnapButton();
    toolbar.syncWritingGuides();
    const btn = optionsEl.querySelector(".goodobsidian-writing-guide-snap");
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute("aria-pressed")).toBe("true");
    expect(btn?.hasClass("is-active")).toBe(false);
    expect(btn?.hasClass("is-armed-hidden")).toBe(true);

    guidesOn = true;
    toolbar.syncWritingGuides();
    expect(btn?.hasClass("is-active")).toBe(true);
    expect(btn?.hasClass("is-armed-hidden")).toBe(false);

    btn?.click();
    expect(toggle).toHaveBeenCalledTimes(1);
    toolbar.syncWritingGuides();
    expect(btn?.getAttribute("aria-pressed")).toBe("false");
    expect(btn?.hasClass("is-active")).toBe(false);

    // Inline toolbar (no onWritingGuideSnapToggle) does not render the Snap button.
    const inlineOptionsEl = new FakeEl("div");
    const inlineToolbar = Object.assign(Object.create(Toolbar.prototype), {
      optionsEl: inlineOptionsEl,
      callbacks: { onWritingGuides: vi.fn(), writingGuidesEnabled: () => true },
    });
    inlineToolbar.appendWritingGuideSnapButton();
    expect(inlineOptionsEl.querySelector(".goodobsidian-writing-guide-snap")).toBeNull();
  });
});
