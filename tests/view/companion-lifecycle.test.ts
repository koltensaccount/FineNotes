import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CompanionController,
  defaultCompanionPath,
  type CompanionEntry,
  type CompanionSnapshot,
} from "../../src/model/companion-pdf";
import { buildInkFile } from "../../src/model/serialize";
import { emptyDocument } from "../../src/model/document";
import { DEFAULT_SETTINGS } from "../../src/settings-data";
vi.mock("obsidian", () => import("./fake-obsidian"));
vi.mock("../../src/view/pdf-export", () => ({
  exportPagesToPdf: vi.fn(async () => new Uint8Array([1])),
  paintPagePreview: vi.fn(),
}));
const { InkView } = await import("../../src/view/ink-view");
const { WorkspaceLeaf, TFile, notices, resetFakes } = await import("./fake-obsidian");
const { exportPagesToPdf } = await import("../../src/view/pdf-export");
const ID = "a3f9211234567890";
function setup(enabled = true) {
  const note = new TFile("Biology.notebook.md", 100);
  const entry: CompanionEntry = {
    notebookPath: note.path,
    pdfPath: defaultCompanionPath(note.path, ID),
    enabled,
    followName: true,
    dirty: true,
  };
  const targets = new Map<string, string>();
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
  const app = { vault: { getFileByPath: (path: string) => (path === note.path ? note : null) } };
  const plugin = { settings: { ...DEFAULT_SETTINGS }, companionPdfs, fileMoves: { log: () => [] } };
  const make = () => {
    const view = new InkView(new WorkspaceLeaf(app) as never, plugin as never);
    (view as unknown as { file: unknown }).file = note;
    Object.defineProperty(view, "contentEl", { value: { empty: vi.fn() } });
    view.setViewData(
      buildInkFile(`---\nfinenotes-companion-id: ${ID}\n---\n`, emptyDocument(1024)),
      false,
    );
    return view;
  };
  return { entry, controller, replace, note, make, targets };
}
beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  vi.clearAllMocks();
  resetFakes();
});
afterEach(() => vi.unstubAllGlobals());
describe("actual InkView companion lifecycle", () => {
  it("dirty file unload exports exactly once; following view close and clean reopen export zero", async () => {
    const s = setup();
    const view = s.make();
    await view.onUnloadFile(s.note as never);
    await view.onClose();
    expect(exportPagesToPdf).toHaveBeenCalledOnce();
    expect(s.entry.dirty).toBe(false);
    const again = s.make();
    await again.onUnloadFile(s.note as never);
    await again.onClose();
    expect(exportPagesToPdf).toHaveBeenCalledOnce();
  });
  it("disabled or unconfigured notebooks never auto export", async () => {
    const s = setup(false);
    const view = s.make();
    await view.onUnloadFile(s.note as never);
    await view.onClose();
    expect(exportPagesToPdf).not.toHaveBeenCalled();
  });
  it("uses all pages and the existing exporter including imported PDF backdrops", async () => {
    const s = setup();
    const view = s.make();
    const inside = view as unknown as { doc: ReturnType<typeof emptyDocument> };
    inside.doc.pages[0].backdrop = { kind: "pdf", path: "Lecture.pdf", page: 2 };
    await view.updateCompanionPdf(true);
    const call = vi.mocked(exportPagesToPdf).mock.calls[0];
    expect(call[0][0].backdrop).toEqual({ kind: "pdf", path: "Lecture.pdf", page: 2 });
    expect(call[2]).toMatchObject({ subject: `FineNotes companion ${ID}`, title: "Biology" });
  });
  it("does not export per stroke; content changes wait for a close/update request", async () => {
    const s = setup();
    const view = s.make();
    const inside = view as unknown as {
      doc: ReturnType<typeof emptyDocument>;
      markCompanionChanged(): void;
    };
    for (let i = 0; i < 10; i++) {
      inside.doc.pages[0].strokes.push({
        id: String(i),
        tool: "pen",
        color: "#000",
        size: 3,
        pts: [1, i, 0.5],
      });
      inside.markCompanionChanged();
    }
    expect(exportPagesToPdf).not.toHaveBeenCalled();
    await view.onUnloadFile(s.note as never);
    expect(exportPagesToPdf).toHaveBeenCalledOnce();
  });
  it("view disposal waits for a running export before destroying its caches", async () => {
    const s = setup();
    const view = s.make();
    let release = () => {};
    vi.mocked(exportPagesToPdf).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(new Uint8Array([1]));
        }),
    );
    const destroy = vi.fn();
    (view as unknown as { images: unknown }).images = { destroy };
    const manual = view.updateCompanionPdf(true);
    await vi.waitFor(() => expect(exportPagesToPdf).toHaveBeenCalledOnce());
    const close = view.onClose();
    expect(destroy).not.toHaveBeenCalled();
    release();
    await Promise.all([manual, close]);
    expect(destroy).toHaveBeenCalledOnce();
    expect(exportPagesToPdf).toHaveBeenCalledOnce();
  });
  it("an export failure leaves the association dirty without blocking view close", async () => {
    const s = setup();
    const view = s.make();
    vi.mocked(exportPagesToPdf).mockRejectedValueOnce(new Error("PDF unavailable"));
    await view.onClose();
    expect(s.entry.dirty).toBe(true);
    expect(s.replace).not.toHaveBeenCalled();
    expect(notices.some((n) => n.message.includes("PDF unavailable"))).toBe(true);
  });
});

it("quantized handwriting stays clean across an actual serialized notebook reload", async () => {
  const s = setup();
  const view = s.make();
  const inside = view as unknown as { doc: ReturnType<typeof emptyDocument> };
  inside.doc.pages[0].strokes.push({
    id: "s",
    tool: "pen",
    color: "#000",
    size: 3,
    pts: [1.23456, 2.34567, 0.6789, 3.45678, 4.56789, 0.78901],
  });
  await view.updateCompanionPdf(false);
  const saved = view.getViewData();
  const reopened = s.make();
  reopened.setViewData(saved, false);
  await reopened.onUnloadFile(s.note as never);
  expect(exportPagesToPdf).toHaveBeenCalledOnce();
});

it("a failed unload followed by close performs one attempt and stays dirty", async () => {
  const s = setup();
  const view = s.make();
  vi.mocked(exportPagesToPdf).mockRejectedValueOnce(new Error("source unavailable"));
  await view.onUnloadFile(s.note as never);
  await view.onClose();
  expect(exportPagesToPdf).toHaveBeenCalledOnce();
  expect(s.entry.dirty).toBe(true);
  expect(s.replace).not.toHaveBeenCalled();
});
