/**
 * "Handwrite Here" command for Markdown notes: resolves or creates the
 * note's backing `.notebook.md`, appends a dedicated expandable `block-*`
 * page, inserts a ```finenotes``` block at the cursor, and opens it
 * immediately for inline handwriting.
 */

import {
  type App,
  type Editor,
  MarkdownView,
  Notice,
  SuggestModal,
  TFile,
  normalizePath,
  setIcon,
} from "obsidian";
import type GoodObsidianPlugin from "../main";
import { emptyDocument } from "../model/document";
import {
  BLOCK_PADDING,
  createBlockPage,
  isBlockPage,
  normalizeBlockWhiteInkToBlack,
} from "../model/handwrite-block";
import {
  buildNewDocument,
  cleanTitle,
  joinVaultPath,
  newNoteBody,
  normalizeFolder,
  notebookPaths,
  parseNotebookChoices,
  stripInkSuffix,
} from "../model/new-notebook";
import {
  renameNotebookAssociations,
  resolveNotebookAssociation,
} from "../model/notebook-association";
import { buildInkFile, parseInkFile } from "../model/serialize";
import {
  ensureFolderExists,
  getManagedSubdirectory,
  isManagedStorageEnabled,
} from "../model/storage-resolver";
import { FN_ICON_HANDWRITE_HERE } from "./finenotes-icons";
import type { HandwriteEmbedManager } from "./handwrite-embed";
import { editClosedNotebook, notebookIsOpen } from "./notebook-transaction";

type NotebookChoiceItem =
  | { type: "create"; title: string; folder: string }
  | { type: "existing"; file: TFile; isSameFolder: boolean };

class NotebookSuggestModal extends SuggestModal<NotebookChoiceItem> {
  private chosen = false;

  constructor(
    app: App,
    private readonly plugin: GoodObsidianPlugin,
    private readonly source: TFile,
    private readonly notebooks: TFile[],
    private readonly resolve: (file: TFile | null) => void,
  ) {
    super(app);
    this.setPlaceholder("Choose an existing notebook or create a new one...");
    this.setInstructions([
      { command: "Enter", purpose: "to select or create notebook" },
      { command: "Esc", purpose: "to dismiss" },
    ]);
  }

  getSuggestions(query: string): NotebookChoiceItem[] {
    const trimmed = query.trim();
    const sourceFolder =
      this.source.parent && !this.source.parent.isRoot() ? this.source.parent.path : "";
    const defaultFolder = isManagedStorageEnabled(this.plugin.settings)
      ? getManagedSubdirectory("handwriting", this.plugin.settings)
      : sourceFolder || this.plugin.settings?.newNotebookFolder || "";
    const defaultTitle = stripInkSuffix(this.source.basename) || "Notebook";
    const createTitle = trimmed.length > 0 ? trimmed : defaultTitle;

    const items: NotebookChoiceItem[] = [
      { type: "create", title: createTitle, folder: defaultFolder },
    ];

    const lower = trimmed.toLowerCase();
    const matching = this.notebooks.filter((file) => {
      if (!lower) return true;
      return (
        stripInkSuffix(file.basename).toLowerCase().includes(lower) ||
        file.path.toLowerCase().includes(lower)
      );
    });

    matching.sort((a, b) => {
      const aSame = a.parent?.path === this.source.parent?.path;
      const bSame = b.parent?.path === this.source.parent?.path;
      if (aSame && !bSame) return -1;
      if (!aSame && bSame) return 1;
      return a.basename.localeCompare(b.basename);
    });

    for (const file of matching) {
      items.push({
        type: "existing",
        file,
        isSameFolder: file.parent?.path === this.source.parent?.path,
      });
    }
    return items;
  }

