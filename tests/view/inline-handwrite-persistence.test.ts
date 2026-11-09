import { afterEach, describe, expect, it, vi } from "vitest";

const { surfaces, modalText } = vi.hoisted(() => ({
  surfaces: [] as { change: () => void; finish: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[],
  modalText: { value: "", select() {} },
}));

vi.mock("obsidian", async () => ({
  ...(await import("./fake-obsidian")),
  setIcon: vi.fn(),
  Modal: class {
    contentEl = { createEl: () => modalText };
    setTitle() {}
    open() {}
  },
}));
vi.mock("../../src/view/ink-surface", () => ({
  InkSurface: class {
    finishPointerInput = vi.fn();
    destroy = vi.fn();
    constructor(_host: unknown, _doc: unknown, _tools: unknown, _options: unknown, callbacks: { onChange: () => void }) {
      surfaces.push({ change: callbacks.onChange, finish: this.finishPointerInput, destroy: this.destroy });
    }
    setTool() {}
    setWritingGuides() {}
    writingGuideContext() { return { eligible: true, paper: "#ffffff", scale: 1 }; }
    layout() {}
  },
}));
vi.mock("../../src/view/toolbar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/view/toolbar")>();
  return {
    ...actual,
    Toolbar: class {
      syncActive = vi.fn();
      syncWritingGuides = vi.fn();
      destroy = vi.fn();
    },
  };
});

import { TFile } from "obsidian";
import { DEFAULT_SETTINGS } from "../../src/settings-data";
import { buildInkFile, parseInkFile } from "../../src/model/serialize";
import { blankPage, emptyDocument, type InkDocument, type Stroke } from "../../src/model/document";
import { createBlockPage } from "../../src/model/handwrite-block";
import { getActiveInlineSession, inlineToolbarOffset, InlineHandwriteSession } from "../../src/view/inline-handwrite";
import { waitForNotebookTransaction } from "../../src/view/notebook-transaction";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function host(): HTMLElement {
  const element = {
    isConnected: true,
    contains() { return false; },

    ownerDocument: { body: { classList: { contains: () => false } } },
    empty() {},
    addClass() {},
    removeClass() {},
    toggleClass() {},
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    createEl: () => host(),
    createSpan: () => host(),
    createDiv: () => host(),
    style: {},
    select() {},
  };
  return element as unknown as HTMLElement;
}

function stroke(id: string, y = 20.12345): Stroke {
  return { id, color: "#000000", size: 2, tool: "pen", pts: [25, y, 0.51] };
}

function setup() {
  const doc = emptyDocument();
  const block = createBlockPage(doc, "block-first");
  const other = createBlockPage(doc, "block-second");
  block.page.strokes.push(stroke("original"), stroke("erase"));
  block.clip.imagePath = "original-preview.png";
  let text = buildInkFile("# Notebook", doc);
  const file = { path: "Notes.notebook.md" } as TFile;
  let currentFile: TFile | null = file;
  let open = false;
  const process = vi.fn(async (_file: TFile, update: (value: string) => string) => {
    return text = update(text);
  });
  const create = vi.fn(async (_path: string, _data: string) => file);
  const read = vi.fn(async () => text);
  const openLinkText = vi.fn();
  const app = {
    vault: { process, create, read, getFileByPath: () => currentFile },
    workspace: { getLeavesOfType: () => open ? [{ view: { file } }] : [], openLinkText },
  };
  const onClosed = vi.fn();
  const containerEl = host();
  function session(blockId = block.page.id, container = containerEl) {
    return new InlineHandwriteSession({
      app: app as never, plugin: { settings: DEFAULT_SETTINGS } as never,
      containerEl: container, notebookFile: file, blockId, sourcePath: "Source.md", onClosed,
    });
  }
  return {
    file, process, create, read, session, containerEl, onClosed, openLinkText,
    setOpen: (value: boolean) => { open = value; },
    replaceFile: () => { currentFile = { path: file.path } as TFile; },
    external: (edit: (doc: InkDocument) => void, body = "# Notebook") => {
      const latest = parseInkFile(text).doc!;
      edit(latest);
      text = buildInkFile(body, latest);
    },
    setText: (value: string) => { text = value; },
    text: () => text,
    page: (id = block.page.id) => parseInkFile(text).doc!.pages.find((page) => page.id === id)!,
    otherId: other.page.id,
  };
}

function edit(session: InlineHandwriteSession, apply: (strokes: Stroke[]) => void) {
  apply(session.currentPage!.strokes);
  surfaces.at(-1)!.change();
}

afterEach(async () => {
  await getActiveInlineSession()?.close(true);
  surfaces.length = 0;
});

