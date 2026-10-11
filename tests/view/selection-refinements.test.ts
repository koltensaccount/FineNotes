import { describe, expect, it, vi, afterEach } from "vitest";
import { History } from "../../src/model/history";
import { StrokeIndex } from "../../src/view/stroke-index";
import { blankPage } from "../../src/model/document";
import { polygonOf } from "../../src/canvas/lasso";
import { shapeFrame } from "../../src/ink/shape-edit";
import { presetGeometry } from "../../src/ink/shape-geometry";
import { PasteGate } from "../../src/view/clipboard-read";
vi.mock("obsidian", () => ({ Notice: class {}, Platform: {}, setIcon: vi.fn() }));
const { InkSurface } = await import("../../src/view/ink-surface");
type State = Record<string, unknown>;
function call<T = unknown>(s: State, name: string, ...args: unknown[]): T {
  return (s[name] as (...a: unknown[]) => T).apply(s, args);
}
function fixture() {
  const page = blankPage("p");
  page.geometry = { width: 800, height: 1000 };
  const doc = { pages: [page], schema: 3 },
    history = new History(),
    strokeIndex = new StrokeIndex();
  let seq = 0;
  const s: State = Object.assign(Object.create(InkSurface.prototype), {
    doc,
    history,
    strokeIndex,
    palette: ["#000"],
    selection: null,
    pdfRegion: null,
    pdfRegionCandidate: null,
    imageSel: null,
    toolState: { tool: "pen", lassoMode: "rect" },
    callbacks: {},
    renderer: null,
    groupDrag: null,
    selectedShapeFrame: null,
    imagesShown: true,
    clearSelection() {
      this.selection = null;
      this.pdfRegion = null;
      this.pdfRegionCandidate = null;
    },
    deselectImage() {
      this.imageSel = null;
    },
    cancelImageDrag: vi.fn(),
    endCrop: vi.fn(),
    editingTextView: () => null,
    syncSelectionOverlay: vi.fn(),
    syncImageOverlay: vi.fn(),
    syncActionBar: vi.fn(),
    renderDry: vi.fn(),
    syncTextBoxes: vi.fn(),
    changed: vi.fn(),
    boxForPage: () => ({ index: 0, width: 800, height: 1000 }),
    pageAt: () => page,
    textBoxFrameOf: (_id: string, box: unknown) => box,
    freshIds: () => ({
      stroke: () => `s${++seq}`,
      image: () => `i${++seq}`,
      textBox: () => `t${++seq}`,
    }),
    setTool(tool: string) {
      (this.toolState as { tool: string }).tool = tool;
    },
    cancelPendingReturn: vi.fn(),
  });
  return { s, page, doc, history, strokeIndex };
}
afterEach(() => vi.unstubAllGlobals());
describe("selection refinements integration", () => {
  it.each(["ink", "shape", "arrow", "text", "mixed"])(
    "selects only the duplicated %s with fresh identities in one undo step",
    (kind) => {
      const { s, page, doc, history } = fixture();
      const stroke = {
        id: "original",
        tool: "pen" as const,
        color: "#123",
        size: 2,
        pts: [50, 50, 0.5, 150, 100, 0.5],
        ...(kind === "shape"
          ? { shape: "rect" as const }
          : kind === "arrow"
            ? { shape: "arrow" as const }
            : {}),
      };
      const text = { id: "original-text", x: 50, y: 50, w: 100, h: 100, text: "abc", fontSize: 16 };
      if (kind !== "text") page.strokes.push(stroke);
      if (kind === "text" || kind === "mixed") page.textBoxes.push(text as never);
      const original = {
        pageId: page.id,
        strokes: [...page.strokes],
        images: [],
        textBoxes: [...page.textBoxes],
      };
      s.selection = original;
      s.groupBounds = () => ({ minX: 50, minY: 50, maxX: 150, maxY: 150 });
      call(s, "duplicateSelection");
      const selected = s.selection as typeof original;
      expect(selected).not.toBe(original);
      expect((s.toolState as { tool: string }).tool).toBe("select");
      for (const copy of selected.strokes) {
        expect(copy).not.toBe(stroke);
        expect(copy.id).not.toBe(stroke.id);
        expect(copy.color).toBe(stroke.color);
        expect(copy.pts[0]).toBeGreaterThan(stroke.pts[0]);
      }
      for (const copy of selected.textBoxes) expect(copy).not.toBe(text);
      expect(s.syncSelectionOverlay).toHaveBeenCalled();
      const n = page.strokes.length + page.textBoxes.length;
      history.undo(doc as never);
      expect(page.strokes.length + page.textBoxes.length).toBe(n / 2);
      history.redo(doc as never);
      expect(page.strokes.at(-1)).toBe(selected.strokes.at(-1));
      expect(page.textBoxes.at(-1)).toBe(selected.textBoxes.at(-1));
      expect(stroke.pts).toEqual([50, 50, 0.5, 150, 100, 0.5]);
    },
  );
  it("selects a duplicate image after the insertion command clears prior selection", () => {
    const { s, page, doc, history } = fixture();
    const image = { id: "i1", path: "picture.png", x: 50, y: 50, w: 100, h: 100 };
    page.images.push(image);
    s.imageSel = { pageId: page.id, image };
    s.applyCommand = (command: { apply: (doc: unknown) => void }) => {
      s.imageSel = null;
      history.push(doc as never, command as never);
    };
    expect(call(s, "duplicateSelectedImage")).toBe(true);
    const copy = (s.imageSel as { image: typeof image }).image;
    expect(copy).not.toBe(image);
    expect(copy).toBe(page.images[1]);
    expect(s.syncImageOverlay).toHaveBeenCalled();
    history.undo(doc as never);
    expect(page.images).toEqual([image]);
    history.redo(doc as never);
    expect(page.images[1]).toBe(copy);
  });
  it("applies overlap only to enabled types and preserves ordinary default selection", () => {
    const { s, page, strokeIndex } = fixture();
    const shape = {
      id: "s1",
      tool: "pen" as const,
      color: "#000",
      size: 1,
      shape: "rect" as const,
      pts: presetGeometry("rect", { x: 50, y: 50 }, { x: 150, y: 150 }, 0.5),
    };
    page.strokes.push(shape);
    strokeIndex.rebuild([page]);
    const poly = polygonOf([148, 48, 152, 48, 152, 52, 148, 52])!;
    call(s, "selectInside", { index: 0 }, poly);
    expect(s.selection).toBeNull();
    (s.toolState as Record<string, unknown>).lassoBehavior = "overlap";
    call(s, "selectInside", { index: 0 }, poly);
    expect((s.selection as { strokes: unknown[] }).strokes).toEqual([shape]);
    (s.toolState as Record<string, unknown>).lassoFilter = { shapes: false };
    call(s, "selectInside", { index: 0 }, poly);
    expect(s.selection).toBeNull();
  });
  it.each([true, false])(
    "retains PDF region and pastes once through the gate; marker available=%s",
    async (markerAvailable) => {
      const { s, page } = fixture();
      page.backdrop = { kind: "pdf", path: "source.pdf", page: 0 };
      const file = new File(["PNG"], "region.png", { type: "image/png" }),
        onPasteImage = vi.fn(),
        onCopyPdfClipboard = vi.fn();
      s.callbacks = {
        onCopyPdfRegion: vi.fn().mockResolvedValue(file),
        onCopyPdfClipboard,
        onPasteImage,
      };
      const poly = polygonOf([10, 20, 110, 20, 110, 70, 10, 70])!;
      call(s, "selectInside", { index: 0 }, poly);
      expect(s.pdfRegion).toEqual({ pageId: page.id, polygon: poly, rectangular: true });
      expect(call(s, "copySelection")).toBe(true);
      expect(onCopyPdfClipboard).toHaveBeenCalledOnce();
      const marker = onCopyPdfClipboard.mock.calls[0][1];
      const gate = new PasteGate();
      s.pasteGate = gate;
      const request = {
        ticket: gate.begin(),
        target: { pageId: page.id, at: { x: 200, y: 300 } },
        completed: 0,
      };
      call(s, "consumePaste", request, { file, text: markerAvailable ? marker : "" });
      call(s, "consumePaste", request, { file, text: marker });
      await Promise.resolve();
      expect(onPasteImage).toHaveBeenCalledExactlyOnceWith(file, request.target);
      expect(page.images).toHaveLength(0);
      expect(page.backdrop.path).toBe("source.pdf");
    },
  );
  it("numeric height commits measured geometry and stays stable after undo/redo", () => {
    const { s, page, doc, history, strokeIndex } = fixture();
    const stroke = {
      id: "s1",
      tool: "pen" as const,
      color: "#000",
      size: 3,
      shape: "ellipse" as const,
      pts: presetGeometry("ellipse", { x: 50, y: 50 }, { x: 150, y: 350 }, 0.5),
    };
    page.strokes.push(stroke);
    s.selection = { pageId: page.id, strokes: [stroke], images: [], textBoxes: [] };
    strokeIndex.rebuild([page]);
    s.imagesShown = false;
    s.pasteAction = () => ({ id: "paste", label: "Paste", icon: "paste", group: "edit" });
    const actions = call<{ id: string; fields?: { apply: (v: Record<string, number>) => void } }[]>(
      s,
      "groupActions",
      s.selection,
    );
    actions.find((a) => a.id === "shape-values")!.fields!.apply({ w: 100, h: 400, size: 3 });
    expect(shapeFrame("ellipse", stroke.pts)!.h).toBeCloseTo(400, 1);
    expect(shapeFrame("ellipse", stroke.pts)!.w).toBeCloseTo(100, 1);
    expect(stroke.size).toBe(3);
    expect(call(s, "frameForShape", stroke)).toEqual(call(s, "frameForShape", stroke));
    expect(s.syncSelectionOverlay).toHaveBeenCalled();
    history.undo(doc as never);
    expect(shapeFrame("ellipse", stroke.pts)!.h).toBeCloseTo(300, 1);
    history.redo(doc as never);
    expect(shapeFrame("ellipse", stroke.pts)!.h).toBeCloseTo(400, 1);
  });
  it("copies drawing selection with rendered PNG and marker, and internal paste restores native editable strokes", async () => {
    const { s, page } = fixture();
    const stroke = {
      id: "orig-stroke",
      tool: "pen" as const,
      color: "#ff0055",
      size: 3,
      pts: [100, 100, 0.5, 200, 200, 0.5],
    };
    page.strokes.push(stroke);
    const selection = {
      pageId: page.id,
      strokes: [stroke],
      images: [],
      textBoxes: [],
    };
    s.selection = selection;
    s.groupBounds = () => ({ minX: 100, minY: 100, maxX: 200, maxY: 200 });
    s.pageLayout = { boxes: [{ index: 0, id: page.id }] };
    s.visibleRegion = () => ({ minX: 0, minY: 0, maxX: 800, maxY: 1000 });
    s.dropSelection = vi.fn();
    s.select = vi.fn((pageId, elements) => {
      s.selection = { pageId, ...elements };
    });

    const onCopySelection = vi.fn();
    s.callbacks = { onCopySelection };

    expect(call(s, "copySelection")).toBe(true);
    expect(onCopySelection).toHaveBeenCalledOnce();
    const [pngPromise, marker] = onCopySelection.mock.calls[0];
    expect(marker).toMatch(/^FineNotes selection:/);
    expect(pngPromise).toBeInstanceOf(Promise);

    const gate = new PasteGate();
    s.pasteGate = gate;
    const request = {
      ticket: gate.begin(),
      target: { pageId: page.id },
      completed: 0,
    };
    const pasted = call(s, "consumePaste", request, { file: null, text: marker });
    expect(pasted).toBe(true);
    expect(page.strokes).toHaveLength(2);
    const copy = page.strokes[1];
    expect(copy.id).not.toBe(stroke.id);
    expect(copy.color).toBe(stroke.color);
    expect(copy.size).toBe(stroke.size);
    expect(s.select).toHaveBeenCalledWith(page.id, expect.objectContaining({ strokes: [copy] }));
  });
});
