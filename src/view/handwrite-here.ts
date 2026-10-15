import { type App, type Editor, MarkdownView, FuzzySuggestModal, Notice, TFile } from "obsidian";
import type GoodObsidianPlugin from "../main";
import { VIEW_TYPE_INK } from "../constants";
import {
  resolveNotebookAssociation,
  renameNotebookAssociations,
} from "../model/notebook-association";
import { parseInkFile } from "../model/serialize";
import { InkView } from "./ink-view";

export class NotebookSuggestModal extends FuzzySuggestModal<TFile> {
  private chosen = false;
  constructor(
    app: App,
    private readonly notebooks: TFile[],
    private readonly resolve: (file: TFile | null) => void,
  ) {
    super(app);
    this.setPlaceholder("Choose a notebook for handwriting in this note");
  }
  getItems(): TFile[] {
    return this.notebooks;
  }
  getItemText(file: TFile): string {
    return file.path;
  }
  onChooseItem(file: TFile): void {
    this.chosen = true;
    this.resolve(file);
  }
  override onClose(): void {
    super.onClose();
    // Obsidian may close the modal before dispatching onChooseItem.
    window.setTimeout(() => {
      if (!this.chosen) this.resolve(null);
    }, 0);
  }
}

/** Never overwrite a selection or insert into a different document after awaiting UI. */
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
  const prefix = at > 0 && current[at - 1] !== "\n" ? "\n" : "";
  editor.replaceRange(`${prefix}${embed}\n`, editor.offsetToPos(at));
}

export function registerHandwriteHere(plugin: GoodObsidianPlugin): void {
  let running = false;
  plugin.addCommand({
    id: "handwrite-here",
    name: "Handwrite Here",
    editorCheckCallback: (checking, editor, context) => {
      if (!(context instanceof MarkdownView)) return false;
      const view = context;
      if (!view.file || plugin.isInkFile(view.file)) return false;
      if (checking) return true;
      if (running) return true;
      // Capture before opening a picker, reading a file, or changing focus.
      const file = view.file;
      const before = editor.getValue();
      const offset = editor.posToOffset(editor.getCursor());
      running = true;
      void handwriteHere(plugin, view, editor, file, before, offset)
        .catch(
          (error) =>
            new Notice(`FineNotes: ${error instanceof Error ? error.message : String(error)}`),
        )
        .finally(() => {
          running = false;
        });
      return true;
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

/** Consult live editors before the saved link index, so deleting a block works immediately. */
export function referencedEmbedImages(app: App, source: TFile, text: string): Set<string> {
  const live = new Map<string, string>([[source.path, text]]);
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    if (leaf.view instanceof MarkdownView && leaf.view.file && leaf.view.file !== source)
      live.set(leaf.view.file.path, leaf.view.editor.getValue());
  }
  const paths = new Set<string>();
  for (const [note, links] of Object.entries(app.metadataCache.resolvedLinks ?? {})) {
    if (!live.has(note)) for (const path of Object.keys(links)) paths.add(path);
  }
  for (const [note, content] of live) {
    for (const match of content.matchAll(
      /!?\[\[([^\]]+)\]\]|!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))\)/g,
    )) {
      const link = (match[1] ?? match[2] ?? match[3]).split("|")[0].split("#")[0];
      let decoded = link;
      try {
        decoded = decodeURIComponent(link);
      } catch {
        /* Keep literal vault paths. */
      }
      const file = app.metadataCache.getFirstLinkpathDest(decoded, note);
      if (file) paths.add(file.path);
    }
  }
  return paths;
}

export async function handwriteHere(
  plugin: GoodObsidianPlugin,
  sourceView: MarkdownView,
  editor: Editor,
  source: TFile,
  before: string,
  offset: number,
): Promise<void> {
  const app = plugin.app;
  const notebooks = app.vault
    .getFiles()
    .filter((file) => /\.notebook\.md$/i.test(file.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  if (!notebooks.length)
    throw new Error("Create a FineNotes notebook first, then run Handwrite Here again.");
  const resolveFile = (link: string) =>
    app.metadataCache.getFirstLinkpathDest(link, source.path) ?? app.vault.getFileByPath(link);
  const path = await resolveNotebookAssociation({
    markdownPath: source.path,
    frontmatter: app.metadataCache.getFileCache(source)?.frontmatter,
    stored: plugin.settings.notebookAssociations,
    text: before,
    notebooks: notebooks.map((file) => file.path),
    resolveLink: (link) => resolveFile(link)?.path ?? null,
    imageOwner: async (link) => {
      const image = resolveFile(link);
      if (!image) return null;
      for (const notebook of notebooks) {
        const doc = parseInkFile(
          await app.vault.cachedRead(notebook),
          plugin.settings.paperWidth,
        ).doc;
        if (
          doc?.pages.some(
            (page) =>
              page.pageEmbedPath === image.path ||
              page.clips?.some((clip) => clip.imagePath === image.path),
          )
        )
          return notebook.path;
      }
      return null;
    },
  });
  const notebook = path
    ? app.vault.getFileByPath(path)
    : await new Promise<TFile | null>((resolve) =>
        new NotebookSuggestModal(app, notebooks, resolve).open(),
      );
  if (!notebook) return;
  if (
    sourceView.file !== source ||
    sourceView.leaf.view !== sourceView ||
    embedInsertionOffset(before, editor.getValue(), offset) === null
  )
    throw new Error("The source note changed. Run Handwrite Here again.");
  (plugin.settings.notebookAssociations ??= {})[source.path] = notebook.path;
  await plugin.saveSettings();
  let leaf = app.workspace
    .getLeavesOfType(VIEW_TYPE_INK)
    .find((leaf) => (leaf.view as InkView).file === notebook);
  const wasOpen = Boolean(leaf);
  leaf ??= app.workspace.getLeaf("split");
  if (!wasOpen)
    await leaf.setViewState({ type: VIEW_TYPE_INK, active: true, state: { file: notebook.path } });
  await app.workspace.revealLeaf(leaf);
  if (!(leaf.view instanceof InkView)) throw new Error("The notebook could not be opened.");
  const referencedImages = referencedEmbedImages(app, source, editor.getValue());
  const image = await leaf.view.createHandwritingRegion(wasOpen, referencedImages);
  if (sourceView.file !== source || sourceView.leaf.view !== sourceView)
    throw new Error("The source note changed; the handwriting region is saved in the notebook.");
  insertHandwritingEmbed(
    editor,
    before,
    offset,
    "!" + app.fileManager.generateMarkdownLink(image, source.path),
  );
}
