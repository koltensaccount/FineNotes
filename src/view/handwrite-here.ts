/**
 * "Handwrite here" command for Markdown notes:
 * 1. Reuses the backing `.notebook.md` already linked in the note (if any), or
 *    creates `<NoteName>.notebook.md` in the configured inline handwriting
 *    folder (default: Obsidian's attachments folder).
 * 2. Appends a compact expandable `hw-<8-hex>` sketch page (transparent by default).
 * 3. Inserts a standard `![[Notebook#id=hw-<8-hex>]]` embed at the cursor.
 * 4. Activates inline editing immediately via `PageEmbeds`.
 */

import { type Editor, MarkdownView, Notice, TFile, normalizePath } from "obsidian";
import type GoodObsidianPlugin from "../main";
import { emptyDocument } from "../model/document";
import {
  INLINE_SKETCH_PREFIX,
  createInlineSketchPage,
  findLinkedNotebookInMarkdown,
} from "../model/inline-sketch";
import {
  cleanTitle,
  joinVaultPath,
  newNoteBody,
  normalizeFolder,
  stripInkSuffix,
} from "../model/new-notebook";
import { buildInkFile } from "../model/serialize";
import { HandwriteSetupModal, InlineNotebookPickerModal } from "./handwrite-modals";
import { embedInsertion } from "./page-embed-model";
import { editClosedNotebook, notebookIsOpen } from "./notebook-transaction";

function newSketchId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return INLINE_SKETCH_PREFIX + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function ensureFolder(plugin: GoodObsidianPlugin, folder: string): Promise<void> {
  if (!folder || plugin.app.vault.getFolderByPath(folder)) return;
  try {
    await plugin.app.vault.createFolder(folder);
  } catch {
    /* Folder may have been created concurrently. */
  }
}

async function createBackingNotebook(
  plugin: GoodObsidianPlugin,
  sourcePath: string,
  preferredName?: string,
): Promise<TFile> {
  const { app } = plugin;
  const base = cleanTitle(stripInkSuffix(preferredName ?? "Handwriting")) || "Handwriting";
  const fileName = `${base}.notebook.md`;
  const customFolder = normalizeFolder(plugin.settings.inlineHandwriteFolder ?? "");
  let targetPath: string;
  if (customFolder) {
    await ensureFolder(plugin, customFolder);
    targetPath = normalizePath(joinVaultPath(customFolder, fileName));
  } else {
    targetPath = normalizePath(
      await app.fileManager.getAvailablePathForAttachment(fileName, sourcePath),
    );
    const parent = targetPath.includes("/") ? targetPath.slice(0, targetPath.lastIndexOf("/")) : "";
    await ensureFolder(plugin, parent);
  }

  const found = app.vault.getFileByPath(targetPath);
  if (found) return found;

  const doc = emptyDocument(plugin.settings.paperWidth);
  doc.pages = [];
  const body = newNoteBody(base, new Date().toISOString());
  return app.vault.create(targetPath, buildInkFile(body, doc));
}

async function resolveBackingNotebook(
  plugin: GoodObsidianPlugin,
  source: TFile,
  markdown: string,
  forcePick: boolean,
): Promise<TFile | null> {
  const { app } = plugin;
  if (!plugin.settings.inlineHandwriteMode) {
    const chosen = await HandwriteSetupModal.prompt(app, "once");
    if (!chosen) return null;
    plugin.settings.inlineHandwriteMode = chosen;
    try {
      await plugin.saveSettings();
    } catch (error) {
      if (plugin.settings.inlineHandwriteMode === chosen) {
        delete plugin.settings.inlineHandwriteMode;
      }
      throw error;
    }
  }

  const mode = plugin.settings.inlineHandwriteMode ?? "once";
  const linked = findLinkedNotebookInMarkdown(markdown);
  const linkedDest = linked ? app.metadataCache.getFirstLinkpathDest(linked, source.path) : null;
  const currentNotebook = linkedDest instanceof TFile ? linkedDest : null;
  const defaultCreateName = cleanTitle(stripInkSuffix(source.basename)) || "Handwriting";

  const shouldPick = forcePick || mode === "always" || (mode === "once" && !currentNotebook);
  if (shouldPick) {
    const choice = await InlineNotebookPickerModal.pick(app, {
      defaultCreateName,
      currentNotebook,
      placeholder: "Choose a notebook for this handwriting block…",
    });
    if (!choice) return null;
    if (choice.kind === "existing") return choice.file;
    return createBackingNotebook(plugin, source.path, choice.name);
  }

  if (currentNotebook) return currentNotebook;
  return createBackingNotebook(plugin, source.path, defaultCreateName);
}

