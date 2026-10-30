import { buildInkFile, parseInkFile } from "../../src/model/serialize";
import { InkSurface } from "../../src/view/ink-surface";
import { describe, it, expect, vi } from "vitest";
vi.mock("obsidian", async () => ({
  ...(await import("./fake-obsidian")),
  MarkdownRenderChild: class {
    onunload() {}
  },
}));
import {
  resolveNotebookAssociation,
  renameNotebookAssociations,
  type AssociationInput,
} from "../../src/model/notebook-association";
import {
  AddHandwritingRegion,
  allocateHandwritingRegion,
  pageContentBottom,
  updateHandwritingReferences,
} from "../../src/model/region-allocation";
import { emptyDocument, blankPage, clipCurrentBounds } from "../../src/model/document";
import {
  NotebookSuggestModal,
  embedInsertionOffset,
  insertHandwritingEmbed,
  handwriteHere,
  registerHandwriteHere,
  referencedEmbedImages,
} from "../../src/view/handwrite-here";
vi.mock("../../src/view/clip-png", () => ({
  renderClipPng: vi.fn(async () => new ArrayBuffer(8)),
}));
import { renderClipPng } from "../../src/view/clip-png";
import { InkView } from "../../src/view/ink-view";
import { TFile, MarkdownView } from "obsidian";

const input = (overrides: Partial<AssociationInput> = {}): AssociationInput => ({
  markdownPath: "class/note.md",
  text: "",
  notebooks: ["class/a.notebook.md", "other/b.notebook.md"],
  resolveLink: (link) => link,
  imageOwner: async () => null,
  ...overrides,
});
describe("notebook association", () => {
  it("prefers explicit properties over stored links and folder guesses", async () => {
    expect(
      await resolveNotebookAssociation(
        input({
          frontmatter: { notebook: "[[other/b.notebook.md]]" },
          stored: { "class/note.md": "class/a.notebook.md" },
        }),
      ),
    ).toBe("other/b.notebook.md");
    expect(
      await resolveNotebookAssociation(
        input({ frontmatter: { "finenotes-notebook": "other/b.notebook.md" } }),
      ),
    ).toBe("other/b.notebook.md");
  });
  it("uses stored associations, ignoring stale paths", async () => {
    expect(
      await resolveNotebookAssociation(
        input({ stored: { "class/note.md": "other/b.notebook.md" } }),
      ),
    ).toBe("other/b.notebook.md");
    expect(
      await resolveNotebookAssociation(
        input({ stored: { "class/note.md": "deleted.notebook.md" } }),
      ),
    ).toBe("class/a.notebook.md");
  });
  it("resolves legacy notebook links and PNG links by metadata, never ambiguous filename guesses", async () => {
    expect(
      await resolveNotebookAssociation(input({ text: "![[other/b.notebook.md#^clip-abc]]" })),
    ).toBe("other/b.notebook.md");
    const imageOwner = vi.fn(async () => "other/b.notebook.md");
    expect(
      await resolveNotebookAssociation(
        input({ text: "![[assets/b-clip-abc.png|500]]", imageOwner }),
      ),
    ).toBe("other/b.notebook.md");
    expect(imageOwner).toHaveBeenCalledWith("assets/b-clip-abc.png");
  });
  it("prompts only when the folder has no unambiguous notebook", async () => {
    expect(
      await resolveNotebookAssociation(
        input({ notebooks: ["class/a.notebook.md", "class/b.notebook.md"] }),
      ),
    ).toBeNull();
  });
  it("tracks note, notebook, and folder renames", () => {
    const pairs = {
      "class/note.md": "class/a.notebook.md",
      "other/note.md": "class/a.notebook.md",
    };
    expect(renameNotebookAssociations(pairs, "class", "courses")).toEqual({
      "courses/note.md": "courses/a.notebook.md",
      "other/note.md": "courses/a.notebook.md",
    });
    expect(
      renameNotebookAssociations(pairs, "class/a.notebook.md", "new.notebook.md")["class/note.md"],
    ).toBe("new.notebook.md");
    expect(renameNotebookAssociations(pairs, "class/note.md", "renamed.md")["renamed.md"]).toBe(
      "class/a.notebook.md",
    );
  });
});

