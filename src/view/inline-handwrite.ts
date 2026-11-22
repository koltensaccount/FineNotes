/**
 * Inline Handwrite Here session built directly on upstream 2.10.0's real
 * `Toolbar` and `InkSurface` — zero duplicated menus, 100% consistent with
 * the locked Visual Identity, and limited to only the tools that belong
 * inside a Markdown note.
 */

import { type App, type TFile, Notice, setIcon } from "obsidian";
import type GoodObsidianPlugin from "../main";
import { PALETTE, SIZES } from "../constants";
import type { InkDocument, Page } from "../model/document";
import { contentBoundsOnPage, expandBlockPageIfNeeded } from "../model/handwrite-block";
import { dedicatedInkPage, mergeInlineInk } from "../model/inline-ink-merge";
import { parseInkFile } from "../model/serialize";
import { DARK_PAPER, LIGHT_PAPER } from "../canvas/backdrop";
import { InkSurface } from "./ink-surface";
import { toolStateFrom } from "./ink-view";
import { Toolbar, type ToolbarState } from "./toolbar";
import type { BarItemId, ToolbarLayout } from "./toolbar-layout";
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

/**
 * Minimal inline toolbar layout: reuses upstream's real Toolbar with only
 * the tools needed for handwriting inside a Markdown note — hiding Home,
 * Page Sidebar, Search, AI, Calculator, Fullscreen, Add Page, Share/Export,
 * More, Settings, Record, PDF, Image, Stickers, Sticky Notes, Ruler, Pan,
 * Zoom, Fill, Tape, and More Tools.
 */
const INLINE_TOOLBAR_LAYOUT: ToolbarLayout = {
  start: ["undo", "redo"],
  middle: ["select", "pen", "eraser", "shape", "text"],
  end: ["stylus"],
  off: [
    "home",
    "thumbnails",
    "search",
    "ai",
    "calculator",
    "fullscreen",
    "addPage",
    "share",
    "settings",
    "record",
    "pdf",
    "image",
    "sticker",
    "sticky",
    "ruler",
    "pan",
    "zoom",
    "fill",
    "tape",
  ] as BarItemId[],
};

let activeInlineSession: InlineHandwriteSession | null = null;

export function getActiveInlineSession(): InlineHandwriteSession | null {
  return activeInlineSession;
}

