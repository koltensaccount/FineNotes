import { type App, TFile, Notice, setIcon } from "obsidian";
import type GoodObsidianPlugin from "../main";
import { VIEW_TYPE_INK } from "../constants";
import { type InkDocument, type Page, type NotebookClip, type Bounds } from "../model/document";
import { InkSurface } from "./ink-surface";
import type { ToolbarState } from "./toolbar";
import { expandBlockPageIfNeeded, resolveBlockBounds } from "../model/handwrite-block";
import { buildInkFile, parseInkFile } from "../model/serialize";
import { renderClipPng } from "./clip-png";
import type { InkView } from "./ink-view";

export interface InlineSessionOptions {
  plugin: GoodObsidianPlugin;
  app: App;
  containerEl: HTMLElement;
  notebookFile: TFile;
  pageIndex: number;
  clip?: NotebookClip | null;
  cropBounds: Bounds;
  sourcePath: string;
  onClosed?: () => void;
}

let activeInlineSession: InlineHandwriteSession | null = null;
let lastFailedSession: InlineHandwriteSession | null = null;

export function getActiveInlineSession(): InlineHandwriteSession | null {
  return activeInlineSession;
}

export function getLastFailedSession(): InlineHandwriteSession | null {
  return lastFailedSession;
}

function defaultInlineToolbarState(): ToolbarState {
  return {
    tool: "pen",
    color: "#000000",
    size: 2,
    pressureEnabled: false,
  };
}

export class InlineHandwriteSession {
  private surface: InkSurface | null = null;
  private toolbarEl: HTMLElement | null = null;
  private hostEl: HTMLElement | null = null;
  private toolState: ToolbarState;
  private isClosing = false;
  private isDirty = false;
  private doc: InkDocument | null = null;
  private page: Page | null = null;
  private noteBody = "";
  private initialMtime = 0;
  private openInkView: InkView | null = null;

  constructor(private readonly options: InlineSessionOptions) {
    this.toolState = defaultInlineToolbarState();
  }

  get hostContainer(): HTMLElement {
    return this.options.containerEl;
  }

  get document(): InkDocument | null {
    return this.doc;
  }

  get currentPage(): Page | null {
    return this.page;
  }

  get dirty(): boolean {
    return this.isDirty;
  }

  async start(): Promise<void> {
    if (activeInlineSession && activeInlineSession !== this) {
      await activeInlineSession.close();
    }
    activeInlineSession = this;

    const { containerEl, notebookFile, pageIndex } = this.options;

    // Check if backing notebook is currently open in an InkView leaf
    const openLeaf = this.options.app.workspace
      .getLeavesOfType(VIEW_TYPE_INK)
      .find((leaf) => (leaf.view as InkView).file?.path === notebookFile.path);
    this.openInkView = (openLeaf?.view as InkView) ?? null;

    const openDoc = this.openInkView?.document;
    if (openDoc?.pages?.[pageIndex]) {
      this.doc = openDoc;
      this.noteBody = this.openInkView?.bodyText ?? "";
      this.page = openDoc.pages[pageIndex];
    } else {
      const content = await this.options.app.vault.read(notebookFile);
      const parsed = parseInkFile(content, this.options.plugin.settings?.paperWidth);
      if (!parsed.doc || !parsed.doc.pages[pageIndex]) {
        new Notice("FineNotes: could not load handwriting section.");
        await this.close();
        return;
      }
      this.doc = parsed.doc;
      this.noteBody = parsed.body;
      this.page = parsed.doc.pages[pageIndex];
    }

    if (!this.doc || !this.page) {
      await this.close();
      return;
    }

    this.initialMtime = notebookFile.stat?.mtime ?? 0;

    containerEl.empty();
    containerEl.addClass("finenotes-inline-active");

    // Build the inline floating toolbar
    this.toolbarEl = containerEl.createDiv({ cls: "finenotes-inline-toolbar" });
    this.buildToolbar(this.toolbarEl);

    // Host element for InkSurface
    this.hostEl = containerEl.createDiv({ cls: "finenotes-inline-surface-host" });

    const isDark =
      typeof document !== "undefined" && document.body?.classList.contains("theme-dark");

    this.surface = new InkSurface(
      this.hostEl,
      this.doc,
      this.toolState,
      {
        darkPaper: isDark,
        app: this.options.app,
        desynchronizedCanvas: false,
        highlighterAlpha: this.options.plugin.settings?.highlighterAlpha ?? 0.35,
        debug: false,
      },
      {
        onChange: () => {
          this.isDirty = true;
          this.handleStrokeCommitted();
        },
      },
    );

    this.surface.goToPage(pageIndex);
    this.surface.setTool(this.toolState.tool);
  }