  renderSuggestion(item: NotebookChoiceItem, el: HTMLElement): void {
    el.empty();
    el.addClass("finenotes-notebook-suggest-item");
    if (item.type === "create") {
      const titleRow = el.createDiv({ cls: "finenotes-suggest-title" });
      const iconSpan = titleRow.createSpan({ cls: "finenotes-suggest-icon" });
      setIcon(iconSpan, "plus");
      titleRow.createSpan({ text: `Create new notebook: "${item.title}"` });
      el.createDiv({
        cls: "finenotes-suggest-subtext",
        text: `Location: ${item.folder || "Vault root"}`,
      });
    } else {
      const titleRow = el.createDiv({ cls: "finenotes-suggest-title" });
      titleRow.createSpan({ text: stripInkSuffix(item.file.basename) });
      if (item.isSameFolder) {
        titleRow.createSpan({ cls: "finenotes-suggest-badge", text: "same folder" });
      }
      const folderPath =
        item.file.parent && !item.file.parent.isRoot() ? item.file.parent.path : "Vault root";
      el.createDiv({ cls: "finenotes-suggest-subtext", text: folderPath });
    }
  }

  onChooseSuggestion(item: NotebookChoiceItem): void {
    this.chosen = true;
    if (item.type === "existing") {
      this.resolve(item.file);
      return;
    }
    void (async () => {
      try {
        const file = await createNotebookForNote(this.plugin, this.source, item.title, item.folder);
        this.resolve(file);
      } catch (err) {
        new Notice(
          `FineNotes: could not create notebook — ${err instanceof Error ? err.message : String(err)}`,
        );
        this.resolve(null);
      }
    })();
  }

  override onClose(): void {
    super.onClose();
    window.setTimeout(() => {
      if (!this.chosen) this.resolve(null);
    }, 0);
  }
}

async function createNotebookForNote(
  plugin: GoodObsidianPlugin,
  source: TFile,
  title: string,
  folder?: string,
): Promise<TFile> {
  const defaultDir = isManagedStorageEnabled(plugin.settings)
    ? getManagedSubdirectory("handwriting", plugin.settings)
    : source.parent && !source.parent.isRoot()
      ? source.parent.path
      : "";
  const dir = normalizeFolder(folder ?? defaultDir);
  await ensureFolderExists(plugin.app, dir);
  const parent = dir ? plugin.app.vault.getFolderByPath(dir) : plugin.app.vault.getRoot();
  const taken = new Set(parent?.children?.map((child) => child.name) ?? []);
  const choices = parseNotebookChoices(plugin.settings?.lastNotebookChoices);
  choices.type = "notebook";
  choices.cover = "none";

  const paths = notebookPaths(dir, title, "notebook", false, taken);
  for (const p of paths.folders) {
    if (!plugin.app.vault.getFolderByPath(p)) {
      await plugin.app.vault.createFolder(p);
    }
  }
  const heading = cleanTitle(title) || stripInkSuffix(paths.fileName);
  const doc = buildNewDocument(choices, heading, paths.attachments);
  const content = buildInkFile(newNoteBody(heading, new Date().toISOString()), doc);
  const filePath = normalizePath(joinVaultPath(paths.folder, paths.fileName));
  const created = await plugin.app.vault.create(filePath, content);
  const file = created instanceof TFile ? created : plugin.app.vault.getFileByPath(filePath);
  if (!(file instanceof TFile)) throw new Error("Created notebook file could not be resolved.");
  return file;
}

export function embedInsertionOffset(
  before: string,
  current: string,
  offset: number,
): number | null {
  if (before === current) return offset;
  const left = before.slice(Math.max(0, offset - 80), offset);
  const right = before.slice(offset, offset + 80);
  const anchor = left + right;
  if (!anchor) return null;
  const at = current.indexOf(anchor);
  if (at < 0 || current.indexOf(anchor, at + 1) >= 0) return null;
  return at + left.length;
}