describe("handwriting region placement", () => {
  it("starts on empty paper and considers every content kind and reserved region", () => {
    const doc = emptyDocument();
    expect(allocateHandwritingRegion(doc).bounds.minY).toBe(60);
    const page = doc.pages[0];
    page.images.push({ id: "i1", path: "x.png", x: 0, y: 100, w: 20, h: 300 });
    expect(pageContentBottom(page)).toBe(400);
    expect(allocateHandwritingRegion(doc).bounds.minY).toBe(440);
    const allocation = allocateHandwritingRegion(doc);
    const clip = {
      id: "clip-a",
      pageId: page.id,
      bounds: allocation.bounds,
      isExpandable: true,
      originY: 440,
      createdAt: 0,
      updatedAt: 0,
    };
    new AddHandwritingRegion(allocation, clip).apply(doc);
    expect(allocateHandwritingRegion(doc).bounds.minY).toBe(720);
  });
  it("adds matching paper when full and keeps page plus clip undoable", () => {
    const doc = emptyDocument();
    const page = doc.pages[0];
    page.backdrop = { kind: "grid", paperColor: "#fff" } as never;
    page.strokes.push({
      id: "s1",
      color: "#000",
      size: 2,
      tool: "pen",
      pts: [100, page.geometry.height - 200, 1],
    });
    const allocation = allocateHandwritingRegion(doc);
    expect(allocation.newPage).toBe(true);
    expect(allocation.page.backdrop).toEqual(page.backdrop);
    const clip = {
      id: "clip-a",
      pageId: allocation.page.id,
      bounds: allocation.bounds,
      createdAt: 0,
      updatedAt: 0,
    };
    const command = new AddHandwritingRegion(allocation, clip);
    command.apply(doc);
    expect(doc.pages).toHaveLength(2);
    expect(doc.pages[1].clips).toEqual([clip]);
    command.invert(doc);
    expect(doc.pages).toHaveLength(1);
    command.apply(doc);
    expect(doc.pages[1].clips).toEqual([clip]);
  });
  it("uses a specified open page instead of the last page", () => {
    const doc = emptyDocument();
    doc.pages.push(blankPage("p2"));
    expect(allocateHandwritingRegion(doc, 0).pageIndex).toBe(0);
    expect(allocateHandwritingRegion(doc).pageIndex).toBe(1);
  });
});

