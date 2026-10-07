import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { History } from "../../src/model/history";
import { AddElements, RemoveElements } from "../../src/model/selection-commands";
import { emptyDocument, type Stroke } from "../../src/model/document";
import { buildInkFile } from "../../src/model/serialize";
import { DEFAULT_SETTINGS } from "../../src/settings-data";
import {
  migrateWritingPresets,
  saveColor,
  selectPreset,
  selectedColor,
} from "../../src/model/writing-presets";
import {
  CompanionController,
  defaultCompanionPath,
  type CompanionEntry,
  type CompanionSnapshot,
} from "../../src/model/companion-pdf";
import { MultiTouchDoubleTap } from "../../src/input/multitouch-double-tap";
import { bindMultiTouchInput } from "../../src/view/multitouch-input";
import { bindColorStripInput } from "../../src/view/color-strip-input";
import { PasteGate } from "../../src/view/clipboard-read";
vi.mock("obsidian", () => import("./fake-obsidian"));
vi.mock("../../src/view/pdf-export", () => ({
  exportPagesToPdf: vi.fn(async () => new Uint8Array([1])),
  paintPagePreview: vi.fn(),
}));
const { InkView } = await import("../../src/view/ink-view");
const { InkSurface } = await import("../../src/view/ink-surface");
const { WorkspaceLeaf, TFile } = await import("./fake-obsidian");
const { exportPagesToPdf } = await import("../../src/view/pdf-export");
type State = Record<string, unknown>;
const call = <T = unknown>(target: object, name: string, ...args: unknown[]): T =>
  ((target as State)[name] as (...args: unknown[]) => T).apply(target, args);
