import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { App, TFile } from "obsidian";
import { CompanionPdfManager } from "../../src/view/companion-pdf";
import { companionPdfSubject } from "../../src/export/companion-metadata";
import { companionIdFromBody } from "../../src/model/companion-pdf";
const ID = "a3f9211234567890";
async function pdf(id?: string) {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  if (id) doc.setSubject(companionPdfSubject(id));
  return doc.save();
}
function setup() {
  type File = {
    path: string;
    name: string;
    basename: string;
    extension: string;
    stat: { mtime: number; size: number };
  };
  const files = new Map<string, File>();
  const text = new Map<string, string>();
  const binary = new Map<string, Uint8Array>();
  const folders = new Set<string>();
  let clock = 1;
  const add = (path: string, data: string | Uint8Array) => {
    const name = path.split("/").pop()!;
    const file = {
      path,
      name,
      basename: name.slice(0, name.lastIndexOf(".")),
      extension: name.split(".").pop()!,
      stat: { mtime: clock++, size: data.length },
    };
    files.set(path, file);
    if (typeof data === "string") text.set(path, data);
    else binary.set(path, data);
    return file as unknown as TFile;
  };
  const move = async (file: File, to: string) => {
    if (files.has(to)) throw new Error("collision");
    const from = file.path;
    files.delete(from);
    file.path = to;
    file.name = to.split("/").pop()!;
    file.basename = file.name.slice(0, -4);
    files.set(to, file);
    if (binary.has(from)) {
      binary.set(to, binary.get(from)!);
      binary.delete(from);
    }
    if (text.has(from)) {
      text.set(to, text.get(from)!);
      text.delete(from);
    }
  };
  const vault = {
    getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    getFileByPath: (path: string) => files.get(path) ?? null,
    getFolderByPath: (path: string) => (folders.has(path) ? { path } : null),
    getFiles: () => [...files.values()],
    cachedRead: async (file: File) => text.get(file.path) ?? "",
    read: async (file: File) => text.get(file.path) ?? "",
    readBinary: vi.fn(async (file: File) => binary.get(file.path)!.slice().buffer),
    createFolder: vi.fn(async (path: string) => {
      folders.add(path);
    }),
    createBinary: vi.fn(async (path: string, bytes: ArrayBuffer) => {
      if (files.has(path)) throw new Error("collision");
      return add(path, new Uint8Array(bytes));
    }),
    rename: vi.fn(move),
    delete: vi.fn(async (file: File) => {
      files.delete(file.path);
      binary.delete(file.path);
    }),
  };
  const fileManager = {
    renameFile: vi.fn(move),
    trashFile: vi.fn(async (file: File) => {
      files.delete(file.path);
      binary.delete(file.path);
    }),
    processFrontMatter: vi.fn(async (file: File, apply: (fm: Record<string, unknown>) => void) => {
      const fm: Record<string, unknown> = {};
      apply(fm);
      text.set(
        file.path,
        `---\nfinenotes-companion-id: ${fm["finenotes-companion-id"]}\n---\n` +
          (text.get(file.path) ?? ""),
      );
    }),
  };
  const save = vi.fn(async () => {});
  const manager = new CompanionPdfManager({ vault, fileManager } as unknown as App, save);
  const note = add("School/Biology.notebook.md", `---\nfinenotes-companion-id: ${ID}\n---\nProse`);
  const snapshot = async () => ({
    fingerprint: "content",
    resources: [],
    export: async () => pdf(ID),
  });
  return {
    files,
    text,
    binary,
    folders,
    add,
    move,
    vault,
    fileManager,
    manager,
    note,
    snapshot,
    save,
  };
}
describe("Obsidian companion adapter", () => {
  it("disabled-by-default old notebooks have no registry or startup PDF scan", async () => {
    const s = setup();
    s.manager.load(undefined);
    await s.manager.recoverAll();
    expect(s.manager.store.entries).toEqual({});
    expect(s.vault.readBinary).not.toHaveBeenCalled();
    expect(s.save).not.toHaveBeenCalled();
  });
  it("creates a companion in the configured folder and preserves identity after reload", async () => {
    const s = setup();
    await s.manager.configure(s.note, s.text.get(s.note.path)!, "Exports", { enabled: true });
    await s.manager.update(ID, s.note, s.snapshot, false);
    const target = s.manager.entry(ID)!.pdfPath;
    expect(target).toBe(`Exports/Biology [FN-${ID.toUpperCase()}].pdf`);
    expect(s.binary.size).toBe(1);
    expect(s.manager.status(ID)).toBe("Up to date");
    const stored = structuredClone(s.manager.store);
    s.manager.load(stored);
    await s.manager.update(ID, s.note, s.snapshot, false);
    expect(s.vault.createBinary).toHaveBeenCalledOnce();
  });
  it("PDF rename/move follows vault events, including a custom name without the suffix", async () => {
    const s = setup();
    await s.manager.configure(s.note, s.text.get(s.note.path)!, undefined, { enabled: true });
    await s.manager.update(ID, s.note, s.snapshot, false);
    const old = s.manager.entry(ID)!.pdfPath;
    const file = s.files.get(old)!;
    await s.move(file, "Archive/My notes.pdf");
    await s.manager.renamed(file as unknown as TFile, old);
    expect(s.manager.entry(ID)!.pdfPath).toBe("Archive/My notes.pdf");
    await s.manager.update(
      ID,
      s.note,
      async () => ({ ...(await s.snapshot()), fingerprint: "changed" }),
      false,
    );
    expect(s.binary.size).toBe(1);
    expect(s.binary.has("Archive/My notes.pdf")).toBe(true);
  });
  it("recovers a PDF moved while the app was closed by its stable suffix and embedded ID", async () => {
    const s = setup();
    await s.manager.configure(s.note, s.text.get(s.note.path)!, undefined, { enabled: true });
    await s.manager.update(ID, s.note, s.snapshot, false);
    const old = s.manager.entry(ID)!.pdfPath;
    await s.move(s.files.get(old)!, `Offline/Biology [FN-${ID.toUpperCase()}].pdf`);
    s.manager.load(structuredClone(s.manager.store));
    await s.manager.update(ID, s.note, s.snapshot, false);
    expect(s.manager.entry(ID)!.pdfPath).toContain("Offline/");
    expect(s.binary.size).toBe(1);
  });
  it("notebook rename follows name via FileManager; notebook move preserves association", async () => {
    const s = setup();
    await s.manager.configure(s.note, s.text.get(s.note.path)!, undefined, { enabled: true });
    await s.manager.update(ID, s.note, s.snapshot, false);
    const from = s.note.path;
    await s.move(s.note as unknown as Parameters<typeof s.move>[0], "Elsewhere/Life.notebook.md");
    await s.manager.renamed(s.note, from);
    expect(s.manager.entry(ID)!.notebookPath).toBe(s.note.path);
    expect(s.manager.entry(ID)!.pdfPath).toBe(`School/Life [FN-${ID.toUpperCase()}].pdf`);
    expect(s.fileManager.renameFile).toHaveBeenCalledOnce();
    const next = s.note.path;
    await s.move(s.note as unknown as Parameters<typeof s.move>[0], "Third/Life.notebook.md");
    await s.manager.renamed(s.note, next);
    expect(s.binary.size).toBe(1);
  });
  it("custom path changes move the associated PDF and custom mode survives note renaming", async () => {
    const s = setup();
    await s.manager.configure(s.note, s.text.get(s.note.path)!, undefined, { enabled: true });
    await s.manager.update(ID, s.note, s.snapshot, false);
    await s.manager.configure(s.note, s.text.get(s.note.path)!, undefined, {
      pdfPath: "Archive/Custom.pdf",
      followName: false,
    });
    expect(s.binary.size).toBe(1);
    expect(s.manager.entry(ID)!.pdfPath).toBe(`Archive/Custom [FN-${ID.toUpperCase()}].pdf`);
    const old = s.note.path;
    await s.move(s.note as unknown as Parameters<typeof s.move>[0], "Renamed.notebook.md");
    await s.manager.renamed(s.note, old);
    expect(s.manager.entry(ID)!.pdfPath).toContain("Custom");
  });
  it("an offline notebook move is recovered from its frontmatter ID", async () => {
    const s = setup();
    await s.manager.configure(s.note, s.text.get(s.note.path)!, undefined, { enabled: true });
    await s.move(s.note as unknown as Parameters<typeof s.move>[0], "Offline/Biology.notebook.md");
    await s.manager.bind(ID, s.note);
    expect(s.manager.entry(ID)!.notebookPath).toBe(s.note.path);
  });
  it("copies with a duplicate notebook identity cannot share ownership", async () => {
    const s = setup();
    await s.manager.configure(s.note, s.text.get(s.note.path)!, undefined, { enabled: true });
    const copy = s.add("Copy.notebook.md", s.text.get(s.note.path)!);
    await expect(
      s.manager.configure(copy, s.text.get(copy.path)!, undefined, { enabled: true }),
    ).rejects.toThrow("Two notebooks");
  });
  it("unrelated target collisions are rejected and the user can still disable the companion", async () => {
    const s = setup();
    await s.manager.configure(s.note, s.text.get(s.note.path)!, undefined, { enabled: true });
    s.add("Taken.pdf", await pdf());
    await expect(
      s.manager.configure(s.note, s.text.get(s.note.path)!, undefined, { pdfPath: "Taken.pdf" }),
    ).rejects.toThrow("never silently overwritten");
    s.add(s.manager.entry(ID)!.pdfPath, await pdf());
    await s.manager.configure(s.note, s.text.get(s.note.path)!, undefined, { enabled: false });
    expect(s.manager.status(ID)).toBe("Disabled");
  });
  it("target deletion stays stale and notebook deletion never removes its PDF", async () => {
    const s = setup();
    await s.manager.configure(s.note, s.text.get(s.note.path)!, undefined, { enabled: true });
    await s.manager.update(ID, s.note, s.snapshot, false);
    await s.manager.deleted(s.note.path);
    expect(s.binary.size).toBe(1);
    expect(s.vault.delete).not.toHaveBeenCalledWith(s.note);
    const target = s.manager.entry(ID)!.pdfPath;
    s.files.delete(target);
    s.binary.delete(target);
    await s.manager.deleted(target);
    expect(s.manager.status(ID)).toContain("PDF missing");
    await expect(s.manager.update(ID, s.note, s.snapshot, false)).rejects.toThrow("PDF missing");
    await s.manager.update(ID, s.note, s.snapshot, true);
    expect(s.binary.size).toBe(1);
    expect(s.manager.entry(ID)!.pdfPath).toBe(target);
  });
  it("only enabling creates an identity; unrelated user prose remains intact", async () => {
    const s = setup();
    const old = s.add("Old.notebook.md", "My prose");
    const id = await s.manager.configure(old, "My prose", undefined, { enabled: true });
    expect(id).toMatch(/^[a-f0-9]{16}$/);
    expect(companionIdFromBody(s.text.get(old.path)!)).toBe(id);
    expect(s.text.get(old.path)).toContain("My prose");
  });
  it("folder rename updates both stored notebook and PDF paths", async () => {
    const s = setup();
    await s.manager.configure(s.note, s.text.get(s.note.path)!, undefined, { enabled: true });
    await s.manager.renamed({ path: "College" } as TFile, "School");
    expect(s.manager.entry(ID)!.notebookPath).toBe("College/Biology.notebook.md");
    expect(s.manager.entry(ID)!.pdfPath).toContain("College/");
  });
});

