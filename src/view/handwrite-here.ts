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

async function resolveBackingNotebook(
  plugin: GoodObsidianPlugin,
  source: TFile,
  markdown: string,
): Promise<TFile> {
  const { app } = plugin;
  const linked = findLinkedNotebookInMarkdown(markdown);
  if (linked) {
    const existing = app.metadataCache.getFirstLinkpathDest(linked, source.path);
    if (existing instanceof TFile) return existing;
  }

  const base = cleanTitle(stripInkSuffix(source.basename)) || "Handwriting";
  const fileName = `${base}.notebook.md`;
  const customFolder = normalizeFolder(plugin.settings.inlineHandwriteFolder ?? "");
  let targetPath: string;
  if (customFolder) {
    await ensureFolder(plugin, customFolder);
    targetPath = normalizePath(joinVaultPath(customFolder, fileName));
  } else {
    targetPath = normalizePath(
      await app.fileManager.getAvailablePathForAttachment(fileName, source.path),
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

export async function insertInlineHandwriting(
  plugin: GoodObsidianPlugin,
  editor: Editor,
  source: TFile,
): Promise<void> {
  const notebook = await resolveBackingNotebook(plugin, source, editor.getValue());
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
  plugin.addCommand({
    id: "handwrite-here",
    name: "Handwrite here",
    editorCheckCallback: (checking, editor, ctx) => {
      const file = ctx.file;
      if (!file || plugin.isInkFile(file)) return false;
      if (checking) return true;
      void insertInlineHandwriting(plugin, editor, file).catch((error: unknown) => {
        new Notice(
          `FineNotes: ${error instanceof Error ? error.message : "Could not insert handwriting."}`,
        );
      });
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
          .onClick(() => {
            void insertInlineHandwriting(plugin, editor, file).catch((error: unknown) => {
              new Notice(
                `FineNotes: ${error instanceof Error ? error.message : "Could not insert handwriting."}`,
              );
            });
          }),
      );
    }),
  );
}
