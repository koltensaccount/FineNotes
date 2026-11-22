import { type App, type TFile, Notice, setIcon } from "obsidian";
import type GoodObsidianPlugin from "../main";
import { attachmentDefaults } from "../settings-data";
import { NOTEBOOK_FILE_SUFFIX, PALETTE, SIZES } from "../constants";
import { InsertImage } from "../model/commands";
import { resolveAttachmentFolder } from "../model/attachment-folders";
import { newImageElement, placeImageBox } from "../model/images";
import type { InkDocument, Page } from "../model/document";
import {
  contentBoundsOnPage,
  expandBlockPageIfNeeded,
  fitBlockPageHeight,
  normalizeBlockWhiteInkToBlack,
} from "../model/handwrite-block";
import { dedicatedInkPage, mergeInlineInk } from "../model/inline-ink-merge";
import { buildInkFile, parseInkFile } from "../model/serialize";
import { DARK_PAPER, LIGHT_PAPER } from "../canvas/backdrop";
import {
  DEFAULT_WRITING_GUIDES,
  embedWritingGuidesOf,
  writingGuidesOf,
  type EmbedWritingGuides,
} from "../model/writing-guides";
import { FN_ICON_WRITING_GUIDES } from "./finenotes-icons";
import { WritingGuidePopover, type WritingGuideHost } from "./writing-guides";
import { ConfirmModal } from "../ui/confirm-modal";
import { pickImageFiles, prepareImageBytes, saveImageAttachment } from "./image-import";
import { copyPictureToSystemClipboard } from "./picture-clipboard";
import { VaultImageCache } from "./image-cache";
import { InkSurface } from "./ink-surface";
import { toolStateFrom } from "./ink-view";
import { penOfState, Toolbar, type ToolbarState } from "./toolbar";
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

const INLINE_TOOLBAR_LAYOUT: ToolbarLayout = {
  start: ["undo", "redo"],
  middle: ["select", "pen", "eraser", "shape", "text", "accessories"],
  end: ["stylus"],
  off: [],
};
const INLINE_BAR_ITEMS = new Set<BarItemId>([
  ...INLINE_TOOLBAR_LAYOUT.start,
  ...INLINE_TOOLBAR_LAYOUT.middle,
  ...INLINE_TOOLBAR_LAYOUT.end,
  "ruler", "fill", "tape", "image",
]);

const ISOLATED_EVENTS = [
  "mousedown",
  "pointerdown",
  "touchstart",
  "touchend",
  "click",
  "dblclick",
  "contextmenu",
] as const;

let activeInlineSession: InlineHandwriteSession | null = null;

export function getActiveInlineSession(): InlineHandwriteSession | null {
  return activeInlineSession;
}

export class InlineHandwriteSession {
  private surface: InkSurface | null = null;
  private toolbar: Toolbar | null = null;
  private images: VaultImageCache | null = null;
  private toolState: ToolbarState;
  private doc: InkDocument | null = null;
  private base: Page | null = null;
  private closed = false;
  private revision = 0;
  private savedRevision = 0;
  private saves: Promise<boolean> = Promise.resolve(true);
  private onlyStylus = false;
  private paperIsDark = false;
  private imageFolder: string | undefined;
  private closing: Promise<boolean> | null = null;
  private saveTimer: number | null = null;
  private cleanups: Array<() => void> = [];