describe("safe Markdown insertion and command", () => {
  it("rebases the original cursor when unrelated text is edited, without replacing a selection", () => {
    const before = "Proof:\n\nConclusion";
    expect(embedInsertionOffset(before, "New heading\n" + before, 7)).toBe(19);
    expect(embedInsertionOffset(before, "Different note", 7)).toBeNull();
    const replaceRange = vi.fn();
    const editor = { getValue: () => before, offsetToPos: (n: number) => n, replaceRange };
    insertHandwritingEmbed(editor as never, before, 7, "![[clip.png]]");
    expect(replaceRange).toHaveBeenCalledWith("![[clip.png]]\n", 7);
    expect(() =>
      insertHandwritingEmbed({ ...editor, getValue: () => "changed" } as never, before, 7, "x"),
    ).toThrow();
  });
  it("persists an association, opens adjacent notebook, and inserts a clean native embed", async () => {
    const note = Object.assign(Object.create(TFile.prototype), { path: "class/note.md" });
    const book = Object.assign(Object.create(TFile.prototype), { path: "class/a.notebook.md" });
    const image = Object.assign(Object.create(TFile.prototype), { path: "assets/a-clip-test.png" });
    const ink = Object.create(InkView.prototype);
    ink.createHandwritingRegion = vi.fn(async () => image);
    const leaf = { view: ink, setViewState: vi.fn(async () => {}) };
    const source = { file: note, leaf: {} as any };
    source.leaf.view = source;
    const editor = {
      getValue: () => "Proof",
      replaceRange: vi.fn(),
      offsetToPos: (n: number) => n,
    };
    const plugin = {
      settings: {},
      saveSettings: vi.fn(async () => {}),
      app: {
        vault: {
          getFiles: () => [book],
          getFileByPath: (p: string) => (p === book.path ? book : null),
        },
        metadataCache: {
          getFileCache: () => ({}),
          getFirstLinkpathDest: (p: string) => (p === book.path ? book : null),
        },
        workspace: {
          getLeavesOfType: () => [],
          getLeaf: () => leaf,
          revealLeaf: vi.fn(async () => {}),
        },
        fileManager: { generateMarkdownLink: () => "[[assets/a-clip-test.png]]" },
      },
    };
    await handwriteHere(plugin as never, source as never, editor as never, note, "Proof", 5);
    expect(plugin.settings).toEqual({ notebookAssociations: { [note.path]: book.path } });
    expect(leaf.setViewState).toHaveBeenCalled();
    expect(ink.createHandwritingRegion).toHaveBeenCalledWith(false, expect.any(Set));
    expect(editor.replaceRange).toHaveBeenCalledWith("\n![[assets/a-clip-test.png]]\n", 5);
  });
  it("captures the editor cursor synchronously and disables the command inside notebooks", () => {
    let command: any;
    const plugin = {
      addCommand: (c: unknown) => {
        command = c;
      },
      registerEvent: () => {},
      app: { vault: { on: () => {}, getFiles: () => [] } },
      isInkFile: vi.fn(() => true),
    };
    registerHandwriteHere(plugin as never);
    const view = Object.assign(Object.create(MarkdownView.prototype), {
      file: { path: "note.md" },
    });
    expect(command.id).toBe("handwrite-here");
    expect(command.editorCheckCallback(true, {}, view)).toBe(false);
    plugin.isInkFile.mockReturnValue(false);
    const cursor = { line: 1, ch: 3 };
    const editor = {
      getValue: vi.fn(() => "proof"),
      getCursor: vi.fn(() => cursor),
      posToOffset: vi.fn(() => 5),
    };
    expect(command.editorCheckCallback(true, editor, view)).toBe(true);
    expect(editor.getCursor).not.toHaveBeenCalled();
    command.editorCheckCallback(false, editor, view);
    expect(editor.getValue).toHaveBeenCalledOnce();
    expect(editor.posToOffset).toHaveBeenCalledWith(cursor);
  });
});

