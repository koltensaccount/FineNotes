import { type App, type TFile, Modal, Notice, setIcon } from "obsidian";
import type GoodObsidianPlugin from "../main";
import { NOTEBOOK_FILE_SUFFIX } from "../constants";
import type { InkDocument, Page } from "../model/document";
import { dedicatedInkPage, mergeInlineInk } from "../model/inline-ink-merge";
import { InkSurface } from "./ink-surface";
import { toolStateFrom } from "./ink-view";
import { penTypeFor, type ToolbarState } from "./toolbar";
import { selectedColor, selectedWidthFor } from "../model/writing-presets";
import { penGesturesOf } from "../ink/pen-gestures";
import { expandBlockPageIfNeeded } from "../model/handwrite-block";
import { buildInkFile, parseInkFile } from "../model/serialize";
import { editClosedNotebook, notebookIsOpen } from "./notebook-transaction";

export interface InlineSessionOptions {
  plugin: GoodObsidianPlugin;
  app: App;
  containerEl: HTMLElement;
  notebookFile: TFile;
  blockId: string;
  sourcePath: string;
  onClosed?: () => void;
}

let activeInlineSession: InlineHandwriteSession | null = null;

export function getActiveInlineSession(): InlineHandwriteSession | null {
  return activeInlineSession;
}

export class InlineHandwriteSession {
  private surface: InkSurface | null = null;
  private toolState: ToolbarState;
  private closing: Promise<boolean> | null = null;
  private saving: Promise<boolean> | null = null;
  private closed = false;
  private revision = 0;
  private savedRevision = 0;
  private recoveredRevision = 0;
  private doc: InkDocument | null = null;
  private base: Page | null = null;

  constructor(private readonly options: InlineSessionOptions) {
    this.toolState = toolStateFrom(options.plugin.settings);
    this.useTool(this.toolState.tool === "highlighter" || this.toolState.tool === "eraser" ? this.toolState.tool : "pen");
    // Inline editing is scoped to ink. The notebook retains its selection gestures.
    this.toolState.penGestures = { ...penGesturesOf(this.toolState.penGestures), circleLasso: false };
  }

  get hostContainer(): HTMLElement {
    return this.options.containerEl;
  }

  get currentPage(): Page | null {
    return this.doc?.pages[0] ?? null;
  }

  get dirty(): boolean {
    return this.revision !== this.savedRevision;
  }

  async start(): Promise<void> {
    const { app, containerEl, notebookFile, blockId, plugin } = this.options;
    while (activeInlineSession && activeInlineSession !== this) {
      if (activeInlineSession.hostContainer === containerEl || !await activeInlineSession.close()) return;
    }
    if (this.closed || !containerEl.isConnected) return;
    activeInlineSession = this;

    try {
      if (notebookIsOpen(app, notebookFile)) throw new Error("Close the full notebook editor before writing inline.");
      const content = await app.vault.read(notebookFile);
      if (this.closed || !containerEl.isConnected) {
        await this.close();
        return;
      }
      if (notebookIsOpen(app, notebookFile)) throw new Error("Close the full notebook editor before writing inline.");
      const parsed = parseInkFile(content, plugin.settings.paperWidth);
      if (!parsed.doc) throw new Error("The handwriting notebook could not be read.");
      const page = dedicatedInkPage(parsed.doc, blockId);
      this.base = structuredClone(page);
      this.doc = { version: parsed.doc.version, view: { scrollY: 0, width: page.geometry.width, scale: 1 }, pages: [page] };

      containerEl.empty();
      containerEl.addClass("finenotes-inline-active");
      this.buildToolbar(containerEl.createDiv({ cls: "finenotes-inline-toolbar" }));
      const host = containerEl.createDiv({ cls: "finenotes-inline-surface-host" });
      this.surface = new InkSurface(host, this.doc, this.toolState, {
        app,
        highlighterAlpha: plugin.settings.highlighterAlpha,
        darkPaper: containerEl.ownerDocument.body?.classList.contains("theme-dark"),
        desynchronizedCanvas: false,
        debug: false,
      }, {
        onChange: () => {
          this.revision++;
          this.handleStrokeCommitted();
        },
      });
      this.surface.setTool(this.toolState.tool);
    } catch (err) {
      new Notice(`FineNotes: ${err instanceof Error ? err.message : "Could not open handwriting."}`);
      await this.close();
    }
  }