const ID = "a3f9211234567890";
function setup() {
  const presets = migrateWritingPresets(DEFAULT_SETTINGS);
  const red = presets.palettes.pen.find((p) => p.color === "#e03131")!;
  selectPreset(presets, "pen", red.id);
  saveColor(presets, "pen", "#1971c2", red.id);
  const settings = {
    ...DEFAULT_SETTINGS,
    writingPresets: presets,
    penLineStyle: "dashed" as const,
  };
  const note = new TFile("Biology.notebook.md", 100);
  const entry: CompanionEntry = {
    notebookPath: note.path,
    pdfPath: defaultCompanionPath(note.path, ID),
    enabled: true,
    followName: true,
    dirty: true,
  };
  const targets = new Map<string, string>();
  const assets = new Map<string, InstanceType<typeof TFile>>();
  const replace = vi.fn(async () => {
    targets.set(entry.pdfPath, ID);
  });
  const controller = new CompanionController(
    { version: 1, entries: { [ID]: entry } },
    {
      exists: (p) => targets.has(p),
      pdfIdentity: async (p) => targets.get(p) ?? null,
      pdfPaths: () => [...targets.keys()],
      replace,
      rename: vi.fn(),
      persist: async () => {},
    },
  );
  const companionPdfs = {
    controller,
    entry: () => entry,
    persist: async () => {},
    assess: async () => {},
    update: (
      id: string,
      _note: unknown,
      factory: () => Promise<CompanionSnapshot>,
      force: boolean,
    ) => controller.update(id, factory, force),
  };
  const app = {
    vault: {
      getFileByPath: (path: string) => (path === note.path ? note : (assets.get(path) ?? null)),
    },
  };
  const plugin = { settings, companionPdfs, fileMoves: { log: () => [] } };
  const make = () => {
    const view = new InkView(new WorkspaceLeaf(app) as never, plugin as never);
    Object.assign(view, { file: note });
    Object.defineProperty(view, "contentEl", { value: { empty: vi.fn() } });
    view.setViewData(
      buildInkFile(`---\nfinenotes-companion-id: ${ID}\n---\n`, emptyDocument(1024)),
      false,
    );
    return view;
  };
  const view = make();
  const inside = view as unknown as {
    doc: ReturnType<typeof emptyDocument>;
    surface: InstanceType<typeof InkSurface>;
    toolState: { color: string; lineStyle: string };
    markCompanionChanged(): void;
  };
  const history = new History();
  const doc = inside.doc;
  const surface: InstanceType<typeof InkSurface> = Object.assign(
    Object.create(InkSurface.prototype) as object,
    {
      doc,
      toolState: inside.toolState,
      history,
      pageIndex: 0,
      callbacks: { onChange: () => inside.markCompanionChanged() },
      reportStatus: vi.fn(),
      strokeIds: { catchUp: vi.fn() },
      textBoxIds: { catchUp: vi.fn() },
      strokeIndex: { rebuild: vi.fn() },
      dropSelection: vi.fn(),
      layout: vi.fn(),
      layoutStale: () => false,
      renderAll: vi.fn(),
      reportTextEditing: vi.fn(),
      revealChange: vi.fn(),
      endCrop: vi.fn(),
      cancelImageDrag: vi.fn(),
      cancelGroupDrag: vi.fn(),
      selectImage: vi.fn(),
      visibleRegion: () => null,
      destroy: vi.fn(),
      imagesShown: true,
      lastPastePoint: { pageId: doc.pages[0].id, at: { x: 123, y: 321 } },
      pasteGate: new PasteGate(),
      pasteRequest: null,
      pasteTimer: 0,
      editingTextView: () => null,
    },
  ) as unknown as InstanceType<typeof InkSurface>;
  inside.surface = surface;
  const add = (lineStyle: "dashed" | "dotted") => {
    const stroke: Stroke = {
      id: `s${doc.pages[0].strokes.length}`,
      tool: "pen",
      color: selectedColor(presets, "pen"),
      size: 3,
      pts: [1, 2, 0.5, 100, 50, 0.7],
      lineStyle,
    };
    surface.applyCommand(
      new AddElements(doc.pages[0].id, { strokes: [stroke], images: [], textBoxes: [] }),
    );
    return stroke;
  };
  return {
    view,
    inside,
    surface,
    doc,
    history,
    entry,
    controller,
    replace,
    make,
    note,
    assets,
    add,
  };
}
beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());
describe("personal build feature interactions", () => {
  it("an edited selected default preset becomes blue dashed drawing state", () => {
    const s = setup();
    expect(s.inside.toolState.color).toBe("#1971c2");
    expect(call(s.surface, "currentStyle")).toMatchObject({
      color: "#1971c2",
      lineStyle: "dashed",
      tool: "pen",
    });
  });
  it.each(["dashed", "dotted"] as const)(
    "companion close exports %s metadata and reopened unchanged content renders nothing",
    async (style) => {
      const s = setup();
      s.add(style);
      await s.view.onUnloadFile(s.note as never);
      await s.view.onClose();
      expect(exportPagesToPdf).toHaveBeenCalledOnce();
      expect(vi.mocked(exportPagesToPdf).mock.calls[0][0][0].strokes[0]).toMatchObject({
        color: "#1971c2",
        lineStyle: style,
      });
      expect(s.entry.dirty).toBe(false);
      const saved = s.view.getViewData(),
        reopened = s.make();
      reopened.setViewData(saved, false);
      await reopened.onUnloadFile(s.note as never);
      await reopened.onClose();
      expect(exportPagesToPdf).toHaveBeenCalledOnce();
    },
  );
  it("a style-only change invalidates a formerly clean companion fingerprint", async () => {
    const s = setup(),
      stroke = s.add("dashed");
    await s.view.updateCompanionPdf(false);
    stroke.lineStyle = "dotted";
    call(s.surface, "changed");
    await s.view.onClose();
    expect(exportPagesToPdf).toHaveBeenCalledTimes(2);
    expect(vi.mocked(exportPagesToPdf).mock.calls[1][0][0].strokes[0].lineStyle).toBe("dotted");
  });
  it("two-finger Undo and three-finger Redo update the same history and companion output", async () => {
    const s = setup();
    s.add("dashed");
    await s.view.updateCompanionPdf(false);
    const gesture = new MultiTouchDoubleTap((action) => s.surface[action]());
    const tap = (n: number, t: number) => {
      for (let i = 1; i <= n; i++)
        gesture.down({
          pointerId: i,
          pointerType: "touch",
          clientX: i * 30,
          clientY: 100,
          timeStamp: t + i * 5,
        });
      for (let i = 1; i <= n; i++)
        gesture.up({
          pointerId: i,
          pointerType: "touch",
          clientX: i * 30,
          clientY: 100,
          timeStamp: t + 60 + i * 5,
        });
    };
    tap(2, 0);
    tap(2, 150);
    expect(s.doc.pages[0].strokes).toHaveLength(0);
    expect(s.entry.dirty).toBe(true);
    await s.view.updateCompanionPdf(false);
    expect(vi.mocked(exportPagesToPdf).mock.calls.at(-1)![0][0].strokes).toHaveLength(0);
    tap(3, 300);
    tap(3, 450);
    expect(s.doc.pages[0].strokes).toHaveLength(1);
    await s.view.onUnloadFile(s.note as never);
    await s.view.onClose();
    expect(exportPagesToPdf).toHaveBeenCalledTimes(3);
    expect(vi.mocked(exportPagesToPdf).mock.calls.at(-1)![0][0].strokes[0].lineStyle).toBe(
      "dashed",
    );
    expect(s.entry.dirty).toBe(false);
  });
  it("deleting and restoring styled content refreshes the companion at each requested close/update", async () => {
    const s = setup(),
      stroke = s.add("dotted");
    await s.view.updateCompanionPdf(false);
    s.surface.applyCommand(
      new RemoveElements(s.doc.pages[0].id, { strokes: [stroke], images: [], textBoxes: [] }),
    );
    await s.view.updateCompanionPdf(false);
    expect(vi.mocked(exportPagesToPdf).mock.calls.at(-1)![0][0].strokes).toHaveLength(0);
    s.surface.undo();
    await s.view.onClose();
    expect(vi.mocked(exportPagesToPdf).mock.calls.at(-1)![0][0].strokes[0].lineStyle).toBe(
      "dotted",
    );
    expect(exportPagesToPdf).toHaveBeenCalledTimes(3);
  });
  it("native screenshot paste becomes a selected picture and the final companion includes it", async () => {
    const s = setup(),
      file = new File(["png pixels"], "shot.png", { type: "image/png" });
    const path = "attachments/shot.png";
    s.assets.set(path, new TFile(path, 100));
    // Only decoding/attachment I/O is substituted; page placement, InsertImage, selection,
    // native clipboard routing, fingerprinting and close/export use production methods.
    vi.spyOn(s.view, "insertImageBytes").mockImplementation(async (bytes, mime, _name, options) => {
      expect(new TextDecoder().decode(bytes)).toBe("png pixels");
      expect(mime).toBe("image/png");
      return call(s.view, "placeImage", path, 100, 80, options ?? {});
    });
    let inserting = Promise.resolve();
    Object.assign((s.surface as unknown as { callbacks: State }).callbacks, {
      onPasteImage: (image: File, target: unknown) => {
        inserting = call<Promise<void>>(s.view, "pastePictureFile", image, target);
      },
    });
    const event = {
      target: null,
      clipboardData: { files: [file], items: [], getData: () => "" },
      preventDefault: vi.fn(),
    };
    expect(s.surface.handlePaste(event as unknown as ClipboardEvent)).toBe(true);
    await inserting;
    expect(s.doc.pages[0].images[0]).toMatchObject({ path, x: 73, y: 281 });
    expect(
      (s.surface as unknown as { selectImage: ReturnType<typeof vi.fn> }).selectImage,
    ).toHaveBeenCalledOnce();
    await s.view.onUnloadFile(s.note as never);
    await s.view.onClose();
    expect(exportPagesToPdf).toHaveBeenCalledOnce();
    expect(vi.mocked(exportPagesToPdf).mock.calls[0][0][0].images[0].path).toBe(path);
    expect(s.entry.dirty).toBe(false);
  });
});
class Area extends EventTarget {
  control = false;
  paper = false;
  ownerDocument!: Area & {
    defaultView: Area & { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
    visibilityState: string;
  };
  contains(target: unknown): boolean {
    return target instanceof Area && target.paper;
  }
  closest(): Area | null {
    return this.control ? this : null;
  }
}
it("palette scrolling and multi-finger menu taps neither change color nor invoke history, while closed-popup paper taps do", () => {
  vi.stubGlobal("Element", Area);
  const doc = new Area() as Area["ownerDocument"];
  doc.visibilityState = "visible";
  doc.defaultView = Object.assign(new Area(), { setTimeout, clearTimeout });
  const paper = new Area(),
    strip = new Area(),
    button = new Area();
  paper.paper = true;
  button.control = true;
  for (const el of [paper, strip, button]) el.ownerDocument = doc;
  const undo = vi.fn(),
    redo = vi.fn(),
    select = vi.fn(),
    context = vi.fn();
  const multi = bindMultiTouchInput(paper as unknown as HTMLElement, {
      undo,
      redo,
      blocked: () => false,
    }),
    color = bindColorStripInput(
      button as unknown as HTMLElement,
      strip as unknown as HTMLElement,
      select,
      context,
    );
  const send = (phase: string, id: number, t: number, target: Area, x = id * 30) => {
    const event = new Event(phase, { cancelable: true });
    for (const [key, value] of Object.entries({
      target,
      pointerId: id,
      pointerType: "touch",
      button: 0,
      clientX: x,
      clientY: 100,
      timeStamp: t,
      detail: 1,
    }))
      Object.defineProperty(event, key, { value });
    if (target === button) button.dispatchEvent(event);
    doc.dispatchEvent(event);
  };
  send("pointerdown", 1, 0, button);
  send("pointermove", 1, 20, button, 80);
  strip.dispatchEvent(new Event("scroll"));
  send("pointerup", 1, 60, button, 80);
  send("click", 1, 70, button, 80);
  expect(select).not.toHaveBeenCalled();
  const tap = (n: number, t: number, target: Area) => {
    for (let i = 1; i <= n; i++) send("pointerdown", i, t + i * 5, target);
    for (let i = 1; i <= n; i++) send("pointerup", i, t + 60 + i * 5, target);
  };
  tap(2, 150, button);
  tap(2, 300, button);
  tap(3, 450, button);
  tap(3, 600, button);
  expect(undo).not.toHaveBeenCalled();
  expect(redo).not.toHaveBeenCalled();
  tap(2, 750, paper);
  tap(2, 900, paper);
  tap(3, 1050, paper);
  tap(3, 1200, paper);
  expect(undo).toHaveBeenCalledOnce();
  expect(redo).toHaveBeenCalledOnce();
  expect(context).not.toHaveBeenCalled();
  multi.dispose();
  color();
});