  private buildToolbar(toolbar: HTMLElement): void {
    const penBtn = toolbar.createEl("button", {
      cls: "finenotes-inline-tool-button is-active",
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

    const updateActiveTool = (btn: HTMLElement, tool: "pen" | "highlighter" | "eraser") => {
      penBtn.removeClass("is-active");
      highBtn.removeClass("is-active");
      eraseBtn.removeClass("is-active");
      btn.addClass("is-active");
      this.toolState.tool = tool;
      this.surface?.setTool(tool);
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
      const linkText = `${this.options.notebookFile.path}#page=${this.options.pageIndex + 1}`;
      await this.close();
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
    if (!this.page) return;
    const last = this.page.strokes[this.page.strokes.length - 1];
    if (!last || !last.pts || last.pts.length < 2) return;
    let maxY = -Infinity;
    for (let i = 1; i < last.pts.length; i += 3) {
      if (last.pts[i] > maxY) maxY = last.pts[i];
    }
    if (maxY > 0) {
      const expanded = expandBlockPageIfNeeded(this.page, maxY);
      if (expanded) {
        this.surface?.layout();
        if (this.openInkView) {
          this.openInkView.relayoutSurface();
        }
      }
    }
  }

  async save(): Promise<boolean> {
    if (!this.doc || !this.page || !this.isDirty) return true;
    try {
      if (this.openInkView) {
        // backing notebook is open in workspace: coordinate save through InkView
        this.openInkView.requestSave();
        this.initialMtime = this.options.notebookFile.stat?.mtime ?? 0;
      } else {
        // Concurrency check: has notebookFile changed on disk since we opened?
        const currentMtime = this.options.notebookFile.stat?.mtime ?? 0;
        if (this.initialMtime > 0 && currentMtime !== this.initialMtime) {
          const diskText = await this.options.app.vault.read(this.options.notebookFile);
          const diskParsed = parseInkFile(diskText, this.options.plugin.settings?.paperWidth);
          if (diskParsed.doc && diskParsed.doc.pages[this.options.pageIndex]) {
            // Merge our modified page into the latest disk document
            diskParsed.doc.pages[this.options.pageIndex] = this.page;
            const merged = buildInkFile(diskParsed.body, diskParsed.doc);
            await this.options.app.vault.modify(this.options.notebookFile, merged);
            this.initialMtime = this.options.notebookFile.stat?.mtime ?? 0;
          } else {
            new Notice("FineNotes: External edit conflict detected. Unsaved strokes kept in memory.");
            lastFailedSession = this;
            return false;
          }
        } else {
          // Normal canonical save: exactly ONE %%finenotes block from noteBody + doc!
          const canonical = buildInkFile(this.noteBody, this.doc);
          await this.options.app.vault.modify(this.options.notebookFile, canonical);
          this.initialMtime = this.options.notebookFile.stat?.mtime ?? 0;
        }
      }

      this.isDirty = false;
      lastFailedSession = null;

      // Re-render PNG preview if an imagePath is associated with this clip
      await this.refreshPreviewPng();
      return true;
    } catch (err) {
      console.warn("[FineNotes] Failed to save inline handwriting session:", err);
      new Notice("FineNotes: Failed to save handwriting. Unsaved ink preserved.");
      lastFailedSession = this;
      return false;
    }
  }

  private async refreshPreviewPng(): Promise<void> {
    if (!this.page) return;
    const clip = this.options.clip ?? this.page.clips?.[0];
    if (clip?.imagePath) {
      const imgFile = this.options.app.vault.getAbstractFileByPath(clip.imagePath);
      if (imgFile instanceof TFile) {
        const bounds = resolveBlockBounds(this.page, clip);
        const isDark =
          typeof document !== "undefined" && document.body?.classList.contains("theme-dark");
        const buffer = await renderClipPng(this.page, bounds, {
          images: this.options.plugin.embedManager?.pdfCache as never,
          backdropPainter: undefined as never,
          pdf: this.options.plugin.embedManager?.pdfCache,
          includeBackground: this.options.plugin.settings?.embedBackground === true,
          themeMode: isDark ? "dark" : "light",
        });
        if (buffer && buffer.byteLength > 8) {
          await this.options.app.vault.modifyBinary(imgFile, buffer);
          this.options.plugin.embedManager?.refreshEmbedImagesInDom(imgFile);
        }
      }
    }
    this.options.plugin.embedManager?.refreshEmbedsForFile(this.options.notebookFile.path);
  }

  async close(): Promise<void> {
    if (this.isClosing) return;
    this.isClosing = true;

    try {
      await this.save();
    } finally {
      this.surface?.destroy();
      this.surface = null;
      this.options.containerEl.removeClass("finenotes-inline-active");
      if (activeInlineSession === this) {
        activeInlineSession = null;
      }
      this.options.onClosed?.();
    }
  }
}

export function startInlineHandwriteSession(options: InlineSessionOptions): InlineHandwriteSession {
  const session = new InlineHandwriteSession(options);
  void session.start();
  return session;
}
