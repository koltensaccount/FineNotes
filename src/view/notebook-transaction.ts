import { type App, type TFile } from "obsidian";
import { VIEW_TYPE_INK } from "../constants";
import type { InkDocument } from "../model/document";
import { devicePagesFolderOf, isDevicePagesPayload, notebookIdOf } from "../model/device-pages";
import { buildInkFile, parseInkFile } from "../model/serialize";
import { readDevicePagesFolder, rememberNotebookId } from "./device-pages-files";
import { DevicePagesSession, deviceIdOf } from "./device-pages-session";

const activeLocks = new Map<string, Promise<unknown>>();

export function notebookIsOpen(app: App, file: TFile): boolean {
  return app.workspace
    .getLeavesOfType(VIEW_TYPE_INK)
    .some((leaf) => (leaf.view as { file?: TFile | null })?.file?.path === file.path);
}

/**
 * Reads a closed notebook whether it uses the single-file format or the
 * per-device page-files layout (`DevicePages`).
 */
export async function readClosedNotebook(
  app: App,
  file: TFile,
  paperWidth: number,
): Promise<InkDocument> {
  const raw = await app.vault.read(file);
  const parsed = parseInkFile(raw, paperWidth);
  if (parsed.doc) return parsed.doc;
  if (parsed.payload && isDevicePagesPayload(parsed.payload)) {
    const id = notebookIdOf(parsed.payload);
    rememberNotebookId(file.path, id);
    if (id) {
      const folder = devicePagesFolderOf(file.path, id);
      const joined = await readDevicePagesFolder(app, parsed.payload, folder, paperWidth);
      if (joined) return joined;
    }
  }
  throw new Error("Could not read notebook ink data.");
}

/**
 * Serialized read-modify-write transaction for a closed backing notebook.
 * Supports both classic single-file notebooks and `DevicePages` notebooks, and
 * prevents concurrent inline sessions or commands from clobbering each other.
 */
export async function editClosedNotebook<T>(
  app: App,
  file: TFile,
  paperWidth: number,
  mutate: (doc: InkDocument) => T | Promise<T>,
  changedPageIds?: ReadonlySet<string> | null,
): Promise<T> {
  const key = file.path;
  const prev = activeLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => {
    release = r;
  });
  activeLocks.set(
    key,
    prev.then(() => next),
  );

  await prev;
  try {
    if (notebookIsOpen(app, file)) {
      throw new Error("Close the full notebook editor before writing inline.");
    }
    const raw = await app.vault.read(file);
    const parsed = parseInkFile(raw, paperWidth);

    if (parsed.doc) {
      const result = await mutate(parsed.doc);
      if (notebookIsOpen(app, file)) {
        throw new Error("The notebook was opened in another tab while saving.");
      }
      const updated = buildInkFile(parsed.body, parsed.doc);
      await app.vault.modify(file, updated);
      return result;
    }

    if (parsed.payload && isDevicePagesPayload(parsed.payload)) {
      const id = notebookIdOf(parsed.payload);
      rememberNotebookId(file.path, id);
      if (!id) throw new Error("The handwriting notebook could not be read.");
      const folder = devicePagesFolderOf(file.path, id);
      const session = new DevicePagesSession(
        app,
        file.path,
        parsed.payload,
        folder,
        deviceIdOf(app),
      );
      const texts = await session.readFiles();
      const load = session.load(texts, paperWidth);
      const result = await mutate(load.doc);
      if (notebookIsOpen(app, file)) {
        throw new Error("The notebook was opened in another tab while saving.");
      }
      await session.save(load.doc, changedPageIds ?? null);
      return result;
    }

    throw new Error("The handwriting notebook could not be read.");
  } finally {
    release();
    if (activeLocks.get(key) === next) activeLocks.delete(key);
  }
}