  private useTool(tool: "pen" | "highlighter" | "eraser"): void {
    if (tool !== "eraser") {
      const settings = this.options.plugin.settings;
      const presets = settings.writingPresets;
      this.toolState.penType = tool === "highlighter" ? "highlighter"
        : settings.penType && settings.penType !== "highlighter" ? settings.penType
        : settings.pressureWidth ? "fountain" : "ball";
      this.toolState.pressureEnabled = settings.pressureWidth && penTypeFor(this.toolState).pressure;
      this.toolState.color = presets ? selectedColor(presets, tool) : settings.defaultColor;
      this.toolState.size = presets ? selectedWidthFor(presets, tool) : settings.defaultSize;
    }
    this.toolState.tool = tool;
    this.surface?.setTool(tool);
  }

  private buildToolbar(toolbar: HTMLElement): void {
    const penBtn = toolbar.createEl("button", {
      cls: "finenotes-inline-tool-button",
      attr: { "aria-label": "Pen" },
    });
    setIcon(penBtn, "pen-tool");

    const highBtn = toolbar.createEl("button", {
      cls: "finenotes-inline-tool-button",
      attr: { "aria-label": "Highlighter" },
    });
    setIcon(highBtn, "highlighter");

    const eraseBtn = toolbar.createEl("button", {
      cls: "finenotes-inline-tool-button",
      attr: { "aria-label": "Eraser" },
    });
    setIcon(eraseBtn, "eraser");

    penBtn.toggleClass("is-active", this.toolState.tool === "pen");
    highBtn.toggleClass("is-active", this.toolState.tool === "highlighter");
    eraseBtn.toggleClass("is-active", this.toolState.tool === "eraser");

    const updateActiveTool = (btn: HTMLElement, tool: "pen" | "highlighter" | "eraser") => {
      penBtn.removeClass("is-active");
      highBtn.removeClass("is-active");
      eraseBtn.removeClass("is-active");
      btn.addClass("is-active");
      this.useTool(tool);
    };

    penBtn.onclick = (e) => {
      e.stopPropagation();
      updateActiveTool(penBtn, "pen");
    };
    highBtn.onclick = (e) => {
      e.stopPropagation();
      updateActiveTool(highBtn, "highlighter");
    };
    eraseBtn.onclick = (e) => {
      e.stopPropagation();
      updateActiveTool(eraseBtn, "eraser");
    };

    toolbar.createDiv({ cls: "finenotes-inline-toolbar-sep" });

    const undoBtn = toolbar.createEl("button", {
      cls: "finenotes-inline-tool-button",
      attr: { "aria-label": "Undo" },
    });
    setIcon(undoBtn, "undo");
    undoBtn.onclick = (e) => {
      e.stopPropagation();
      this.surface?.undo();
    };

    const redoBtn = toolbar.createEl("button", {
      cls: "finenotes-inline-tool-button",
      attr: { "aria-label": "Redo" },
    });
    setIcon(redoBtn, "redo");
    redoBtn.onclick = (e) => {
      e.stopPropagation();
      this.surface?.redo();
    };

    toolbar.createDiv({ cls: "finenotes-inline-toolbar-sep" });

    const openBtn = toolbar.createEl("button", {
      cls: "finenotes-inline-tool-button",
      attr: { "aria-label": "Open in Notebook" },
    });
    setIcon(openBtn, "external-link");
    openBtn.onclick = async (e) => {
      e.stopPropagation();
      if (!await this.close()) return;
      const linkText = `${this.options.notebookFile.path}#^${this.options.blockId}`;
      void this.options.app.workspace.openLinkText(linkText, this.options.sourcePath, false);
    };

    const doneBtn = toolbar.createEl("button", {
      cls: "finenotes-inline-tool-button finenotes-inline-done",
      attr: { "aria-label": "Done" },
    });
    setIcon(doneBtn, "check");
    doneBtn.createSpan({ text: "Done" });
    doneBtn.onclick = (e) => {
      e.stopPropagation();
      void this.close();
    };
  }

  private handleStrokeCommitted(): void {
    const page = this.currentPage;
    const last = page?.strokes.at(-1);
    if (!page || !last) return;
    let maxY = -Infinity;
    for (let i = 1; i < last.pts.length; i += 3) maxY = Math.max(maxY, last.pts[i]);
    if (maxY > 0 && expandBlockPageIfNeeded(page, maxY)) this.surface?.layout();
  }