export function insertHandwritingEmbed(
  editor: Editor,
  before: string,
  offset: number,
  embed: string,
): void {
  const current = editor.getValue();
  const at = embedInsertionOffset(before, current, offset);
  if (at === null) throw new Error("The insertion location changed. Run Handwrite Here again.");
  const lineStart = at === 0 ? 0 : current.lastIndexOf("\n", at - 1) + 1;
  const nextBreak = current.indexOf("\n", at);
  const lineEnd = nextBreak < 0 ? current.length : nextBreak;
  const line = current.slice(lineStart, lineEnd);
  const quote = /^[ \t]*(?:>[ \t]*)+/.exec(line)?.[0].trimEnd();
  if (quote) {
    const newline = current.includes("\r\n") ? "\r\n" : "\n";
    const quotedEmbed = embed
      .split(/\r?\n/)
      .map((part) => `${quote} ${part}`)
      .join(newline);
    const quotedAnchor = /^\s*\^[-a-zA-Z0-9]+\s*$/.test(line.slice(quote.length));
    const position = quotedAnchor ? lineStart : lineEnd - Number(line.endsWith("\r"));
    const separator = quotedAnchor ? "" : newline;
    const inserted = `${separator}${quote}${newline}${quotedEmbed}${newline}${quote}${quotedAnchor ? newline : ""}`;
    editor.replaceRange(inserted, editor.offsetToPos(position));
    // Live Preview renders the entire callout as one widget. A caret on
    // another quoted line still opens its raw Markdown, hiding the new block.
    const updated = editor.getValue();
    let outside = updated.indexOf("\n", position + inserted.length);
    while (outside !== -1) {
      const start = outside + 1;
      const end = updated.indexOf("\n", start);
      if (!updated.slice(start, end === -1 ? undefined : end).trim()) {
        editor.setCursor(editor.offsetToPos(start));
        return;
      }
      outside = end;
    }
    editor.replaceRange(newline, editor.offsetToPos(updated.length));
    editor.setCursor(editor.offsetToPos(updated.length + newline.length));
    return;
  }
  const prefix = at > 0 && current[at - 1] !== "\n" ? "\n" : "";
  const inserted = `${prefix}${embed}\n`;
  editor.replaceRange(inserted, editor.offsetToPos(at));
  editor.setCursor?.(editor.offsetToPos(at + inserted.length));
}

export function registerHandwriteHere(
  plugin: GoodObsidianPlugin,
  embedManager: HandwriteEmbedManager,
): void {
  let running = false;
  plugin.addCommand({
    id: "handwrite-here",
    name: "Handwrite Here",
    icon: FN_ICON_HANDWRITE_HERE,
    editorCheckCallback: (checking, editor, context) => {
      if (!(context instanceof MarkdownView)) return false;
      const view = context;
      if (!view.file || plugin.isInkFile(view.file)) return false;
      if (checking) return true;
      if (running) return true;
      const file = view.file;
      const before = editor.getValue();
      const offset = editor.posToOffset(editor.getCursor());
      running = true;
      void runHandwriteHere(plugin, embedManager, view, editor, file, before, offset)
        .catch(
          (err) => new Notice(`FineNotes: ${err instanceof Error ? err.message : String(err)}`),
        )
        .finally(() => {
          running = false;
        });
      return true;
    },
  });

  plugin.addCommand({
    id: "normalize-handwrite-white-ink",
    name: "Normalize white ink to black in Handwrite Here blocks",
    icon: FN_ICON_HANDWRITE_HERE,
    callback: () => {
      void normalizeAllHandwriteBlocks(plugin);
    },
  });

  plugin.registerEvent(
    plugin.app.vault.on("rename", (file, oldPath) => {
      if (!plugin.settings.notebookAssociations) return;
      plugin.settings.notebookAssociations = renameNotebookAssociations(
        plugin.settings.notebookAssociations,
        oldPath,
        file.path,
      );
      void plugin.saveSettings();
    }),
  );
}

