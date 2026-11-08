import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("obsidian", async () => ({
  ...(await import("./fake-obsidian")),
  Notice: vi.fn(),
  setIcon: vi.fn(),
}));

import { TFile } from "obsidian";
import {
  emptyDocument,
  blankPage,
  type InkDocument,
  type NotebookClip,
} from "../../src/model/document";
import { buildInkFile, parseInkFile, decodeDocument } from "../../src/model/serialize";
import { BLOCK_LABEL, LEGACY_BLOCK_LABEL } from "../../src/constants";
import {
  createBlockPage,
  isBlockPage,
  resolveBlockBounds,
  expandBlockPageIfNeeded,
} from "../../src/model/handwrite-block";
import {
  InlineHandwriteSession,
  getLastFailedSession,
} from "../../src/view/inline-handwrite";

function createMockCanvas(): any {
  const base: any = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    rect: () => {},
    clip: () => {},
    stroke: () => {},
    fill: () => {},
    fillRect: () => {},
    clearRect: () => {},
    strokeRect: () => {},
    fillText: () => {},
    measureText: () => ({ width: 10 }),
    setTransform: () => {},
    resetTransform: () => {},
    scale: () => {},
    translate: () => {},
    rotate: () => {},
    drawImage: () => {},
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: () => {},
    setLineDash: () => {},
    getLineDash: () => [],
  };
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

const mockWin: any = {
  addEventListener: () => {},
  removeEventListener: () => {},
  requestAnimationFrame: (cb: any) => setTimeout(cb, 0),
  cancelAnimationFrame: (id: any) => clearTimeout(id),
  setTimeout,
  clearTimeout,
  devicePixelRatio: 1,
  visualViewport: null,
};
(globalThis as any).window = mockWin;

function createMockEl(tag = "div"): any {
  const fakeDoc: any = {
    defaultView: mockWin,
    addEventListener: () => {},
    removeEventListener: () => {},
    createElementNS: (_ns: string, t: string) => createMockEl(t),
    createElement: (t: string) => createMockEl(t),
  };
  const classes = new Set<string>();
  const el: any = {
    tag,
    ownerDocument: fakeDoc,
    children: [],
    classList: {
      has: (cls: string) => classes.has(cls),
      contains: (cls: string) => classes.has(cls),
      add: (cls: string) => classes.add(cls),
      delete: (cls: string) => classes.delete(cls),
      remove: (cls: string) => classes.delete(cls),
    },
    dataset: {},
    style: { setProperty: () => {} },
    setCssProps: () => {},
    setCssStyles: () => {},
    empty: () => {
      el.children = [];
    },
    addClass: (cls: string) => classes.add(cls),
    removeClass: (cls: string) => classes.delete(cls),
    toggleClass: (cls: string, force?: boolean) => {
      const state = force !== undefined ? force : !classes.has(cls);
      if (state) classes.add(cls);
      else classes.delete(cls);
    },
    hasClass: (cls: string) => classes.has(cls),
    offsetWidth: 800,
    offsetHeight: 600,
    clientWidth: 800,
    clientHeight: 600,
    getBoundingClientRect: () => ({
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
    }),
    createDiv: () => {
      const child = createMockEl("div");
      el.children.push(child);
      return child;
    },
    createEl: (t: string) => {
      const child = createMockEl(t);
      el.children.push(child);
      return child;
    },
    createSvg: (t: string) => {
      const child = createMockEl(t);
      el.children.push(child);
      return child;
    },
    createSpan: () => {
      const child = createMockEl("span");
      el.children.push(child);
      return child;
    },
    setAttribute: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    append: (...nodes: any[]) => {
      el.children.push(...nodes);
    },
    appendChild: (child: any) => {
      el.children.push(child);
      return child;
    },
    remove: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    setText: (t: string) => {
      el.textContent = t;
    },
    getText: () => el.textContent ?? "",
  };
  if (tag === "canvas") {
    el.getContext = () => createMockCanvas();
    el.width = 800;
    el.height = 600;
  }
  return el;
}

class FakePath2D {
  moveTo() {}
  lineTo() {}
  closePath() {}
  arc() {}
  bezierCurveTo() {}
  quadraticCurveTo() {}
  rect() {}
}
(globalThis as any).Path2D = FakePath2D;

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = MockResizeObserver;