export async function insertInlineHandwriting(
  plugin: GoodObsidianPlugin,
  editor: Editor,
  source: TFile,
  options?: { forcePick?: boolean },
): Promise<void> {
  const notebook = await resolveBackingNotebook(
    plugin,
    source,
    editor.getValue(),
    options?.forcePick === true,
  );
  if (!notebook) return;
  if (notebookIsOpen(plugin.app, notebook)) {
    new Notice("FineNotes: close the backing notebook tab before inserting inline handwriting.");
    return;
  }

  const pageId = newSketchId();
  const sketchPage = createInlineSketchPage(pageId, {
    transparent: true,
    width: plugin.settings.paperWidth,
  });

  await editClosedNotebook(plugin.app, notebook, plugin.settings.paperWidth, (doc) => {
    doc.pages.push(sketchPage);
  });

  const link = plugin.app.fileManager.generateMarkdownLink(notebook, source.path, `#id=${pageId}`);
  const cursor = editor.getCursor();
  const lineText = editor.getLine(cursor.line);
  const before = lineText.slice(0, cursor.ch);
  const after = lineText.slice(cursor.ch);
  const above = cursor.line > 0 ? editor.getLine(cursor.line - 1) : "";
  const below = cursor.line + 1 < editor.lineCount() ? editor.getLine(cursor.line + 1) : "";
  const insertion = embedInsertion(link, before, after, above, below);
  editor.replaceRange(insertion, cursor);

  plugin.activateInlineEmbed(notebook, pageId);
}

export function registerHandwriteHere(plugin: GoodObsidianPlugin): void {
  let inserting = false;
  const run = (editor: Editor, file: TFile, forcePick: boolean): void => {
    if (inserting) return;
    inserting = true;
    void insertInlineHandwriting(plugin, editor, file, { forcePick })
      .catch((error: unknown) => {
        new Notice(
          `FineNotes: ${error instanceof Error ? error.message : "Could not insert handwriting."}`,
        );
      })
      .finally(() => {
        inserting = false;
      });
  };

  plugin.addCommand({
    id: "handwrite-here",
    name: "Handwrite here",
    editorCheckCallback: (checking, editor, ctx) => {
      const file = ctx.file;
      if (!file || plugin.isInkFile(file)) return false;
      if (checking) return true;
      run(editor, file, false);
      return true;
    },
  });

  plugin.addCommand({
    id: "handwrite-here-choose",
    name: "Handwrite here (choose notebook…)",
    editorCheckCallback: (checking, editor, ctx) => {
      const file = ctx.file;
      if (!file || plugin.isInkFile(file)) return false;
      if (checking) return true;
      run(editor, file, true);
      return true;
    },
  });

  plugin.registerEvent(
    plugin.app.workspace.on("editor-menu", (menu, editor, info) => {
      const file = info instanceof MarkdownView ? info.file : info.file;
      if (!file || plugin.isInkFile(file)) return;
      menu.addItem((item) =>
        item
          .setTitle("Handwrite here")
          .setIcon("pen-tool")
          .onClick(() => run(editor, file, false)),
      );
    }),
  );
}
