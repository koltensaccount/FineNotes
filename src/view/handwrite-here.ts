import { referencedEmbedImages } from "./embed-references";
export { referencedEmbedImages } from "./embed-references";
import {
  type App,
  type Editor,
  MarkdownView,
  SuggestModal,
  Notice,
  TFile,
  normalizePath,
} from "obsidian";
import type GoodObsidianPlugin from "../main";
import { VIEW_TYPE_INK } from "../constants";
import {
  resolveNotebookAssociation,
  renameNotebookAssociations,
} from "../model/notebook-association";
import { buildInkFile, parseInkFile } from "../model/serialize";
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
import { InkView } from "./ink-view";

export type NotebookChoiceItem =
  | {
      type: "create";
      title: string;
      folder: string;
    }
  | {
      type: "existing";
      file: TFile;
      isSameFolder: boolean;
    };

export class NotebookSuggestModal extends SuggestModal<NotebookChoiceItem> {
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
      { command: "↵", purpose: "to select or create notebook" },
      { command: "esc", purpose: "to dismiss" },
    ]);
  }

  getSuggestions(query: string): NotebookChoiceItem[] {
    const trimmed = query.trim();
    const sourceFolder =
      this.source.parent && !this.source.parent.isRoot() ? this.source.parent.path : "";
    const defaultFolder = sourceFolder || this.plugin.settings?.newNotebookFolder || "";
    const defaultTitle = stripInkSuffix(this.source.basename) || "Notebook";
    const createTitle = trimmed.length > 0 ? trimmed : defaultTitle;

    const items: NotebookChoiceItem[] = [
      {
        type: "create",
        title: createTitle,
        folder: defaultFolder,
      },
    ];

    const lower = trimmed.toLowerCase();
    const matching = this.notebooks.filter((file) => {
      if (!lower) return true;
      const title = stripInkSuffix(file.basename).toLowerCase();
      const path = file.path.toLowerCase();
      return title.includes(lower) || path.includes(lower);
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
      el.addClass("finenotes-suggest-create");
      const titleRow = el.createDiv({ cls: "finenotes-suggest-title" });
      titleRow.createSpan({ cls: "finenotes-suggest-icon", text: "＋" });
      titleRow.createSpan({ cls: "finenotes-suggest-action", text: "Create new notebook: " });
      titleRow.createSpan({ cls: "finenotes-suggest-name", text: `"${item.title}"` });

      const subRow = el.createDiv({ cls: "finenotes-suggest-subtext" });
      const folderText = item.folder ? item.folder : "Vault root";
      subRow.createSpan({ text: `Location: ${folderText}` });
    } else {
      el.addClass("finenotes-suggest-existing");
      const titleRow = el.createDiv({ cls: "finenotes-suggest-title" });
      titleRow.createSpan({ text: stripInkSuffix(item.file.basename) });
      if (item.isSameFolder) {
        titleRow.createSpan({ cls: "finenotes-suggest-badge", text: "same folder" });
      }
      const subRow = el.createDiv({ cls: "finenotes-suggest-subtext" });
      const folderPath =
        item.file.parent && !item.file.parent.isRoot() ? item.file.parent.path : "Vault root";
      subRow.createSpan({ text: folderPath });
    }
  }

  async onChooseSuggestion(item: NotebookChoiceItem): Promise<void> {
    this.chosen = true;
    if (item.type === "existing") {
      this.resolve(item.file);
      return;
    }
    try {
      const file = await createNotebookForNote(this.plugin, this.source, item.title, item.folder);
      this.resolve(file);
    } catch (err) {
      new Notice(
        `FineNotes: could not create notebook — ${err instanceof Error ? err.message : String(err)}`,
      );
      this.resolve(null);
    }
  }

  override onClose(): void {
    super.onClose();
    // Obsidian may close the modal before dispatching onChooseSuggestion.
    window.setTimeout(() => {
      if (!this.chosen) this.resolve(null);
    }, 0);
  }
}

export async function createNotebookForNote(
  plugin: GoodObsidianPlugin,
  source: TFile,
  title: string,
  folder?: string,
): Promise<TFile> {
  const dir = normalizeFolder(
    folder ?? (source.parent && !source.parent.isRoot() ? source.parent.path : ""),
  );
  const parent = dir ? plugin.app.vault.getFolderByPath(dir) : plugin.app.vault.getRoot();
  const taken = new Set(parent?.children?.map((child) => child.name) ?? []);
  const choices = parseNotebookChoices(plugin.settings?.lastNotebookChoices);
  choices.type = "notebook";
  choices.cover = "none";

  const paths = notebookPaths(dir, title, "notebook", choices.ownFolder, taken);
  for (const path of paths.folders) {
    if (!plugin.app.vault.getFolderByPath(path)) {
      await plugin.app.vault.createFolder(path);
    }
  }
  const name = paths.fileName;
  const heading = cleanTitle(title) || stripInkSuffix(name);
  const doc = buildNewDocument(choices, heading, paths.attachments);
  const content = buildInkFile(newNoteBody(heading, new Date().toISOString()), doc);
  const filePath = normalizePath(joinVaultPath(paths.folder, name));
  const created = await plugin.app.vault.create(filePath, content);
  return (created instanceof TFile ? created : plugin.app.vault.getFileByPath(filePath)) as TFile;
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
  const resolveFile = (link: string) =>
    app.metadataCache.getFirstLinkpathDest(link, source.path) ?? app.vault.getFileByPath(link);
  const path =
    notebooks.length > 0
      ? await resolveNotebookAssociation({
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
        })
      : null;
  const notebook = path
    ? app.vault.getFileByPath(path)
    : await new Promise<TFile | null>((resolve) =>
        new NotebookSuggestModal(app, plugin, source, notebooks, resolve).open(),
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