it("creates a durable expandable region, activates Pen, and refreshes its PNG as new ink is added", async () => {
  const doc = emptyDocument();
  const file = Object.assign(Object.create(TFile.prototype), {
    path: "book.notebook.md",
    basename: "book.notebook",
  });
  const image = Object.assign(Object.create(TFile.prototype), {
    path: "assets/book-clip-test.png",
  });
  const view = Object.create(InkView.prototype) as any;
  const surface = {
    document: doc,
    currentPage: 0,
    applyCommand: vi.fn((command: AddHandwritingRegion) => command.apply(doc)),
    setTool: vi.fn(),
    refreshHandwritingRegions: vi.fn(),
  };
  Object.assign(view, {
    file,
    surface,
    doc,
    guard: { locked: false },
    latestDrawingAt: 0,
    writeHold: { writing: vi.fn(() => false) },
    toolState: { pressureEnabled: false },
    embedRefreshPending: false,
    embedHashes: new Map(),
    isProtected: () => false,
    toolbar: { syncActive: vi.fn() },
    applyPendingPage: vi.fn(),
    saveNow: vi.fn(async () => {}),
    plugin: {
      settings: { embedBackground: false },
      embedManager: { refreshEmbedImagesInDom: vi.fn() },
    },
    app: {
      fileManager: { getAvailablePathForAttachment: vi.fn(async () => image.path) },
      vault: {
        createBinary: vi.fn(async () => image),
        getAbstractFileByPath: (path: string) => (path === image.path ? image : null),
        modifyBinary: vi.fn(async () => {}),
      },
    },
  });
  expect(await view.createHandwritingRegion()).toBe(image);
  expect(doc.pages[0].clips![0]).toMatchObject({
    isExpandable: true,
    originY: 60,
    imagePath: image.path,
  });
  expect(view.saveNow).toHaveBeenCalledOnce();
  expect(surface.setTool).toHaveBeenCalledWith("pen");
  expect(view.pendingSubpath).toBe(`#^${doc.pages[0].clips![0].id}`);
  expect(await view.createHandwritingRegion(false, new Set())).toBe(image);
  expect(surface.applyCommand).toHaveBeenCalledOnce();
  expect(doc.pages[0].clips).toHaveLength(1);
  const active = doc.pages[0].clips![0];
  doc.pages[0].clips!.push({
    ...active,
    id: "clip-unused",
    imagePath: "unused.png",
    originY: 340,
    bounds: { ...active.bounds, minY: 340, maxY: 580 },
  });
  view.app.metadataCache = { resolvedLinks: { "proof.md": { [image.path]: 1 } } };
  view.app.workspace = { getLeavesOfType: () => [] };
  view.requestSave = vi.fn();
  surface.refreshHandwritingRegions = vi.fn();
  doc.pages[0].strokes.push(
    { id: "ink-1", color: "#000", size: 2, tool: "pen", pts: [100, 70, 1, 200, 200, 1] },
    { id: "ink-2", color: "#000", size: 2, tool: "pen", pts: [100, 350, 1, 200, 800, 1] },
  );
  vi.mocked(renderClipPng).mockClear();
  view.writeHold.writing.mockReturnValueOnce(true);
  await view.refreshEmbedImages();
  expect(view.embedRefreshPending).toBe(true);
  expect(renderClipPng).not.toHaveBeenCalled();
  view.embedRefreshPending = false;
  await view.refreshEmbedImages();
  expect(renderClipPng).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ maxY: 824 }),
    expect.objectContaining({ includeBackground: false, usePressure: false }),
  );
  expect(view.app.vault.modifyBinary).toHaveBeenCalledWith(image, expect.any(ArrayBuffer));
  expect(view.plugin.embedManager.refreshEmbedImagesInDom).toHaveBeenCalledWith(image);
  // A stroke arriving during async rendering must survive into the next refresh.
  view.embedHashes.clear();
  view.clipsDirty = true;
  view.app.vault.modifyBinary.mockImplementationOnce(async () => { view.embedRefreshPending = true; });
  await view.refreshEmbedImages();
  expect(view.clipsDirty).toBe(true);
});

it("reclaims the earliest unreferenced empty region instead of reserving more blank space", () => {
  const doc = emptyDocument(),
    page = doc.pages[0];
  page.clips = [60, 340, 620].map((originY, i) => ({
    id: `clip-${i}`,
    pageId: page.id,
    bounds: { minX: 40, minY: originY, maxX: 760, maxY: originY + 240 },
    isExpandable: true,
    originY,
    imagePath: `assets/clip-${i}.png`,
    createdAt: 0,
    updatedAt: 0,
  }));
  const allocation = allocateHandwritingRegion(doc, 0, new Set());
  expect(allocation.reusableClip).toBe(page.clips[0]);
  expect(allocation.bounds.minY).toBe(60);
  expect(allocation.newPage).toBe(false);
  // A still-visible blank embed retains its reservation.
  expect(allocateHandwritingRegion(doc, 0, new Set(["assets/clip-0.png"])).reusableClip).toBe(
    page.clips[1],
  );
  page.strokes.push({
    id: "ink",
    color: "#000",
    size: 2,
    tool: "pen",
    pts: [100, 70, 1, 200, 100, 1],
  });
  expect(allocateHandwritingRegion(doc, 0, new Set()).reusableClip).toBe(page.clips[1]);
});

