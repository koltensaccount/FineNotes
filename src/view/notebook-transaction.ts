import { type App, type TFile } from "obsidian";
import { VIEW_TYPE_INK } from "../constants";
import type { InkDocument } from "../model/document";
import { buildInkFile, parseInkFile } from "../model/serialize";

const activeLocks = new Map<string, Promise<unknown>>();

export function notebookIsOpen(app: App, file: TFile): boolean {
  return app.workspace
    .getLeavesOfType(VIEW_TYPE_INK)
    .some((leaf) => (leaf.view as { file?: TFile | null })?.file?.path === file.path);
}

/**
 * Serialized read-modify-write transaction for a closed backing notebook.
 * Prevents concurrent inline sessions or commands from clobbering each other.
 */
export async function editClosedNotebook<T>(
  app: App,
  file: TFile,
  paperWidth: number,
  mutate: (doc: InkDocument) => T | Promise<T>,
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
    if (!parsed.doc) throw new Error("The handwriting notebook could not be read.");
    const result = await mutate(parsed.doc);
    if (notebookIsOpen(app, file)) {
      throw new Error("The notebook was opened in another tab while saving.");
    }
    const updated = buildInkFile(parsed.body, parsed.doc);
    await app.vault.modify(file, updated);
    return result;
  } finally {
    release();
    if (activeLocks.get(key) === next) activeLocks.delete(key);
  }
}