it("choosing another target recovers from an unrelated replacement without touching it", async () => {
  const s = setup();
  await s.manager.configure(s.note, s.text.get(s.note.path)!, undefined, { enabled: true });
  const occupied = s.manager.entry(ID)!.pdfPath;
  s.add(occupied, await pdf());
  await s.manager.configure(s.note, s.text.get(s.note.path)!, undefined, {
    pdfPath: "New.pdf",
    followName: false,
  });
  expect(s.files.has(occupied)).toBe(true);
  await s.manager.update(ID, s.note, s.snapshot, false);
  expect(s.binary.size).toBe(2);
  expect(s.manager.entry(ID)!.pdfPath).toContain("New [FN-");
});

it("a copied notebook cannot disable the original notebook's companion", async () => {
  const s = setup();
  await s.manager.configure(s.note, s.text.get(s.note.path)!, undefined, { enabled: true });
  const copy = s.add("Copy.notebook.md", s.text.get(s.note.path)!);
  await expect(
    s.manager.configure(copy, s.text.get(copy.path)!, undefined, { enabled: false }),
  ).rejects.toThrow("Two notebooks");
  expect(s.manager.entry(ID)!.enabled).toBe(true);
});

it("offline renaming away the suffix never silently creates a second PDF on close", async () => {
  const s = setup();
  await s.manager.configure(s.note, s.text.get(s.note.path)!, undefined, { enabled: true });
  await s.manager.update(ID, s.note, s.snapshot, false);
  const old = s.manager.entry(ID)!.pdfPath;
  await s.move(s.files.get(old)!, "Offline/New name.pdf");
  await expect(s.manager.update(ID, s.note, s.snapshot, false)).rejects.toThrow("PDF missing");
  expect(s.binary.size).toBe(1);
  await s.manager.configure(s.note, s.text.get(s.note.path)!, undefined, {
    pdfPath: "Offline/New name.pdf",
    followName: false,
  });
  await s.manager.update(ID, s.note, s.snapshot, false);
  expect(s.binary.size).toBe(1);
  expect(s.manager.entry(ID)!.pdfPath).toBe("Offline/New name.pdf");
});

it("rapid configuration of an old notebook creates one stable identity and applies the last toggle", async () => {
  const s = setup();
  const note = s.add("New.notebook.md", "Prose");
  const first = s.manager.configure(note, "Prose", undefined, { enabled: true });
  const second = s.manager.configure(note, "Prose", undefined, { enabled: false });
  const ids = await Promise.all([first, second]);
  expect(ids[0]).toBe(ids[1]);
  expect(Object.keys(s.manager.store.entries)).toHaveLength(1);
  expect(s.fileManager.processFrontMatter).toHaveBeenCalledOnce();
  expect(s.manager.entry(ids[0])!.enabled).toBe(false);
});