async function runHandwriteHere(
  plugin: GoodObsidianPlugin,
  embedManager: HandwriteEmbedManager,
  sourceView: MarkdownView,
  editor: Editor,
  source: TFile,
  before: string,
  offset: number,
): Promise<void> {
  const app = plugin.app;
  const notebooks = app.vault
    .getFiles()
    .filter((f) => /\.notebook\.md$/i.test(f.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  const resolveFile = (link: string) =>
    app.metadataCache.getFirstLinkpathDest(link, source.path) ?? app.vault.getFileByPath(link);

  const associatedPath =
    notebooks.length > 0
      ? await resolveNotebookAssociation({
          markdownPath: source.path,
          frontmatter: app.metadataCache.getFileCache(source)?.frontmatter,
          stored: plugin.settings.notebookAssociations,
          text: before,
          notebooks: notebooks.map((f) => f.path),
          resolveLink: (link) => resolveFile(link)?.path ?? null,
          imageOwner: async (link) => {
            const img = resolveFile(link);
            if (!img) return null;
            for (const nb of notebooks) {
              const doc = parseInkFile(
                await app.vault.cachedRead(nb),
                plugin.settings.paperWidth,
              ).doc;
              if (
                doc?.pages.some(
                  (p) =>
                    p.pageEmbedPath === img.path || p.clips?.some((c) => c.imagePath === img.path),
                )
              ) {
                return nb.path;
              }
            }
            return null;
          },
        })
      : null;

  const notebook = associatedPath
    ? app.vault.getFileByPath(associatedPath)
    : await new Promise<TFile | null>((resolve) =>
        new NotebookSuggestModal(app, plugin, source, notebooks, resolve).open(),
      );
  if (!notebook) return;
  if (
    sourceView.file !== source ||
    sourceView.leaf.view !== sourceView ||
    embedInsertionOffset(before, editor.getValue(), offset) === null
  ) {
    throw new Error("The source note changed. Run Handwrite Here again.");
  }

  (plugin.settings.notebookAssociations ??= {})[source.path] = notebook.path;
  await plugin.saveSettings();

  if (notebookIsOpen(app, notebook)) {
    throw new Error("Close the full notebook editor before writing inline.");
  }

  const blockId = `block-${crypto.randomUUID()}`;
  const column = sourceView.contentEl?.querySelector<HTMLElement>(".cm-content");
  const css = column?.ownerDocument.defaultView?.getComputedStyle(column);
  const colW =
    column && css
      ? column.clientWidth -
        (parseFloat(css.paddingLeft) || 0) -
        (parseFloat(css.paddingRight) || 0)
      : 0;
  const width = colW > 2 * BLOCK_PADDING ? Math.round(colW) : plugin.settings.paperWidth;
  const { page } = createBlockPage(emptyDocument(), blockId, width);

  await editClosedNotebook(app, notebook, plugin.settings.paperWidth, (doc) => {
    if (
      sourceView.file !== source ||
      sourceView.leaf.view !== sourceView ||
      embedInsertionOffset(before, editor.getValue(), offset) === null
    ) {
      throw new Error("The source note changed. Run Handwrite Here again.");
    }
    doc.pages.push(page);
  });

  embedManager.queuePendingActivation(notebook.path, blockId);
  insertHandwritingEmbed(
    editor,
    before,
    offset,
    `\`\`\`finenotes\n${JSON.stringify({ notebook: notebook.path, block: blockId })}\n\`\`\``,
  );
}

async function normalizeAllHandwriteBlocks(plugin: GoodObsidianPlugin): Promise<void> {
  const app = plugin.app;
  const notebooks = app.vault.getFiles().filter((f) => /\.notebook\.md$/i.test(f.path));
  let totalItems = 0;
  let totalBlocks = 0;
  let skippedOpen = 0;

  for (const nb of notebooks) {
    if (notebookIsOpen(app, nb)) {
      skippedOpen++;
      continue;
    }
    try {
      const raw = await app.vault.cachedRead(nb);
      if (!raw.includes("block-")) continue;
      const parsed = parseInkFile(raw, plugin.settings.paperWidth);
      if (!parsed.doc) continue;
      const hasWhite = parsed.doc.pages.some(
        (p) => isBlockPage(p) && normalizeBlockWhiteInkToBlack(structuredClone(p)) > 0,
      );
      if (!hasWhite) continue;

      await editClosedNotebook(app, nb, plugin.settings.paperWidth, (doc) => {
        for (const page of doc.pages) {
          if (!isBlockPage(page)) continue;
          const n = normalizeBlockWhiteInkToBlack(page);
          if (n > 0) {
            totalItems += n;
            totalBlocks++;
          }
        }
      });
    } catch {
      // Skip unreadable notebooks
    }
  }

  const skippedNote = skippedOpen > 0 ? ` (${skippedOpen} open notebook(s) skipped)` : "";
  if (totalItems === 0) {
    new Notice(`FineNotes: no white ink found in Handwrite Here blocks.${skippedNote}`);
  } else {
    new Notice(
      `FineNotes: converted ${totalItems} white-ink item(s) to black across ${totalBlocks} Handwrite Here block(s).${skippedNote}`,
      7000,
    );
  }
}