(globalThis as any).getComputedStyle = () => ({
  getPropertyValue: () => "",
});

const mockDoc = {
  body: createMockEl(),
  createElementNS: (_ns: string, tag: string) => createMockEl(tag),
  createElement: (tag: string) => createMockEl(tag),
  addEventListener: () => {},
  removeEventListener: () => {},
  defaultView: mockWin,
};
(globalThis as any).activeDocument = mockDoc;
(globalThis as any).document = mockDoc;
(globalThis as any).createEl = (tag: string) => createMockEl(tag);

const dataBlockRegex = new RegExp(`%%(?:${BLOCK_LABEL}|${LEGACY_BLOCK_LABEL})`, "g");

describe("Inline Handwrite Here persistence and safety", () => {
  let doc: InkDocument;
  let fileContent: string;
  const initialBody = "---\ntitle: Calculus Notes\n---\n# Chapter 3\n\nSome introductory text.";

  beforeEach(() => {
    doc = emptyDocument();
    doc.pages[0].strokes.push({
      id: "s-init",
      tool: "pen",
      color: "#000000",
      size: 2,
      pts: [100, 100, 0.5, 120, 120, 0.5],
    });
    fileContent = buildInkFile(initialBody, doc);
  });

  it("produces exactly one %%goodobsidian/finenotes data block across repeated saves", async () => {
    // Initial file has exactly 1 data block
    const matches1 = fileContent.match(dataBlockRegex);
    expect(matches1?.length).toBe(1);

    const notebookFile = {
      path: "Calculus.notebook.md",
      basename: "Calculus.notebook",
      stat: { mtime: 1000, size: fileContent.length },
    } as unknown as TFile;

    const fakeContainer = createMockEl();
    let currentVaultContent = fileContent;

    const fakeApp = {
      workspace: { getLeavesOfType: () => [] },
      vault: {
        read: vi.fn(async () => currentVaultContent),
        modify: vi.fn(async (_file: TFile, newText: string) => {
          currentVaultContent = newText;
        }),
        getAbstractFileByPath: () => null,
      },
    };

    const plugin = {
      settings: { paperWidth: 800, highlighterAlpha: 0.35 },
      embedManager: {
        refreshEmbedsForFile: vi.fn(),
        refreshEmbedImagesInDom: vi.fn(),
        pdfCache: {},
      },
    };

    // First session: add a dedicated block and save
    const { pageIndex } = createBlockPage(doc, "block-1");
    currentVaultContent = buildInkFile(initialBody, doc);

    const session1 = new InlineHandwriteSession({
      plugin: plugin as never,
      app: fakeApp as never,
      containerEl: fakeContainer,
      notebookFile,
      pageIndex,
      cropBounds: { minX: 0, minY: 0, maxX: 800, maxY: 360 },
      sourcePath: "Notes.md",
    });

    await session1.start();
    session1.currentPage?.strokes.push({
      id: "s1",
      tool: "pen",
      color: "#000000",
      size: 2,
      pts: [50, 50, 0.5, 60, 60, 0.5],
    });
    (session1 as any).isDirty = true;
    await session1.save();
    await session1.close();

    const matches2 = currentVaultContent.match(dataBlockRegex);
    expect(matches2?.length).toBe(1);
    expect(currentVaultContent).toContain(initialBody);

    // Second session on the same notebook: add more strokes and save again
    const session2 = new InlineHandwriteSession({
      plugin: plugin as never,
      app: fakeApp as never,
      containerEl: fakeContainer,
      notebookFile,
      pageIndex,
      cropBounds: { minX: 0, minY: 0, maxX: 800, maxY: 360 },
      sourcePath: "Notes.md",
    });

    await session2.start();
    session2.currentPage?.strokes.push({
      id: "s2",
      tool: "pen",
      color: "#000000",
      size: 2,
      pts: [70, 70, 0.5, 80, 80, 0.5],
    });
    (session2 as any).isDirty = true;
    await session2.save();
    await session2.close();

    const matches3 = currentVaultContent.match(dataBlockRegex);
    expect(matches3?.length).toBe(1);
    expect(currentVaultContent).toContain(initialBody);

    // Parse and verify all strokes survive
    const parsed = parseInkFile(currentVaultContent);
    expect(parsed.doc?.pages[pageIndex].strokes.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("grows dedicated block pages downward without clipping content or affecting other blocks", () => {
    const multiDoc = emptyDocument();
    const b1 = createBlockPage(multiDoc, "block-1", 800, 360);
    const b2 = createBlockPage(multiDoc, "block-2", 800, 360);

    expect(isBlockPage(b1.page)).toBe(true);
    expect(isBlockPage(b2.page)).toBe(true);
    expect(b1.page.geometry.height).toBe(360);
    expect(b2.page.geometry.height).toBe(360);

    // Drawing near bottom of block 1 expands block 1 only
    const expanded = expandBlockPageIfNeeded(b1.page, 340);
    expect(expanded).toBe(true);
    expect(b1.page.geometry.height).toBeGreaterThan(360);
    // Block 2 geometry is completely unaffected
    expect(b2.page.geometry.height).toBe(360);
  });

  it("detects external modifications and merges inline page edits cleanly", async () => {
    const notebookFile = {
      path: "Calculus.notebook.md",
      basename: "Calculus.notebook",
      stat: { mtime: 1000, size: fileContent.length },
    } as unknown as TFile;

    const fakeContainer = createMockEl();
    let currentVaultContent = fileContent;

    const fakeApp = {
      workspace: { getLeavesOfType: () => [] },
      vault: {
        read: vi.fn(async () => currentVaultContent),
        modify: vi.fn(async (_file: TFile, newText: string) => {
          currentVaultContent = newText;
        }),
        getAbstractFileByPath: () => null,
      },
    };

    const plugin = {
      settings: { paperWidth: 800, highlighterAlpha: 0.35 },
      embedManager: {
        refreshEmbedsForFile: vi.fn(),
        refreshEmbedImagesInDom: vi.fn(),
        pdfCache: {},
      },
    };

    const session = new InlineHandwriteSession({
      plugin: plugin as never,
      app: fakeApp as never,
      containerEl: fakeContainer,
      notebookFile,
      pageIndex: 0,
      cropBounds: { minX: 0, minY: 0, maxX: 800, maxY: 360 },
      sourcePath: "Notes.md",
    });

    await session.start();

    // Inline edit added
    session.currentPage?.strokes.push({
      id: "inline-stroke",
      tool: "pen",
      color: "#000",
      size: 2,
      pts: [10, 10, 0.5],
    });
    (session as any).isDirty = true;

    // Simulate concurrent external edit on disk (e.g. user added stroke or text externally)
    const externalDoc = decodeDocument(parseInkFile(fileContent).payload!);
    externalDoc.pages[0].title = "Renamed Externally";
    const externalContent = buildInkFile("# Updated body\n", externalDoc);
    currentVaultContent = externalContent;
    (notebookFile.stat as any).mtime = 2000; // Stat changed!

    // Save should detect mtime change and merge inline page into disk content
    const saved = await session.save();
    expect(saved).toBe(true);

    const parsedResult = parseInkFile(currentVaultContent);
    expect(parsedResult.body).toContain("# Updated body");
    expect(parsedResult.doc?.pages[0].strokes.some((s) => s.id === "inline-stroke")).toBe(true);

    await session.close();
  });

  it("retains unsaved ink in memory if save encounters an error", async () => {
    const notebookFile = {
      path: "Calculus.notebook.md",
      basename: "Calculus.notebook",
      stat: { mtime: 1000, size: fileContent.length },
    } as unknown as TFile;

    const fakeContainer = createMockEl();

    const fakeApp = {
      workspace: { getLeavesOfType: () => [] },
      vault: {
        read: vi.fn(async () => fileContent),
        modify: vi.fn(async () => {
          throw new Error("Disk full / permission denied");
        }),
        getAbstractFileByPath: () => null,
      },
    };

    const plugin = {
      settings: { paperWidth: 800, highlighterAlpha: 0.35 },
      embedManager: {
        refreshEmbedsForFile: vi.fn(),
        refreshEmbedImagesInDom: vi.fn(),
        pdfCache: {},
      },
    };

    const session = new InlineHandwriteSession({
      plugin: plugin as never,
      app: fakeApp as never,
      containerEl: fakeContainer,
      notebookFile,
      pageIndex: 0,
      cropBounds: { minX: 0, minY: 0, maxX: 800, maxY: 360 },
      sourcePath: "Notes.md",
    });

    await session.start();
    session.currentPage?.strokes.push({
      id: "critical-stroke",
      tool: "pen",
      color: "#000",
      size: 2,
      pts: [20, 20, 0.5],
    });
    (session as any).isDirty = true;

    const saveSuccess = await session.save();
    expect(saveSuccess).toBe(false);

    // Failed session state is preserved
    const failedSession = getLastFailedSession();
    expect(failedSession).toBe(session);
    expect(
      failedSession?.currentPage?.strokes.some((s) => s.id === "critical-stroke"),
    ).toBe(true);
  });

  it("preserves exact legacy multi-clip notebook bounds and behavior", () => {
    const legacyPage = blankPage("legacy-p1", { width: 800, height: 1200 });
    const clip1: NotebookClip = {
      id: "clip-1",
      pageId: legacyPage.id,
      bounds: { minX: 40, minY: 60, maxX: 760, maxY: 300 },
      isExpandable: true,
      originY: 60,
      createdAt: 100,
      updatedAt: 100,
    };
    const clip2: NotebookClip = {
      id: "clip-2",
      pageId: legacyPage.id,
      bounds: { minX: 40, minY: 320, maxX: 760, maxY: 600 },
      isExpandable: true,
      originY: 320,
      createdAt: 200,
      updatedAt: 200,
    };
    legacyPage.clips = [clip1, clip2];

    expect(isBlockPage(legacyPage)).toBe(false);

    // resolveBlockBounds falls back to legacy clipCurrentBounds
    const b1 = resolveBlockBounds(legacyPage, clip1);
    expect(b1).toEqual(clip1.bounds);

    const b2 = resolveBlockBounds(legacyPage, clip2);
    expect(b2).toEqual(clip2.bounds);
  });

  it("synchronizes seamlessly when backing notebook is open in an InkView leaf", async () => {
    const notebookFile = {
      path: "Calculus.notebook.md",
      basename: "Calculus.notebook",
      stat: { mtime: 1000, size: fileContent.length },
    } as unknown as TFile;

    const fakeContainer = createMockEl();

    const liveDoc = emptyDocument();
    const livePage = liveDoc.pages[0];
    const mockRequestSave = vi.fn();
    const mockRelayout = vi.fn();

    const mockInkView = {
      file: notebookFile,
      document: liveDoc,
      bodyText: "# Live Notebook Body",
      requestSave: mockRequestSave,
      relayoutSurface: mockRelayout,
    };

    const fakeApp = {
      workspace: {
        getLeavesOfType: () => [{ view: mockInkView }],
      },
      vault: {
        read: vi.fn(),
        modify: vi.fn(),
      },
    };

    const plugin = {
      settings: { paperWidth: 800, highlighterAlpha: 0.35 },
      embedManager: {
        refreshEmbedsForFile: vi.fn(),
        refreshEmbedImagesInDom: vi.fn(),
        pdfCache: {},
      },
    };

    const session = new InlineHandwriteSession({
      plugin: plugin as never,
      app: fakeApp as never,
      containerEl: fakeContainer,
      notebookFile,
      pageIndex: 0,
      cropBounds: { minX: 0, minY: 0, maxX: 800, maxY: 360 },
      sourcePath: "Notes.md",
    });

    await session.start();
    expect(session.document).toBe(liveDoc);

    // Add stroke in inline session
    session.currentPage?.strokes.push({
      id: "shared-stroke",
      tool: "pen",
      color: "#000",
      size: 2,
      pts: [15, 15, 0.5],
    });
    (session as any).isDirty = true;

    // Save delegates to mockInkView.requestSave()
    await session.save();
    expect(mockRequestSave).toHaveBeenCalled();
    expect(livePage.strokes.some((s) => s.id === "shared-stroke")).toBe(true);

    await session.close();
  });
});