describe("inline handwriting persistence", () => {
  it("pins both toolbar rows to the viewport only within the handwriting block", () => {
    expect(inlineToolbarOffset(80, 160, 900, 76)).toBe(0);
    expect(inlineToolbarOffset(80, -400, 900, 76)).toBe(480);
    expect(inlineToolbarOffset(80, -820, 900, 76)).toBe(824);
    expect(inlineToolbarOffset(80, -820, 60, 76)).toBe(0);
  });

  it("keeps writing open on a tap outside the editor", async () => {
    const f = setup();
    const owner = Object.assign(new EventTarget(), { body: { classList: { contains: () => false } } });
    Object.defineProperty(f.containerEl, "ownerDocument", { value: owner });
    const session = f.session();
    await session.start();
    const tap = Object.assign(new Event("pointerdown"), { button: 0, isPrimary: true });
    owner.dispatchEvent(tap);
    expect(getActiveInlineSession()).toBe(session);
    expect(f.onClosed).not.toHaveBeenCalled();
    expect(await session.close()).toBe(true);
  });

  it("persists moved and duplicated selected ink in the inline block", async () => {
    const f = setup();
    const session = f.session();
    await session.start();
    edit(session, strokes => {
      strokes[0].pts[0] += 40;
      strokes.push({ ...structuredClone(strokes[0]), id: "duplicate" });
    });
    expect(await session.close()).toBe(true);
    expect(f.page().strokes.map(({ id, pts }) => [id, pts[0]])).toEqual([
      ["original", 65], ["erase", 25], ["duplicate", 65],
    ]);
  });

  it("saves guide-only edits per block and restores them on reopen", async () => {
    const f = setup();
    const session = f.session();
    await session.start();
    const { writingGuideHost } = session as unknown as {
      writingGuideHost(): import("../../src/view/writing-guides").WritingGuideHost;
    };
    const guides = writingGuideHost.call(session);
    guides.enable(true);
    guides.includeInPreview!(true);
    guides.configure({ style: "grid", spacing: 48 });
    expect(await session.close()).toBe(true);
    expect(f.page().clips![0].writingGuides).toMatchObject({
      enabled: true, includeInPreview: true, style: { style: "grid", spacing: 48 },
    });
    expect(f.page(f.otherId).clips![0].writingGuides).toBeUndefined();

    const reopened = f.session();
    await reopened.start();
    expect(writingGuideHost.call(reopened).state()).toMatchObject({
      enabled: true, includeInPreview: true, style: { style: "grid", spacing: 48 },
    });
  });

  it("merges local additions and erasures with external edits after a reorder, preserving body and page fields", async () => {
    const f = setup();
    const session = f.session();
    await session.start();
    edit(session, (strokes) => { strokes.pop(); strokes.push(stroke("local", 345)); });
    f.external((doc) => {
      const page = doc.pages[1];
      page.title = "Renamed externally";
      page.bookmarked = true;
      page.clips![0].imagePath = "renamed-preview.png";
      page.strokes.push(stroke("external"));
      doc.pages.reverse();
      doc.pages[0].title = "Other block";
    }, "---\ntags: [math]\n---\n# Externally edited");
    const body = parseInkFile(f.text()).body;
    expect(await session.close()).toBe(true);
    expect(parseInkFile(f.text()).body).toBe(body);
    expect(f.page()).toMatchObject({ title: "Renamed externally", bookmarked: true });
    expect(f.page().clips![0].imagePath).toBe("renamed-preview.png");
    expect(f.page().geometry.height).toBeGreaterThan(360);
    expect(f.page().strokes.map((s) => s.id)).toEqual(["original", "external", "local"]);
    expect(f.page(f.otherId).title).toBe("Other block");
    expect(f.page(f.otherId).geometry.height).toBe(360);
    expect(f.text().match(/%%goodobsidian/g)).toHaveLength(1);
  });

  it("keeps post-snapshot changes dirty and serializes concurrent saves and closes", async () => {
    const f = setup();
    const session = f.session();
    await session.start();
    edit(session, (strokes) => strokes.push(stroke("first")));
    const gate = deferred<void>();
    f.process.mockImplementationOnce(async (_file, update) => {
      await gate.promise;
      const text = update(f.text());
      f.setText(text);
      return text;
    });
    const save = session.save();
    expect(session.save()).toBe(save);
    edit(session, (strokes) => { strokes.pop(); strokes.push(stroke("second")); });
    const close = session.close();
    expect(session.close()).toBe(close);
    gate.resolve();
    expect(await save).toBe(true);
    expect(await close).toBe(false);
    expect(session.dirty).toBe(true);
    expect(f.page().strokes.map((s) => s.id)).toContain("first");
    expect(await session.close()).toBe(true);
    expect(f.page().strokes.map((s) => s.id)).toEqual(["original", "erase", "second"]);
    expect(f.onClosed).toHaveBeenCalledTimes(1);
  });

  it("leaves a conflicting stroke untouched, keeps the editor mounted and writes a recoverable copy", async () => {
    const f = setup();
    const session = f.session();
    await session.start();
    edit(session, (strokes) => { strokes[0].size = 7; });
    f.external((doc) => { doc.pages[1].strokes[0].size = 9; });
    const latest = f.text();
    expect(await session.close()).toBe(false);
    expect(f.text()).toBe(latest);
    expect(getActiveInlineSession()).toBe(session);
    expect(surfaces[0].destroy).not.toHaveBeenCalled();
    expect(f.onClosed).not.toHaveBeenCalled();
    const recovered = parseInkFile(f.create.mock.calls[0][1]).doc!.pages[0];
    expect(recovered.strokes[0].size).toBe(7);
    expect(recovered.clips![0].imagePath).toBeUndefined();
    await f.session(f.otherId, host()).start();
    expect(getActiveInlineSession()).toBe(session);
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(await session.close(true)).toBe(true);
    expect(surfaces[0].destroy).toHaveBeenCalledTimes(1);
  });

  it("fails safely if the full notebook is open initially or opens during a save", async () => {
    const f = setup();
    f.setOpen(true);
    await f.session().start();
    expect(f.read).not.toHaveBeenCalled();
    expect(getActiveInlineSession()).toBeNull();
    f.setOpen(false);
    const session = f.session();
    await session.start();
    edit(session, (strokes) => strokes.push(stroke("local")));
    const text = f.text();
    const gate = deferred<void>();
    f.process.mockImplementationOnce(async (_file, update) => {
      await gate.promise;
      return update(text);
    });
    const save = session.close();
    const ready = vi.fn();
    const loading = waitForNotebookTransaction(f.file).then(ready);
    expect(ready).not.toHaveBeenCalled();
    f.setOpen(true);
    gate.resolve();
    expect(await save).toBe(false);
    await loading;
    expect(ready).toHaveBeenCalled();
    expect(f.text()).toBe(text);
    f.setOpen(false);
    expect(await session.close()).toBe(true);
    expect(f.page().strokes.map((s) => s.id)).toContain("local");
  });

  it.each(["deleted block", "duplicated block", "replaced file", "unreadable payload", "future payload"])(
    "keeps local ink recoverable if the target becomes unsafe (%s)", async (condition) => {
      const f = setup();
      const session = f.session();
      await session.start();
      edit(session, (strokes) => strokes.push(stroke("local")));
      if (condition === "deleted block") f.external((doc) => { doc.pages.splice(1, 1, blankPage("replacement")); });
      if (condition === "duplicated block") f.external((doc) => { doc.pages.push(structuredClone(doc.pages[1])); });
      if (condition === "replaced file") f.replaceFile();
      if (condition === "unreadable payload") f.setText("# Sync in progress");
      if (condition === "future payload") f.setText(f.text().replace(/\nv\d+:/, "\nv999:"));
      const latest = f.text();
      expect(await session.close(true)).toBe(true);
      expect(f.text()).toBe(latest);
      expect(parseInkFile(f.create.mock.calls[0][1]).doc?.pages[0].strokes.at(-1)?.id).toBe("local");
    },
  );

  it("finishes wet ink before saving and offers copyable recovery if both writes fail on detach", async () => {
    const f = setup();
    const session = f.session();
    await session.start();
    surfaces[0].finish.mockImplementationOnce(() => edit(session, (strokes) => strokes.push(stroke("wet"))));
    f.process.mockRejectedValueOnce(new Error("Vault read-only"));
    f.create.mockRejectedValue(new Error("Vault read-only"));
    expect(await session.close(true)).toBe(false);
    expect(surfaces[0].destroy).not.toHaveBeenCalled();
    expect(parseInkFile(modalText.value).doc?.pages[0].strokes.at(-1)?.id).toBe("wet");
    expect(await session.close()).toBe(true);
    expect(f.page().strokes.at(-1)?.id).toBe("wet");
  });

  it("does not mount an editor if the embed disappears during loading", async () => {
    const f = setup();
    const gate = deferred<string>();
    f.read.mockReturnValueOnce(gate.promise);
    const session = f.session();
    const starting = session.start();
    expect(await session.close(true)).toBe(true);
    gate.resolve(f.text());
    await starting;
    expect(surfaces).toHaveLength(0);
    expect(getActiveInlineSession()).toBeNull();
  });
});