it("never reclaims handwriting, crossing strokes, text, images, or circuits", () => {
  const doc = emptyDocument(),
    page = doc.pages[0];
  page.clips = [
    {
      id: "clip-a",
      pageId: page.id,
      bounds: { minX: 40, minY: 60, maxX: 760, maxY: 300 },
      isExpandable: true,
      originY: 60,
      imagePath: "a.png",
      createdAt: 0,
      updatedAt: 0,
    },
  ];
  const content = { id: "element", x: 100, y: 600, w: 20, h: 20 };
  for (const kind of ["images", "textBoxes", "circuits"] as const) {
    page[kind] = [content as never];
    expect(allocateHandwritingRegion(doc, 0, new Set()).reusableClip).toBeUndefined();
    page[kind] = [];
  }
  page.strokes.push({
    id: "crossing",
    color: "#000",
    size: 2,
    tool: "pen",
    pts: [100, 20, 1, 100, 80, 1],
  });
  expect(allocateHandwritingRegion(doc, 0, new Set()).reusableClip).toBeUndefined();
});

it("uses the live Markdown contents after deletion while protecting references in other notes", () => {
  const source = { path: "note.md" };
  const app = {
    workspace: { getLeavesOfType: () => [] },
    metadataCache: {
      resolvedLinks: { "note.md": { "assets/old.png": 1 }, "other.md": { "assets/shared.png": 1 } },
      getFirstLinkpathDest: (link: string) => ({ path: link }),
    },
  };
  expect([...referencedEmbedImages(app as never, source as never, "")]).toEqual([
    "assets/shared.png",
  ]);
  expect(referencedEmbedImages(app as never, source as never, "![[assets/new.png]]")).toEqual(
    new Set(["assets/shared.png", "assets/new.png"]),
  );
});

it("keeps a notebook-only writing guide aligned as the live region grows and removes stale guides", () => {
  const doc = emptyDocument(),
    page = doc.pages[0];
  page.clips = [
    {
      id: "clip-guide",
      pageId: page.id,
      bounds: { minX: 40, minY: 60, maxX: 760, maxY: 300 },
      isExpandable: true,
      originY: 60,
      createdAt: 0,
      updatedAt: 0,
    },
  ];
  page.clips.push({
    ...page.clips[0],
    id: "clip-inactive",
    originY: 900,
    bounds: { minX: 40, minY: 900, maxX: 760, maxY: 1140 },
  });
  const guide = {
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    createSpan: vi.fn(),
    remove: vi.fn(),
    setCssStyles(style: Record<string, string>) {
      Object.assign(this.style, style);
    },
  };
  const surface = Object.create(InkSurface.prototype) as any;
  Object.assign(surface, {
    doc,
    handwritingGuideEls: new Map(),
    activeHandwritingRegionId: "clip-guide",
    selectionUiEl: { createDiv: vi.fn(() => guide) },
    boxForPage: () => ({ x: 10, y: 20 }),
  });
  Object.defineProperty(surface, "unitScale", { value: 2 });
  surface.syncHandwritingRegions();
  expect(guide.style).toMatchObject({
    left: "100px",
    top: "160px",
    width: "1440px",
    height: "480px",
  });
  expect(guide.setAttribute).toHaveBeenCalledWith("aria-hidden", "true");
  expect(surface.selectionUiEl.createDiv).toHaveBeenCalledOnce();
  page.strokes.push({
    id: "ink",
    color: "#000",
    size: 2,
    tool: "pen",
    pts: [100, 70, 1, 200, 800, 1],
  });
  surface.syncHandwritingRegions();
  expect(guide.style.height).toBe("1528px");
  page.clips = [];
  surface.syncHandwritingRegions();
  expect(guide.remove).toHaveBeenCalledOnce();
  expect(page.strokes).toHaveLength(1);
});