  save(): Promise<boolean> {
    if (this.saving) return this.saving;
    if (!this.dirty || !this.currentPage || !this.base) return Promise.resolve(true);
    this.saving = this.persist(this.base, structuredClone(this.currentPage), this.revision)
      .finally(() => { this.saving = null; });
    return this.saving;
  }

  private async persist(base: Page, page: Page, revision: number): Promise<boolean> {
    const { app, notebookFile, plugin, blockId } = this.options;
    try {
      await editClosedNotebook(app, notebookFile, plugin.settings.paperWidth, (doc) => {
        mergeInlineInk(base, page, dedicatedInkPage(doc, blockId));
      });
    } catch (err) {
      const recovered = await this.checkpoint(page, revision);
      const reason = err instanceof Error ? err.message : "Could not write the notebook.";
      new Notice(`FineNotes: ${reason} ${recovered ? "Recovery copy saved." : "Keep this editor open and retry Done."}`, 10000);
      return false;
    }
    // Advance only through the snapshot that was written. Keep external ink out
    // of the local undo stack, so a later save cannot accidentally erase it.
    this.base = page;
    this.savedRevision = revision;
    void Promise.resolve().then(async () => {
      plugin.embedManager?.refreshEmbedsForFile(notebookFile.path);
      await plugin.embedManager?.refreshPngEmbeds(notebookFile);
    }).catch((err) => {
      console.warn("[FineNotes] Handwriting saved; preview refresh failed:", err);
    });
    return true;
  }

  private recoveryText(page: Page): string {
    const copy = structuredClone(page);
    delete copy.pageEmbedPath;
    for (const clip of copy.clips ?? []) delete clip.imagePath;
    const { version, view } = this.doc!;
    return buildInkFile(`# Recovered handwriting

Source notebook: ${this.options.notebookFile.path}

Block: ${page.id}`, {
      version, view, pages: [copy],
    });
  }

  private async checkpoint(page: Page, revision: number): Promise<boolean> {
    if (this.recoveredRevision === revision) return true;
    const { app, notebookFile } = this.options;
    try {
      const folder = notebookFile.path.slice(0, notebookFile.path.lastIndexOf("/") + 1);
      const path = `${folder}FineNotes recovery ${crypto.randomUUID()}${NOTEBOOK_FILE_SUFFIX}`;
      await app.vault.create(path, this.recoveryText(page));
      this.recoveredRevision = revision;
      new Notice(`FineNotes recovery saved at ${path}`, 10000);
      return true;
    } catch {
      return false;
    }
  }

  private showRecovery(page: Page): void {
    const modal = new Modal(this.options.app);
    modal.setTitle("Copy unsaved FineNotes handwriting");
    modal.contentEl.createEl("p", { text: "The notebook and recovery copy could not be written. Copy this text into a new .notebook.md file, or close this dialog and retry the handwriting block." });
    const text = modal.contentEl.createEl("textarea");
    text.value = this.recoveryText(page);
    text.readOnly = true;
    text.rows = 8;
    modal.open();
    text.select();
  }

  close(detached = false): Promise<boolean> {
    if (this.closed) return Promise.resolve(true);
    if (this.closing) return detached ? this.closing.then((closed) => closed || this.close(true)) : this.closing;
    this.closing = this.finishClose(detached).finally(() => { this.closing = null; });
    return this.closing;
  }

  private async finishClose(detached: boolean): Promise<boolean> {
    const { containerEl, onClosed } = this.options;
    this.surface?.finishPointerInput();
    containerEl.inert = true;
    try {
      const saved = await this.save();
      if ((!saved || this.dirty) && this.currentPage) {
        if (!detached) return false;
        if (!await this.checkpoint(this.currentPage, this.revision)) {
          this.showRecovery(this.currentPage);
          return false;
        }
      }
      this.closed = true;
      this.surface?.destroy();
      this.surface = null;
      containerEl.removeClass("finenotes-inline-active");
      if (activeInlineSession === this) activeInlineSession = null;
      onClosed?.();
      return true;
    } finally {
      containerEl.inert = false;
    }
  }
}

export function startInlineHandwriteSession(options: InlineSessionOptions): InlineHandwriteSession {
  const session = new InlineHandwriteSession(options);
  void session.start();
  return session;
}
