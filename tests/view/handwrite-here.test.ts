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
} from "../../src/model/region-allocation";
import { emptyDocument, blankPage } from "../../src/model/document";
import {
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
  };
  Object.assign(view, {
    file,
    surface,
    doc,
    guard: { locked: false },
    latestDrawingAt: 0,
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
        getAbstractFileByPath: () => image,
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
  doc.pages[0].strokes.push({
    id: "ink",
    color: "#000",
    size: 2,
    tool: "pen",
    pts: [100, 70, 1, 200, 800, 1],
  });
  await view.refreshEmbedImages();
  expect(renderClipPng).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ maxY: 824 }),
    expect.objectContaining({ includeBackground: false }),
  );
  expect(view.app.vault.modifyBinary).toHaveBeenCalledWith(image, expect.any(ArrayBuffer));
  expect(view.plugin.embedManager.refreshEmbedImagesInDom).toHaveBeenCalledWith(image);
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
    selectionUiEl: { createDiv: () => guide },
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
  page.strokes.push({
    id: "ink",
    color: "#000",
    size: 2,
    tool: "pen",
    pts: [100, 70, 1, 200, 800, 1],
  });
  surface.syncHandwritingRegions();
  expect(guide.style.height).toBe("1540px");
  page.clips = [];
  surface.syncHandwritingRegions();
  expect(guide.remove).toHaveBeenCalledOnce();
  expect(page.strokes).toHaveLength(1);
});