it("shows a single persistent handwriting guide instead of a second navigation flash", () => {
  const doc = emptyDocument(),
    page = doc.pages[0];
  const bounds = { minX: 40, minY: 60, maxX: 760, maxY: 300 };
  page.clips = [
    {
      id: "clip-active",
      pageId: page.id,
      bounds,
      originY: 60,
      isExpandable: true,
      createdAt: 0,
      updatedAt: 0,
    },
  ];
  const surface = Object.create(InkSurface.prototype) as any;
  const remove = vi.fn();
  Object.assign(surface, {
    doc,
    cssW: 800,
    cssH: 600,
    direction: "vertical",
    callbacks: {},
    pageLayout: { boxes: [{ index: 0, id: page.id, x: 0, y: 0, width: 800, height: 1100 }] },
    clipHighlightEl: { remove },
    scroller: { setPosition: vi.fn() },
    cancelShapeDraft: vi.fn(),
    cancelGroupDrag: vi.fn(),
    ensurePaperSize: vi.fn(),
    syncViewport: vi.fn(),
    reportStatus: vi.fn(),
    flashChrome: vi.fn(),
    flashRegion: vi.fn(),
    requestFrame: vi.fn(),
    scheduleHandwritingRegions: vi.fn(),
  });
  Object.defineProperty(surface, "scale", { value: 1 });
  surface.goToRegion(0, bounds);
  expect(surface.activeHandwritingRegionId).toBe("clip-active");
  expect(surface.flashRegion).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledOnce();
});

it("continues past a deleted region's invisible boundary and retains all source handwriting", () => {
  const doc = emptyDocument(),
    page = doc.pages[0];
  const active = {
    id: "clip-active",
    pageId: page.id,
    bounds: { minX: 40, minY: 60, maxX: 760, maxY: 300 },
    isExpandable: true,
    originY: 60,
    imagePath: "active.png",
    createdAt: 0,
    updatedAt: 0,
  };
  const deleted = {
    ...active,
    id: "clip-deleted",
    originY: 340,
    imagePath: "deleted.png",
    bounds: { ...active.bounds, minY: 340, maxY: 580 },
  };
  page.clips = [active, deleted];
  page.strokes.push(
    { id: "first-line", tool: "pen", color: "#000", size: 2, pts: [100, 80, 1, 200, 200, 1] },
    { id: "continuation", tool: "pen", color: "#000", size: 2, pts: [100, 350, 1, 200, 800, 1] },
  );
  expect(clipCurrentBounds(page, active).maxY).toBe(224);
  expect(updateHandwritingReferences(doc, new Set(["active.png"]), "book.notebook.md")).toBe(true);
  expect(clipCurrentBounds(page, active).maxY).toBe(824);
  const restored = parseInkFile(buildInkFile("", doc), 800).doc!;
  expect(restored.pages[0].clips![1].isUnreferenced).toBe(true);
  expect(clipCurrentBounds(restored.pages[0], restored.pages[0].clips![0]).maxY).toBe(824);
  expect(page.strokes).toHaveLength(2);
  expect(page.clips).toHaveLength(2);
  // A genuinely linked next block continues to isolate its own section.
  updateHandwritingReferences(doc, new Set(["active.png", "deleted.png"]), "book.notebook.md");
  expect(clipCurrentBounds(page, active).maxY).toBe(224);
});

it("keeps expandable region bounds anchored at allocated origin and margins without jumping", () => {
  const doc = emptyDocument(),
    page = doc.pages[0];
  const clip = {
    id: "clip-fixed",
    pageId: page.id,
    bounds: { minX: 40, minY: 100, maxX: 760, maxY: 340 },
    isExpandable: true,
    originY: 100,
    createdAt: 0,
    updatedAt: 0,
  };
  page.clips = [clip];

  // Empty bounds match allocated bounds
  expect(clipCurrentBounds(page, clip)).toEqual(clip.bounds);

  // Stroke near the top edge and left margin does NOT shift minY or minX
  page.strokes.push({
    id: "stroke-edge",
    tool: "pen",
    color: "#000",
    size: 2,
    pts: [42, 95, 1, 50, 110, 1],
  });
  const current = clipCurrentBounds(page, clip);
  expect(current.minY).toBe(100);
  expect(current.minX).toBe(40);
  expect(current.maxX).toBe(760);
});

