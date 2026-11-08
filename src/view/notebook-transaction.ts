import type { App, TFile } from "obsidian";
import { VIEW_TYPE_INK } from "../constants";
import { editInkFile } from "../model/serialize";
import type { InkDocument } from "../model/document";
import type { InkView } from "./ink-view";

const pending = new WeakMap<TFile, Promise<string>>();
const owners = new WeakMap<TFile, Set<InkView>>();

export function claimNotebook(file: TFile, view: InkView): void {
  const views = owners.get(file) ?? new Set<InkView>();
  views.add(view);
  owners.set(file, views);
}

export function releaseNotebook(file: TFile, view: InkView): void {
  owners.get(file)?.delete(view);
}

export function notebookIsOpen(app: App, file: TFile): boolean {
  return (owners.get(file)?.size ?? 0) > 0 || app.workspace.getLeavesOfType(VIEW_TYPE_INK).some(({ view }) =>
    (view as InkView).file?.path === file.path);
}

export async function waitForNotebookTransaction(file: TFile): Promise<void> {
  // A rejected transaction leaves the notebook untouched.
  await pending.get(file)?.catch(() => undefined);
}

/** Serialize with other vault writes and keep an opening InkView from reading stale data. */
export async function editClosedNotebook(
  app: App,
  file: TFile,
  paperWidth: number,
  edit: (doc: InkDocument) => void,
): Promise<string> {
  const previous = pending.get(file);
  const write = Promise.resolve().then(async () => {
    await previous?.catch(() => undefined);
    return app.vault.process(file, (text) => {
      if (app.vault.getFileByPath(file.path) !== file) throw new Error("The backing notebook was removed or replaced.");
      if (notebookIsOpen(app, file)) throw new Error("Close the full notebook editor and retry.");
      return editInkFile(text, paperWidth, edit);
    });
  });
  pending.set(file, write);
  try {
    return await write;
  } finally {
    if (pending.get(file) === write) pending.delete(file);
  }
}