export class InlineHandwriteSession {
  private surface: InkSurface | null = null;
  private toolbar: Toolbar | null = null;
  private toolState: ToolbarState;
  private doc: InkDocument | null = null;
  private base: Page | null = null;
  private closed = false;
  private dirty = false;
  private onlyStylus = false;
  private closing: Promise<boolean> | null = null;
  private saveTimer: number | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private readonly options: InlineSessionOptions) {
    this.onlyStylus = options.plugin.settings.onlyStylusMode === true;
    this.toolState = toolStateFrom(options.plugin.settings);
    if (
      this.toolState.tool !== "pen" &&
      this.toolState.tool !== "highlighter" &&
      this.toolState.tool !== "eraser" &&
      this.toolState.tool !== "select" &&
      this.toolState.tool !== "shape" &&
      this.toolState.tool !== "text"
    ) {
      this.toolState.tool = "pen";
    }
  }

  get hostContainer(): HTMLElement {
    return this.options.containerEl;
  }

  async start(): Promise<void> {
    const { app, containerEl, notebookFile, blockId, plugin } = this.options;
    while (activeInlineSession && activeInlineSession !== this) {
      if (activeInlineSession.hostContainer === containerEl || !(await activeInlineSession.close())) {
        return;
      }
    }
    if (this.closed) return;
    if (!containerEl.isConnected) {
      await new Promise<void>((r) => window.requestAnimationFrame(() => r()));
      if (this.closed) return;
    }
    activeInlineSession = this;

    try {
      if (notebookIsOpen(app, notebookFile)) {
        throw new Error("Close the full notebook editor before writing inline.");
      }
      const content = await app.vault.read(notebookFile);
      if (this.closed) {
        await this.close();
        return;
      }
      const parsed = parseInkFile(content, plugin.settings.paperWidth);
      if (!parsed.doc) throw new Error("The handwriting notebook could not be read.");

      // Support both dedicated block pages (block-*) and legacy clip pages.
      let page: Page;
      try {
        page = dedicatedInkPage(parsed.doc, blockId);
      } catch {
        const fallback = parsed.doc.pages.find(
          (p) => p.id === blockId || p.clips?.some((c) => c.id === blockId),
        );
        if (!fallback) throw new Error("The handwriting block was removed from its notebook.");
        page = fallback;
      }

      this.base = structuredClone(page);
      this.doc = {
        version: parsed.doc.version,
        view: { scrollY: 0, width: page.geometry.width, scale: 1 },
        pages: [page],
      };

      containerEl.empty();
      containerEl.addClass("finenotes-inline-active");

      const barHost = containerEl.createDiv({ cls: "finenotes-inline-toolbar-host" });
      const canvasHost = containerEl.createDiv({ cls: "finenotes-inline-canvas-host" });
      const syncHeight = (): void => {
        const h = this.doc?.pages[0]?.geometry.height ?? 360;
        const w = this.doc?.pages[0]?.geometry.width ?? 800;
        const availW = Math.max(300, canvasHost.clientWidth || containerEl.clientWidth || w);
        const scaledH = Math.max(240, Math.round((h * availW) / w));
        canvasHost.style.height = `${scaledH}px`;
      };
      syncHeight();

      const palette = [...PALETTE, ...(plugin.settings.customColors ?? [])];
      const darkPaper = containerEl.ownerDocument?.body?.classList.contains("theme-dark") ?? false;

      this.toolbar = new Toolbar(
        barHost,
        palette,
        SIZES,
        this.toolState,
        {
          returnToPenOnReselect: () => plugin.settings.returnToPenOnReselect === true,
          onToolChange: (tool) => this.surface?.setTool(tool),
          onColorChange: () => {},
          onSizeChange: () => {},
          onPressureToggle: () => {},
          onUndo: () => {
            this.surface?.undo();
            this.syncUndoRedo();
          },
          onRedo: () => {
            this.surface?.redo();
            this.syncUndoRedo();
          },
          onClear: () => {
            this.surface?.clearStrokes();
            this.syncUndoRedo();
          },
          onOnlyStylusMode: (on) => {
            this.onlyStylus = on;
            this.surface?.onlyStylusChanged();
          },
        },
        {
          layout: INLINE_TOOLBAR_LAYOUT,
          onlyStylusMode: this.onlyStylus,
        },
      );

      // Hide accessories & more buttons (pinned in upstream's bar model, not needed inline)
      // and append a crisp SVG Done button to close & save cleanly.
      const barEl = barHost.querySelector<HTMLElement>(".goodobsidian-toolbar");
      if (barEl) {
        barEl.querySelectorAll<HTMLElement>(
          'button[data-item="accessories"], button[data-item="more"]',
        ).forEach((el) => {
          el.style.display = "none";
        });
        const endGroup = barEl.querySelector<HTMLElement>(".goodobsidian-bar-doc") ?? barEl;
        const doneBtn = endGroup.createEl("button", {
          cls: "clickable-icon finenotes-inline-done",
          attr: { "aria-label": "Done writing", title: "Done writing (Esc)" },
        });
        setIcon(doneBtn, "check");
        doneBtn.addEventListener("click", () => {
          void this.close();
        });
      }

      this.surface = new InkSurface(
        canvasHost,
        this.doc,
        this.toolState,
        {
          desynchronizedCanvas: false,
          highlighterAlpha: plugin.settings.highlighterAlpha,
          paper: darkPaper ? DARK_PAPER : LIGHT_PAPER,
          debug: false,
          palette,
        },
        {
          onlyStylusMode: () => this.onlyStylus,
          onChange: () => {
            this.dirty = true;
            this.syncUndoRedo();
            const activePage = this.doc?.pages[0];
            if (activePage) {
              const bounds = contentBoundsOnPage(activePage);
              if (bounds && expandBlockPageIfNeeded(activePage, bounds.maxY)) {
                syncHeight();
              }
            }
            this.scheduleSave();
          },
        },
      );

      this.syncUndoRedo();

      this.keydownHandler = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          void this.close();
        }
      };
      containerEl.ownerDocument.addEventListener("keydown", this.keydownHandler);
    } catch (err) {
      activeInlineSession = null;
      this.closed = true;
      new Notice(`FineNotes: ${err instanceof Error ? err.message : String(err)}`);
      this.options.onClosed?.();
    }
  }

  private syncUndoRedo(): void {
    if (!this.toolbar || !this.surface) return;
    this.toolbar.setHistoryState(this.surface.canUndo, this.surface.canRedo);
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.flushSave();
    }, 1200);
  }

  private async flushSave(): Promise<boolean> {
    if (!this.dirty || !this.doc || !this.base) return true;
    const { app, notebookFile, blockId, plugin } = this.options;
    const localPage = structuredClone(this.doc.pages[0]);
    const basePage = this.base;
    try {
      await editClosedNotebook(app, notebookFile, plugin.settings.paperWidth, (diskDoc) => {
        const latest =
          diskDoc.pages.find((p) => p.id === blockId) ??
          diskDoc.pages.find((p) => p.clips?.some((c) => c.id === blockId));
        if (!latest) throw new Error("The handwriting block was removed from its notebook.");
        mergeInlineInk(basePage, localPage, latest);
      });
      this.base = localPage;
      this.dirty = false;
      return true;
    } catch (err) {
      new Notice(`FineNotes: could not save inline handwriting — ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  close(): Promise<boolean> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      if (this.saveTimer !== null) {
        window.clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      await this.flushSave();
      this.closed = true;
      if (this.keydownHandler) {
        this.options.containerEl.ownerDocument.removeEventListener("keydown", this.keydownHandler);
        this.keydownHandler = null;
      }
      this.surface?.destroy();
      this.surface = null;
      this.toolbar?.destroy();
      this.toolbar = null;
      if (activeInlineSession === this) activeInlineSession = null;
      this.options.containerEl.removeClass("finenotes-inline-active");
      this.options.onClosed?.();
      return true;
    })();
    return this.closing;
  }
}

export async function startInlineHandwriteSession(
  options: InlineSessionOptions,
): Promise<InlineHandwriteSession> {
  const session = new InlineHandwriteSession(options);
  await session.start();
  return session;
}