it("does not jump pages when allocating reusable handwriting regions", () => {
  const doc = emptyDocument();
  doc.pages.push(blankPage("p2"), blankPage("p3"));
  const clipP0 = {
    id: "clip-p0",
    pageId: doc.pages[0].id,
    bounds: { minX: 40, minY: 60, maxX: 760, maxY: 300 },
    isExpandable: true,
    originY: 60,
    imagePath: "p0.png",
    createdAt: 0,
    updatedAt: 0,
  };
  doc.pages[0].clips = [clipP0];

  // When working on page 1 with no empty clips on page 1, it allocates on page 1 without jumping to page 0
  const allocation = allocateHandwritingRegion(doc, 1, new Set());
  expect(allocation.pageIndex).toBe(1);
  expect(allocation.reusableClip).toBeUndefined();

  // When an unreferenced empty clip exists on the preferred page, it reclaims on that page
  const clipP1 = {
    id: "clip-p1",
    pageId: doc.pages[1].id,
    bounds: { minX: 40, minY: 60, maxX: 760, maxY: 300 },
    isExpandable: true,
    originY: 60,
    imagePath: "p1.png",
    createdAt: 0,
    updatedAt: 0,
  };
  doc.pages[1].clips = [clipP1];
  const p1Allocation = allocateHandwritingRegion(doc, 1, new Set());
  expect(p1Allocation.pageIndex).toBe(1);
  expect(p1Allocation.reusableClip).toBe(clipP1);
});

it("provides inline notebook creation and smart suggestions in NotebookSuggestModal", async () => {
  const source = {
    path: "Physics/Notes.md",
    basename: "Notes",
    parent: { path: "Physics", isRoot: () => false },
  } as TFile;
  const existingNear = {
    path: "Physics/Mechanics.notebook.md",
    basename: "Mechanics.notebook",
    parent: { path: "Physics", isRoot: () => false },
  } as TFile;
  const existingFar = {
    path: "Math/Calculus.notebook.md",
    basename: "Calculus.notebook",
    parent: { path: "Math", isRoot: () => false },
  } as TFile;

  const plugin = {
    app: {
      vault: {
        getFolderByPath: () => ({ children: [] }),
        getRoot: () => ({ children: [] }),
        createFolder: vi.fn(async () => {}),
        create: vi.fn(async (path: string) => ({ path, basename: "New.notebook" })),
        getFileByPath: (p: string) => ({ path: p }),
      },
    },
    settings: {
      paperWidth: 800,
    },
  } as any;

  let chosenFile: TFile | null = null;
  const modal = new NotebookSuggestModal(
    plugin.app,
    plugin,
    source,
    [existingFar, existingNear],
    (file) => {
      chosenFile = file;
    },
  );

  // Suggestions with empty query: offers "+ Create new notebook: 'Notes'" and prioritizes same-folder notebooks
  const emptyQueryItems = modal.getSuggestions("");
  expect(emptyQueryItems[0]).toEqual({
    type: "create",
    title: "Notes",
    folder: "Physics",
  });
  expect(emptyQueryItems[1].type).toBe("existing");
  expect((emptyQueryItems[1] as any).file.path).toBe("Physics/Mechanics.notebook.md");
  expect((emptyQueryItems[1] as any).isSameFolder).toBe(true);

  // Suggestions with query: creates title from query and filters existing
  const queryItems = modal.getSuggestions("Calc");
  expect(queryItems[0]).toEqual({
    type: "create",
    title: "Calc",
    folder: "Physics",
  });
  expect(queryItems).toHaveLength(2);
  expect((queryItems[1] as any).file.path).toBe("Math/Calculus.notebook.md");

  // Choosing create creates a new notebook and resolves the file
  await modal.onChooseSuggestion(emptyQueryItems[0]);
  expect(plugin.app.vault.create).toHaveBeenCalled();
  expect(chosenFile).not.toBeNull();
});