  constructor(private readonly options: InlineSessionOptions) {
    this.onlyStylus = options.plugin.settings.onlyStylusMode === true;
    this.paperIsDark =
      options.containerEl.ownerDocument?.body?.classList.contains("theme-dark") ?? false;
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
    if (this.closed || !containerEl.isConnected) return;
    activeInlineSession = this;
    const contentEditable = containerEl.getAttribute("contenteditable");
    containerEl.setAttribute("contenteditable", "false");
    this.cleanups.push(() => {
      if (contentEditable === null) containerEl.removeAttribute("contenteditable");
      else containerEl.setAttribute("contenteditable", contentEditable);
    });

    // Isolate pointer/mouse/touch/click events so Obsidian Live Preview
    // (CodeMirror 6) never moves the cursor into the ```finenotes``` fence
    // and flips the active handwriting editor back into raw Markdown code.
    const stopBubble = (e: Event): void => {
      e.stopPropagation();
    };
    for (const evt of ISOLATED_EVENTS) {
      containerEl.addEventListener(evt, stopBubble);
      this.cleanups.push(() => containerEl.removeEventListener(evt, stopBubble));
    }

    try {
      if (notebookIsOpen(app, notebookFile)) {
        throw new Error("Close the full notebook editor before writing inline.");
      }
      const content = await app.vault.read(notebookFile);
      if (this.closed || this.closing || !containerEl.isConnected) {
        await this.close();
        return;
      }
      if (notebookIsOpen(app, notebookFile)) {
        throw new Error("Close the full notebook editor before writing inline.");
      }
      const parsed = parseInkFile(content, plugin.settings.paperWidth);
      if (!parsed.doc) throw new Error("The handwriting notebook could not be read.");

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

      this.imageFolder = resolveAttachmentFolder(parsed.doc, "images", attachmentDefaults(plugin.settings));
      const dedicated = page.id === blockId && page.clips?.length === 1 &&
        page.clips[0].id === blockId && page.clips[0].isExpandable === true;
      this.base = structuredClone(page);
      if (dedicated && normalizeBlockWhiteInkToBlack(page) > 0) {
        this.revision++;
        this.scheduleSave();
      }
      this.doc = {
        version: parsed.doc.version,
        view: { scrollY: 0, width: page.geometry.width, scale: 1 },
        pages: [page],
      };

      containerEl.empty();
      containerEl.removeClass("finenotes-embed-card");
      containerEl.addClass("finenotes-inline-active");
      containerEl.tabIndex = -1;

      const barHost = containerEl.createDiv({ cls: "finenotes-inline-toolbar-host" });
      const canvasHost = containerEl.createDiv({ cls: "finenotes-inline-canvas-host" });
      let widthLocked = dedicated;
      const syncHeight = (): void => {
        const h = this.doc?.pages[0]?.geometry.height ?? 360;
        const w = this.doc?.pages[0]?.geometry.width ?? 800;
        const availW = canvasHost.clientWidth || w;
        const scale = widthLocked ? availW / w : Math.min(1, availW / w);
        const scaledH = Math.max(260, Math.ceil(h * scale));
        canvasHost.style.height = `${scaledH}px`;
      };
      const growPage = (y: number, buffer?: number): boolean => {
        if (!dedicated || !expandBlockPageIfNeeded(page, y, buffer)) return false;
        syncHeight();
        return true;
      };
      syncHeight();
      const resize = new ResizeObserver(syncHeight);
      resize.observe(canvasHost);
      this.cleanups.push(() => resize.disconnect());

      const palette = [...PALETTE, ...(plugin.settings.customColors ?? [])];

      this.toolbar = new Toolbar(
        barHost,
        palette,
        SIZES,
        this.toolState,
        {
          returnToPenOnReselect: () => plugin.settings.returnToPenOnReselect === true,
          onToolChange: (tool) => this.surface?.setTool(tool),
          onColorChange: () => this.rememberPen(),
          onSizeChange: () => this.rememberPen(),
          onPressureToggle: () => this.surface?.refreshPenCursor(),
          onPenTypeChange: () => {
            this.surface?.refreshPenCursor();
            this.rememberPen();
          },
          onWidthPresets: (presets) => plugin.saveWidthPresets(presets),
          onEraserPresets: (presets) => plugin.saveEraserPresets(presets),
          onEraserChange: (mode, size) => plugin.saveEraser(mode, size),
          onEraserFilterChange: (filter) => plugin.saveEraserFilter(filter),
          onLassoChange: (mode, filter) => {
            this.surface?.refreshLassoChrome();
            plugin.saveLasso(mode, filter);
          },
          onPenGesturesChange: (gestures) => plugin.savePenGestures(gestures),
          onRecentColors: (colors) => plugin.saveRecentColors(colors),
          onTextStyle: (patch) => this.surface?.applyTextStyle(patch),
          onTextSizePreview: (size) => this.surface?.previewTextSize(size),
          onTextFieldDone: (to) => this.surface?.textFieldDone(to),
          onTextList: (kind) => void this.surface?.applyTextList(kind),
          onTextDelete: () => void this.surface?.deleteEditingTextBox(),
          onInsertImage: () => {
            void pickImageFiles(containerEl, false, "image/*", false).then(([file]) => {
              if (file) void this.pastePicture(file);
            });
          },
          onRuler: () => {
            const surface = this.surface;
            if (!surface) return;
            surface.setRulerOut(!surface.rulerOut);
            this.toolbar?.setRulerOut(surface.rulerOut);
          },
          onRulerChange: (kind, snap) => {
            this.surface?.setRulerOut(true);
            this.toolbar?.setRulerOut(true);
            plugin.saveRuler(kind, snap);
          },
          pressureAllowed: () => plugin.settings.pressureWidth === true,
          onUndo: () => {
            this.surface?.undo();
            this.syncUndoRedo();
          },
          onRedo: () => {
            this.surface?.redo();
            this.syncUndoRedo();
          },
          onClear: async () => {
            if (!this.surface) return;
            if (!dedicated) {
              new Notice("Open the full notebook to clear a page shared by multiple handwriting clips.");
              return;
            }
            const confirmed = await ConfirmModal.confirm(app, {
              title: "Clear block ink?",
              message: "Remove handwriting and drawn shapes in this block? You can undo this action.",
              cta: "Clear",
            });
            if (confirmed) {
              this.surface?.clearStrokes();
              this.syncUndoRedo();
            }
          },
          onOnlyStylusMode: (on) => {
            this.onlyStylus = on;
            this.toolbar?.setOnlyStylusMode(on);
            this.surface?.onlyStylusChanged();
          },
          onLayout: (next) => {
            plugin.settings.inlineToolbarLayout = next;
            void plugin.saveSettings();
          },
        },
        {
          layout: plugin.settings.inlineToolbarLayout ?? INLINE_TOOLBAR_LAYOUT,
          allowedItems: INLINE_BAR_ITEMS,
          popoverBounds: containerEl,
          resetLayout: INLINE_TOOLBAR_LAYOUT,
          onlyStylusMode: this.onlyStylus,
        },
      );

      const barEl = barHost.querySelector<HTMLElement>(".goodobsidian-toolbar");
      if (barEl) {
        const endGroup = barEl.querySelector<HTMLElement>(".goodobsidian-bar-doc") ?? barEl;

        const guidesBtn = endGroup.createEl("button", {
          cls: "clickable-icon finenotes-inline-guides",
          attr: { "aria-label": "Writing guides" },
        });
        setIcon(guidesBtn, FN_ICON_WRITING_GUIDES);
        let guidePopover: WritingGuidePopover | null = null;
        const guideListeners = new Set<() => void>();
        const currentGuides = (): EmbedWritingGuides => {
          const raw = this.doc?.pages[0]?.clips?.[0]?.writingGuides;
          return (
            embedWritingGuidesOf(raw) ?? {
              enabled: false,
              includeInPreview: false,
              style: { ...DEFAULT_WRITING_GUIDES },
            }
          );
        };
        const syncGuidesButton = (): void => {
          const on = currentGuides().enabled;
          guidesBtn.toggleClass("is-active", on);
          guidesBtn.setAttribute("aria-pressed", String(on));
        };
        const applyGuides = (patch: Partial<EmbedWritingGuides>): void => {
          const clip = this.doc?.pages[0]?.clips?.[0];
          if (!clip) return;
          const next: EmbedWritingGuides = { ...currentGuides(), ...patch };
          clip.writingGuides = next as unknown as Record<string, unknown>;
          clip.updatedAt = Date.now();
          this.revision++;
          this.surface?.setWritingGuides(next.enabled, next.style);
          syncGuidesButton();
          for (const fn of guideListeners) fn();
          this.scheduleSave();
        };
        const guideHost: WritingGuideHost = {
          state: () => {
            const g = currentGuides();
            return {
              enabled: g.enabled,
              includeInPreview: g.includeInPreview,
              transparentBackground: plugin.settings.embedBackground !== true,
              style: g.style,
              ...(this.surface?.writingGuideContext() ?? {
                eligible: true,
                paper: this.paperIsDark ? DARK_PAPER.paper : LIGHT_PAPER.paper,
                scale: 1,
              }),
            };
          },
          enable: (enabled) => applyGuides({ enabled }),
          includeInPreview: (includeInPreview) => applyGuides({ includeInPreview }),
          setTransparentBackground: (transparent) => {
            plugin.settings.embedBackground = !transparent;
            void plugin.saveSettings();
            for (const fn of guideListeners) fn();
          },
          configure: (patch) =>
            applyGuides({
              enabled: true,
              style: writingGuidesOf({ ...currentGuides().style, ...patch }),
            }),
          subscribe: (fn) => {
            guideListeners.add(fn);
            return () => guideListeners.delete(fn);
          },
        };
        syncGuidesButton();
        guidesBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (guidePopover?.isOpen) {
            guidePopover.close();
            guidePopover = null;
            return;
          }
          guidePopover = new WritingGuidePopover(guidesBtn, guideHost, () => {
            guidePopover = null;
          });
        });
        this.cleanups.push(() => {
          guidePopover?.close();
          guidePopover = null;
          guideListeners.clear();
        });

        if (dedicated) {
          const widthBtn = endGroup.createEl("button", {
            cls: "clickable-icon finenotes-inline-width",
          });
          const syncWidthButton = (): void => {
            const label = widthLocked ? "Unlock page width" : "Lock page width";
            setIcon(widthBtn, widthLocked ? "lock" : "lock-open");
            widthBtn.setAttribute("aria-pressed", String(widthLocked));
            widthBtn.setAttribute("aria-label", label);
          };
          syncWidthButton();
          widthBtn.addEventListener("click", () => {
            widthLocked = !widthLocked;
            syncWidthButton();
            syncHeight();
            this.surface?.setInlineWidthLocked(widthLocked);
          });
        }

        const openBtn = endGroup.createEl("button", {
          cls: "clickable-icon finenotes-inline-open",
          attr: { "aria-label": "Open in full notebook" },
        });
        setIcon(openBtn, "external-link");
        openBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          void (async () => {
            if (!(await this.close())) return;
            void app.workspace.openLinkText(
              `${notebookFile.path}#^${blockId}`,
              this.options.sourcePath,
              false,
            );
          })();
        });

        const doneBtn = endGroup.createEl("button", {
          cls: "clickable-icon finenotes-inline-done",
          attr: { "aria-label": "Done writing (Esc)" },
        });
        setIcon(doneBtn, "check");
        doneBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          void this.close();
        });
      }

      this.images = new VaultImageCache(app);
      this.surface = new InkSurface(
        canvasHost,
        this.doc,
        this.toolState,
        {
          desynchronizedCanvas: false,
          highlighterAlpha: plugin.settings.highlighterAlpha,
          paper: this.paperIsDark ? DARK_PAPER : LIGHT_PAPER,
          debug: false,
          palette,
        },
        {
          onlyStylusMode: () => this.onlyStylus,
          fingerDrawing: () => !this.onlyStylus,
          onCopyImage: (image) => copyPictureToSystemClipboard(app, image),
          onPasteImage: (file, at) => void this.pastePicture(file, at),
          onHistoryChange: (undo, redo) => this.toolbar?.setHistoryState(undo, redo),
          onTextEditing: (style) => this.toolbar?.setTextTarget(style),
          onTextAnchor: (rect) => this.toolbar?.setTextAnchor(rect),
          textPillState: () => this.toolbar?.textPillState ?? "-",
          growInlinePage: (y, buffer) => {
            if (!growPage(y, buffer)) return false;
            this.revision++;
            this.scheduleSave();
            return true;
          },
          onChange: () => {
            this.revision++;
            this.syncUndoRedo();
            const activePage = this.doc?.pages[0];
            if (activePage && dedicated) {
              const bounds = contentBoundsOnPage(activePage);
              if (fitBlockPageHeight(activePage, bounds ? bounds.maxY : null)) {
                syncHeight();
                this.surface?.layout();
              }
            }
            this.scheduleSave();
          },
        },
      );
      this.surface.setInlineWidthLocked(widthLocked);
      this.images.onReady = (path) => this.surface?.imageReady(path);
      this.surface.setImagePainter(this.images);
      const initialGuides = embedWritingGuidesOf(this.doc.pages[0]?.clips?.[0]?.writingGuides);
      if (initialGuides?.enabled) {
        this.surface.setWritingGuides(true, initialGuides.style);
      }
      this.surface.setTool(this.toolState.tool);
      this.toolbar.setNight(this.paperIsDark);
      this.syncUndoRedo();
      containerEl.focus({ preventScroll: true });

      // Live Obsidian Dark/Light theme sync while writing inline.
      const cssRef = app.workspace.on("css-change", () => {
        const isDark = containerEl.ownerDocument?.body?.classList.contains("theme-dark") ?? false;
        if (this.paperIsDark !== isDark) {
          this.paperIsDark = isDark;
          this.surface?.setPaperTheme(isDark ? DARK_PAPER : LIGHT_PAPER);
          this.toolbar?.setNight(isDark);
          this.toolbar?.syncActive();
        }
      });
      this.cleanups.push(() => app.workspace.offref(cssRef));

      const onKeyDown = (e: KeyboardEvent): void => {
        if (e.defaultPrevented) return;
        if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key === "Enter")) {
          e.preventDefault();
          e.stopPropagation();
          void this.close();
        } else if (this.surface?.handleKeyDown(e)) {
          e.stopPropagation();
        }
      };
      const onPaste = (e: ClipboardEvent): void => {
        if (this.surface?.handlePaste(e)) e.stopPropagation();
      };
      containerEl.addEventListener("keydown", onKeyDown);
      containerEl.addEventListener("paste", onPaste);
      this.cleanups.push(() => containerEl.removeEventListener("keydown", onKeyDown));
      this.cleanups.push(() => containerEl.removeEventListener("paste", onPaste));
    } catch (err) {
      new Notice(`FineNotes: ${err instanceof Error ? err.message : String(err)}`);
      await this.close();
    }
  }

  private async pastePicture(file: File, at?: { x: number; y: number }): Promise<void> {
    const { app, notebookFile } = this.options;
    const surface = this.surface;
    const doc = this.doc;
    const page = doc?.pages[0];
    if (!surface || !doc || !page || this.closing || this.closed) return;
    try {
      const prepared = await prepareImageBytes(await file.arrayBuffer(), file.type);
      if (this.surface !== surface || this.closing) return;
      const attachment = await saveImageAttachment(
        app, prepared, file.name || "Pasted image", notebookFile.path, this.imageFolder,
      );
      if (this.surface !== surface || this.closing) return;
      const region = at
        ? { minX: at.x - 1, minY: at.y - 1, maxX: at.x + 1, maxY: at.y + 1 }
        : surface.visibleRegion(0);
      const image = newImageElement(doc, attachment.path, placeImageBox(prepared, page.geometry, region));
      surface.applyCommand(new InsertImage(page.id, image));
      surface.selectImage(page.id, image.id);
    } catch (err) {
      new Notice(`FineNotes: could not add image (${err instanceof Error ? err.message : String(err)}).`);
    }
  }

  private rememberPen(): void {
    if (this.toolState.tool === "pen" || this.toolState.tool === "highlighter") {
      this.options.plugin.saveLastPen(penOfState(this.toolState));
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
      void this.queueSave();
    }, 1200);
  }

  private async writeRecoveryCheckpoint(page: Page): Promise<boolean> {
    if (!this.doc) return false;
    try {
      const folder = this.options.notebookFile.path.slice(
        0,
        this.options.notebookFile.path.lastIndexOf("/") + 1,
      );
      const path = `${folder}FineNotes recovery ${crypto.randomUUID()}${NOTEBOOK_FILE_SUFFIX}`;
      const copy = structuredClone(page);
      delete copy.pageEmbedPath;
      for (const c of copy.clips ?? []) delete c.imagePath;
      const raw = buildInkFile(
        `# Recovered handwriting\n\nSource notebook: ${this.options.notebookFile.path}\n\nBlock: ${page.id}`,
        { version: this.doc.version, view: this.doc.view, pages: [copy] },
      );
      await this.options.app.vault.create(path, raw);
      new Notice(`FineNotes recovery saved at ${path}`, 8000);
      return true;
    } catch {
      return false;
    }
  }

  private queueSave(): Promise<boolean> {
    this.saves = this.saves.then(() => this.flushSave());
    return this.saves;
  }

  private async flushSave(): Promise<boolean> {
    if (this.savedRevision === this.revision || !this.doc || !this.base) return true;
    const { app, notebookFile, blockId, plugin } = this.options;
    const localPage = structuredClone(this.doc.pages[0]);
    const basePage = this.base;
    const revision = this.revision;
    try {
      await editClosedNotebook(app, notebookFile, plugin.settings.paperWidth, (diskDoc) => {
        const latest =
          diskDoc.pages.find((p) => p.id === blockId) ??
          diskDoc.pages.find((p) => p.clips?.some((c) => c.id === blockId));
        if (!latest) throw new Error("The handwriting block was removed from its notebook.");
        mergeInlineInk(basePage, localPage, latest);
      });
      this.base = localPage;
      this.savedRevision = revision;
      return true;
    } catch (err) {
      const recovered = !this.options.containerEl.isConnected &&
        await this.writeRecoveryCheckpoint(localPage);
      const reason = err instanceof Error ? err.message : String(err);
      new Notice(
        `FineNotes: could not save inline handwriting (${reason}). ${recovered ? "Recovery copy saved." : "Keep editor open and retry Done."}`,
        9000,
      );
      return recovered;
    }
  }

  close(): Promise<boolean> {
    if (this.closed) return Promise.resolve(true);
    if (this.closing) return this.closing;
    const host = this.options.containerEl;
    host.inert = true;
    this.closing = (async () => {
      if (this.saveTimer !== null) {
        window.clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      if (!(await this.queueSave())) return false;
      this.closed = true;
      for (const fn of this.cleanups) fn();
      this.cleanups = [];
      this.surface?.destroy();
      this.surface = null;
      this.toolbar?.destroy();
      this.toolbar = null;
      this.images?.destroy();
      this.images = null;
      if (activeInlineSession === this) activeInlineSession = null;
      host.removeClass("finenotes-inline-active");
      host.removeAttribute("tabindex");
      this.options.onClosed?.();
      return true;
    })().finally(() => {
      host.inert = false;
      this.closing = null;
    });
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
