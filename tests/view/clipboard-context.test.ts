import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clipboardMarker,
  PasteGate,
  readSystemClipboard,
  imageFileOf,
} from "../../src/view/clipboard-read";
import { blankPage } from "../../src/model/document";
import { placeImageBox } from "../../src/model/images";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { InkSurface } = await import("../../src/view/ink-surface");
const { InkView } = await import("../../src/view/ink-view");
type State = Record<string, unknown>;
const call = <T = unknown>(state: State, name: string, ...args: unknown[]): T =>
  (state[name] as (...args: unknown[]) => T).apply(state, args);
function setup() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const read = vi.fn().mockRejectedValue(new Error("permission"));
  vi.stubGlobal("navigator", { clipboard: { read, writeText } });
  const onPasteImage = vi.fn();
  const onNativePaste = vi.fn();
  const paste = vi.fn().mockReturnValue(true);
  const surface: State = Object.assign(Object.create(InkSurface.prototype) as State, {
    doc: { pages: [{ id: "page" }] },
    pasteGate: new PasteGate(),
    pasteRequest: null,
    pasteTimer: 0,
    lastPastePoint: { pageId: "page", at: { x: 123, y: 321 } },
    imagesShown: true,
    callbacks: { onPasteImage, onNativePaste },
    editingTextView: () => null,
    cropping: null,
    paste,
    syncActionBar: vi.fn(),
    liveImageSelection: () => null,
    liveSelection: () => ({
      strokes: [{ id: "s1", pts: [0, 0, 0.5, 10, 0, 0.5] }],
      images: [],
      textBoxes: [],
    }),
    groupBounds: () => ({ minX: 0, minY: 0, maxX: 10, maxY: 10 }),
  });
  call(surface, "copySelection");
  const marker = writeText.mock.calls[0][0] as string;
  const event = (file: File | null, text = "", target: unknown = null) => ({
    target,
    clipboardData: { files: file ? [file] : [], items: [], getData: () => text },
    preventDefault: vi.fn(),
  });
  return { surface, onPasteImage, onNativePaste, paste, read, marker, event };
}
const item = (file: File, text = "") => ({
  types: [file.type, ...(text ? ["text/plain"] : [])],
  getType: async (type: string) => (type === "text/plain" ? new Blob([text]) : file),
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("clipboard context integration", () => {
  it.each(["image/png", "image/jpeg", "image/webp"])(
    "accepts native %s even with a fresh local selection",
    (mime) => {
      const s = setup();
      const file = new File(["pixels"], "capture", { type: mime });
      const e = s.event(file);
      expect(call(s.surface, "handlePaste", e)).toBe(true);
      expect(e.preventDefault).toHaveBeenCalledOnce();
      expect(s.onPasteImage).toHaveBeenCalledExactlyOnceWith(file, s.surface.lastPastePoint);
      expect(s.paste).not.toHaveBeenCalled();
    },
  );
  it("matching selection marker takes priority over its PNG representation", () => {
    const s = setup();
    call(
      s.surface,
      "handlePaste",
      s.event(new File(["png"], "copy.png", { type: "image/png" }), s.marker),
    );
    expect(s.paste).toHaveBeenCalledWith(s.surface.lastPastePoint);
    expect(s.onPasteImage).not.toHaveBeenCalled();
  });
  it("other-session or stale markers cannot replace external images", () => {
    const s = setup();
    call(
      s.surface,
      "handlePaste",
      s.event(new File(["png"], "external.png", { type: "image/png" }), clipboardMarker(-1)),
    );
    expect(s.onPasteImage).toHaveBeenCalledOnce();
    expect(s.paste).not.toHaveBeenCalled();
  });
  it("keeps text fields and text-box editing native", () => {
    const s = setup();
    expect(call(s.surface, "handlePaste", s.event(null, "", { tagName: "TEXTAREA" }))).toBe(false);
    s.surface.editingTextView = () => ({});
    expect(call(s.surface, "handlePaste", s.event(null))).toBe(false);
    expect(s.paste).not.toHaveBeenCalled();
  });
  it("starts a keyboard read synchronously, then native paste beats the late API result without duplicating", async () => {
    const s = setup();
    const file = new File(["png"], "shot.png", { type: "image/png" });
    let resolve!: (items: unknown[]) => void;
    s.read.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    call(s.surface, "clipboardKey", { key: "v" });
    expect(s.read).toHaveBeenCalledOnce();
    call(s.surface, "handlePaste", s.event(file));
    resolve([item(file)]);
    await vi.runAllTimersAsync();
    expect(s.onPasteImage).toHaveBeenCalledOnce();
    expect(s.paste).not.toHaveBeenCalled();
  });
  it("the API result also suppresses a following native event", async () => {
    const s = setup();
    const file = new File(["png"], "shot.png", { type: "image/png" });
    s.read.mockResolvedValue([item(file)]);
    call(s.surface, "requestPaste", s.surface.lastPastePoint, true);
    await vi.runAllTimersAsync();
    call(s.surface, "handlePaste", s.event(file));
    expect(s.onPasteImage).toHaveBeenCalledOnce();
  });
  it("a new paste request can insert again", async () => {
    const s = setup();
    const file = new File(["png"], "shot.png", { type: "image/png" });
    s.read.mockResolvedValue([item(file)]);
    call(s.surface, "requestPaste", s.surface.lastPastePoint, true);
    await vi.runAllTimersAsync();
    call(s.surface, "requestPaste", s.surface.lastPastePoint, true);
    await vi.runAllTimersAsync();
    expect(s.onPasteImage).toHaveBeenCalledTimes(2);
  });
  it("denied menu reads offer native Paste when no local selection is available", async () => {
    const s = setup();
    s.surface.liveSelection = () => ({ strokes: [], images: [], textBoxes: [] });
    call(s.surface, "copySelection");
    call(s.surface, "requestPaste", s.surface.lastPastePoint, true);
    await vi.runAllTimersAsync();
    expect(s.onNativePaste).toHaveBeenCalledOnce();
    const file = new File(["png"], "native.png", { type: "image/png" });
    s.onNativePaste.mock.calls[0][0](file);
    expect(s.onPasteImage).toHaveBeenCalledWith(file, s.surface.lastPastePoint);
  });
  it("denied reads still allow the established local selection fallback", async () => {
    const s = setup();
    call(s.surface, "requestPaste", s.surface.lastPastePoint, true);
    await vi.runAllTimersAsync();
    expect(s.paste).toHaveBeenCalledOnce();
    expect(s.onNativePaste).not.toHaveBeenCalled();
  });
  it("cancelling the surface invalidates delayed reads and fallback callbacks", async () => {
    const s = setup();
    const file = new File(["png"], "late.png", { type: "image/png" });
    s.read.mockResolvedValue([item(file)]);
    call(s.surface, "requestPaste", {}, true);
    (s.surface.pasteGate as PasteGate).cancel();
    s.surface.pasteRequest = null;
    await vi.runAllTimersAsync();
    expect(s.onPasteImage).not.toHaveBeenCalled();
  });
  it("protected surfaces refuse both clipboards", () => {
    const s = setup();
    (s.surface.callbacks as Record<string, unknown>).isLocked = () => true;
    call(s.surface, "handlePaste", s.event(new File(["x"], "x.png", { type: "image/png" })));
    expect(s.onPasteImage).not.toHaveBeenCalled();
    expect(s.paste).not.toHaveBeenCalled();
  });
  it("uses visible page centre when no interaction point exists", () => {
    const s = setup();
    const page = blankPage();
    s.surface.doc = { pages: [page] };
    s.surface.lastPastePoint = {};
    s.surface.pageIndex = 0;
    s.surface.visibleRegion = () => ({ minX: 20, minY: 40, maxX: 220, maxY: 440 });
    expect(call(s.surface, "clipboardTarget")).toEqual({ pageId: page.id, at: { x: 120, y: 240 } });
  });
});
describe("image clipboard adapters", () => {
  it.each(["image/png", "image/jpeg", "image/webp"])(
    "reads exposed %s pixels and preserves MIME",
    async (type) => {
      const file = new File(["pixels"], "image", { type });
      vi.stubGlobal("navigator", { clipboard: { read: () => Promise.resolve([item(file)]) } });
      const read = await readSystemClipboard();
      expect(read.file?.type).toBe(type);
      expect(await read.file?.text()).toBe("pixels");
    },
  );
  it("reads an image from DataTransfer items when files is empty", () => {
    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    expect(
      imageFileOf({
        files: [],
        items: [{ kind: "file", type: file.type, getAsFile: () => file }],
      } as unknown as DataTransfer),
    ).toBe(file);
  });
  it("handles missing APIs and synchronous permission exceptions as rejection", async () => {
    vi.stubGlobal("navigator", {});
    await expect(readSystemClipboard()).rejects.toThrow();
    vi.stubGlobal("navigator", {
      clipboard: {
        read: () => {
          throw new Error("permission");
        },
      },
    });
    await expect(readSystemClipboard()).rejects.toThrow("permission");
  });
  it("gate invalidates stale and already-consumed requests", () => {
    const g = new PasteGate();
    const old = g.begin();
    const next = g.begin();
    expect(g.claim(old)).toBe(false);
    expect(g.claim(next)).toBe(true);
    expect(g.claim(next)).toBe(false);
    const last = g.begin();
    g.cancel();
    expect(g.claim(last)).toBe(false);
  });
  it("centres the normal bounded image placement at the interaction point", () => {
    const page = blankPage().geometry;
    const box = placeImageBox({ width: 100, height: 80 }, page, null, undefined, {
      x: 123,
      y: 321,
    });
    expect(box).toMatchObject({ x: 73, y: 281 });
    const edge = placeImageBox({ width: 100, height: 80 }, page, null, undefined, { x: 1, y: 1 });
    expect(edge.x).toBe(0);
    expect(edge.y).toBe(0);
  });
  it("routes clipboard pixels through the existing insert pipeline with a stable page and selection defaults", async () => {
    const bytes = new ArrayBuffer(5);
    const file = new File(["png"], "shot.png", { type: "image/png" });
    vi.spyOn(file, "arrayBuffer").mockResolvedValue(bytes);
    const insertImageBytes = vi.fn().mockResolvedValue(null);
    const view = Object.assign(Object.create(InkView.prototype) as State, {
      file: {},
      surface: { document: { pages: [{ id: "page" }] }, currentPage: 0 },
      insertImageBytes,
    });
    await call(view, "pastePictureFile", file, { pageId: "page", at: { x: 12, y: 34 } });
    expect(insertImageBytes).toHaveBeenCalledWith(bytes, "image/png", "shot.png", {
      pageIndex: 0,
      pageId: "page",
      at: { x: 12, y: 34 },
    });
  });
  it("does not import delayed bytes into another note", async () => {
    let resolve!: (bytes: ArrayBuffer) => void;
    const file = new File(["png"], "late.png", { type: "image/png" });
    vi.spyOn(file, "arrayBuffer").mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const insertImageBytes = vi.fn();
    const view = Object.assign(Object.create(InkView.prototype) as State, {
      file: {},
      surface: {},
      insertImageBytes,
    });
    const waiting = call<Promise<void>>(view, "pastePictureFile", file);
    view.file = {};
    resolve(new ArrayBuffer(0));
    await waiting;
    expect(insertImageBytes).not.toHaveBeenCalled();
  });
});

describe("context actions reuse existing selection commands", () => {
  function context(selected = true) {
    const s = setup();
    const openMenu = vi.fn();
    const openPressMenu = vi.fn();
    Object.assign(s.surface, {
      targetAt: () => ({ pageId: "page", at: { x: 5, y: 5 } }),
      stopPress: vi.fn(),
      cancelImageDrag: vi.fn(),
      cancelGroupDrag: vi.fn(),
      scroller: { cancel: vi.fn() },
      actionBar: { openMenu },
      liveSelection: () =>
        selected ? { pageId: "page", strokes: [], images: [], textBoxes: [] } : null,
      boxForPage: () => ({ index: 0 }),
      openPressMenu,
    });
    return { ...s, openMenu, openPressMenu };
  }
  it("keeps a selected group and opens its action menu at a hold inside its bounds", () => {
    const s = context();
    call(s.surface, "contextAt", 100, 200);
    expect(s.openMenu).toHaveBeenCalledOnce();
    expect(s.openPressMenu).not.toHaveBeenCalled();
    expect(s.surface.fingerTap).toBeNull();
    expect(s.surface.lastPastePoint).toEqual({ pageId: "page", at: { x: 5, y: 5 } });
  });
  it("empty paper uses the existing Press menu", () => {
    const s = context(false);
    call(s.surface, "contextAt", 100, 200);
    expect(s.openPressMenu).toHaveBeenCalledWith({ index: 0 }, { x: 5, y: 5 });
    expect(s.openMenu).not.toHaveBeenCalled();
  });
  it("a right-click outside the current selection opens Paste instead", () => {
    const s = context();
    s.surface.targetAt = () => ({ pageId: "page", at: { x: 100, y: 100 } });
    call(s.surface, "contextAt", 100, 100);
    expect(s.openPressMenu).toHaveBeenCalledOnce();
    expect(s.openMenu).not.toHaveBeenCalled();
  });
  it("Cut/Copy/Duplicate/Delete invoke the existing command methods; Paste is available for external pictures", () => {
    const s = context();
    const cut = vi.fn(),
      copy = vi.fn(),
      duplicate = vi.fn(),
      remove = vi.fn(),
      request = vi.fn();
    Object.assign(s.surface, {
      cutSelection: cut,
      copySelection: copy,
      duplicateSelection: duplicate,
      deleteSelection: remove,
      requestPaste: request,
    });
    const actions = call<{ id: string; run?: () => void; enabled?: boolean; menu?: string }[]>(
      s.surface,
      "groupActions",
      { pageId: "page", strokes: [], images: [], textBoxes: [] },
    );
    for (const id of ["cut", "copy", "duplicate", "delete", "paste"])
      actions.find((a) => a.id === id)?.run?.();
    expect(cut).toHaveBeenCalledOnce();
    expect(copy).toHaveBeenCalledOnce();
    expect(duplicate).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith({ pageId: "page", at: { x: 123, y: 321 } }, true);
    expect(actions.find((a) => a.id === "cut")?.menu).toBe("tile");
  });
});

it("clipboard image placement uses InsertImage and selects the result by default", () => {
  const page = blankPage();
  const doc = { pages: [page] };
  const applyCommand = vi.fn();
  const selectImage = vi.fn();
  const view = Object.assign(Object.create(InkView.prototype) as State, {
    surface: {
      document: doc,
      currentPage: 0,
      visibleRegion: () => null,
      applyCommand,
      selectImage,
    },
    isProtected: () => false,
  });
  const placed = call<{ id: string; x: number; y: number }>(
    view,
    "placeImage",
    "attachments/shot.png",
    100,
    80,
    { pageId: page.id, at: { x: 123, y: 321 } },
  );
  expect(placed).toMatchObject({ x: 73, y: 281 });
  expect(applyCommand.mock.calls[0][0].constructor.name).toBe("InsertImage");
  expect(selectImage).toHaveBeenCalledExactlyOnceWith(page.id, placed.id);
  expect(
    call(view, "placeImage", "attachments/shot.png", 100, 80, { pageId: "deleted" }),
  ).toBeNull();
  expect(applyCommand).toHaveBeenCalledOnce();
});
