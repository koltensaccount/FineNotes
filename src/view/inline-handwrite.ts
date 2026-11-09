import { type App, type TFile, Modal, Notice } from "obsidian";
import type GoodObsidianPlugin from "../main";
import { NOTEBOOK_FILE_SUFFIX, PALETTE, SIZES } from "../constants";
import type { InkDocument, Page } from "../model/document";
import { dedicatedInkPage, mergeInlineInk } from "../model/inline-ink-merge";
import { InkSurface } from "./ink-surface";
import { toolStateFrom } from "./ink-view";
import { lassoFilterFor, Toolbar, type ToolbarState } from "./toolbar";
import { migrateWritingPresets } from "../model/writing-presets";
import { expandBlockPageIfNeeded } from "../model/handwrite-block";
import { buildInkFile, parseInkFile } from "../model/serialize";
import { editClosedNotebook, notebookIsOpen } from "./notebook-transaction";
import { dismissTransient } from "./transient-popover";
import { paperTheme } from "../canvas/backdrop";
import { ConfirmModal } from "../ui/confirm-modal";
import { WritingGuidePopover, type WritingGuideHost } from "./writing-guides";
import { writingGuidesOf, type EmbedWritingGuides } from "../model/writing-guides";

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

/** Keep the toolbar within its own block, including when the block ends. */
export function inlineToolbarOffset(viewportTop: number, blockTop: number, blockHeight: number, toolbarHeight: number): number {
  return Math.min(Math.max(0, viewportTop - blockTop), Math.max(0, blockHeight - toolbarHeight));
}

export class InlineHandwriteSession {
  private surface: InkSurface | null = null;
  private toolbar: Toolbar | null = null;
  private toolState: ToolbarState;
  private closing: Promise<boolean> | null = null;
  private saving: Promise<boolean> | null = null;
  private closed = false;
  private revision = 0;
  private savedRevision = 0;
  private recoveredRevision = 0;
  private doc: InkDocument | null = null;
  private base: Page | null = null;
  private paperIsDark = false;
  private themeCleanup: (() => void) | null = null;
  private keydownCleanup: (() => void) | null = null;
  private guidePopover: WritingGuidePopover | null = null;
  private get guidesEnabled(): boolean {
    return this.currentPage?.clips?.[0]?.writingGuides?.enabled === true;
  }

  private get writingGuides(): EmbedWritingGuides {
    return this.currentPage?.clips?.[0]?.writingGuides ?? {
      enabled: false,
      includeInPreview: false,
      style: writingGuidesOf(this.options.plugin.settings.writingGuides),
    };
  }
  private readonly guideSubscribers = new Set<() => void>();

  constructor(private readonly options: InlineSessionOptions) {
    this.toolState = toolStateFrom(options.plugin.settings);
    this.paperIsDark =
      options.containerEl.ownerDocument?.body?.classList.contains("theme-dark") ?? false;
    // The inline save transaction supports handwriting and drawn shapes.
    this.toolState.lassoFilter = {
      ...lassoFilterFor(this.toolState),
      images: false,
      textBoxes: false,
    };
  }

  get hostContainer(): HTMLElement {
    return this.options.containerEl;
  }

  get currentPage(): Page | null {
    return this.doc?.pages[0] ?? null;
  }

  get inkSurface(): InkSurface | null {
    return this.surface;
  }

  get dirty(): boolean {
    return this.revision !== this.savedRevision;
  }

  async start(): Promise<void> {
    const { app, containerEl, notebookFile, blockId, plugin } = this.options;
    while (activeInlineSession && activeInlineSession !== this) {
      if (activeInlineSession.hostContainer === containerEl || !(await activeInlineSession.close()))
        return;
    }
    if (this.closed || !containerEl.isConnected) return;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    activeInlineSession = this;

    try {
      if (notebookIsOpen(app, notebookFile)) {
        throw new Error("Close the full notebook editor before writing inline.");
      }
      const content = await app.vault.read(notebookFile);
      if (this.closed || !containerEl.isConnected) {
        await this.close();
        return;
      }
      if (notebookIsOpen(app, notebookFile)) {
        throw new Error("Close the full notebook editor before writing inline.");
      }
      const parsed = parseInkFile(content, plugin.settings.paperWidth);
      if (!parsed.doc) throw new Error("The handwriting notebook could not be read.");
      const page = dedicatedInkPage(parsed.doc, blockId);
      this.base = structuredClone(page);
      this.doc = {
        version: parsed.doc.version,
        view: { scrollY: 0, width: page.geometry.width, scale: 1 },
        pages: [page],
      };

      containerEl.empty();
      containerEl.removeClass("has-png-preview");
      containerEl.addClass("finenotes-inline-active", "is-inline-locked");

      const toolbarHost = containerEl.createDiv({ cls: "finenotes-inline-toolbar-host" });
      let toolbarOffset = 0;
      const palette = [...PALETTE, ...plugin.settings.customColors];
      this.toolbar = new Toolbar(
        toolbarHost,
        palette,
        SIZES,
        this.toolState,
        {
          returnToPenOnReselect: () => plugin.settings.returnToPenOnReselect === true,
          onToolChange: (tool) => {
            dismissTransient(containerEl.ownerDocument);
            this.surface?.setTool(tool);
          },
          onColorChange: () => {},
          onLineStyleChange: (style) => {
            plugin.settings.penLineStyle = style;
            void plugin.saveSettings();
          },
          onSizeChange: () => {},
          onPressureToggle: (enabled) => this.surface?.setPressure(enabled),
          onPenDynamicsChange: (val) => {
            plugin.settings.penDynamics = val;
            void plugin.saveSettings();
          },
          pressureAllowed: () => plugin.settings.pressureWidth,
          onPressurePreferenceChange: (enabled) => {
            void plugin.setPressureWidth(enabled);
          },
          onUndo: () => this.surface?.undo(),
          onRedo: () => this.surface?.redo(),
          onClear: async () => {
            if (!this.surface) return;
            const confirmed = await ConfirmModal.confirm(app, {
              title: "Clear page ink?",
              message:
                "Remove handwriting, highlighter ink and drawn shapes on this page? Images and text boxes are kept. You can undo this action.",
              cta: "Clear page",
            });
            if (confirmed) {
              this.surface.clearStrokes();
            }
          },
          onAddPage: () => {},
          onPenTypeChange: (spec) => {
            plugin.settings.penType = spec.id;
            plugin.savePenType(spec.id);
            this.toolbar?.syncActive();
          },
          onEraserChange: (mode, size) => plugin.saveEraser(mode, size),
          onEraserFilterChange: (filter) => plugin.saveEraserFilter(filter),
          onLassoChange: () => {},
          onToggleThumbnails: () => {},
          onTextStyle: () => {},
          onTextList: () => {},
          onTextDelete: () => {},
          onPenAutoShapeChange: (enabled) => plugin.savePenAutoShape(enabled),
          onConstrainShapesChange: (enabled) => plugin.saveConstrainShapes(enabled),
          onPenGesturesChange: (gestures) => plugin.savePenGestures(gestures),
          onShapeColorChange: (color) => plugin.saveShapeColor(color),
          onRecentColors: (colors) => plugin.saveRecentColors(colors),
          onTextToolChange: () => {},
          onInsertImage: () => {},
          onInsertPdf: () => {},
          onAi: () => {},
          onRecord: () => {},
          onSettings: () => {},
          onShare: () => {},
          onSearch: () => {},
          onMore: () => {},
          onWritingGuides: (anchor) => this.toggleGuidePopover(anchor),
          writingGuidesEnabled: () => this.guidesEnabled,
          onToolbarLayoutChange: () => {},
          onToolbarPositionChange: () => {},
          onOptionsPositionChange: () => {},
        },
        {
          inline: true,
          defaultSize: plugin.settings.defaultSize,
          writingPresets: plugin.settings.writingPresets ?? migrateWritingPresets(plugin.settings),
          onPresetsChange: (presets) => {
            void plugin.saveWritingPresets(presets).catch(() => {});
          },
          highlighterAlpha: plugin.settings.highlighterAlpha,
          previewPaper: () => {
            const cur = this.currentPage;
            return cur && "paperColor" in cur.backdrop
              ? (cur.backdrop.paperColor ?? paperTheme(this.paperIsDark).paper)
              : paperTheme(this.paperIsDark).paper;
          },
          onDone: () => void this.close(),
          onOpenNotebook: async () => {
            if (!(await this.close())) return;
            const linkText = `${notebookFile.path}#^${blockId}`;
            void app.workspace.openLinkText(linkText, this.options.sourcePath, false);
          },
        },
      );
      this.toolbar?.setHistoryState?.(false, false);

      const host = containerEl.createDiv({ cls: "finenotes-inline-surface-host" });
      this.surface = new InkSurface(
        host,
        this.doc,
        this.toolState,
        {
          app,
          highlighterAlpha: plugin.settings.highlighterAlpha,
          darkPaper: this.paperIsDark,
          desynchronizedCanvas: false,
          hideMacCanvasCursor: plugin.settings.hideMacCanvasCursor,
          debug: false,
          inline: true,
        },
        {
          onChange: () => {
            this.revision++;
            this.handleStrokeCommitted();
          },
          onHistoryChange: (canUndo, canRedo) => this.toolbar?.setHistoryState?.(canUndo, canRedo),
          onInlineViewportTop: (top) => {
            const offset = top === null ? 0 : inlineToolbarOffset(
              top, containerEl.getBoundingClientRect().top,
              containerEl.clientHeight, toolbarHost.offsetHeight,
            );
            if (offset === toolbarOffset) return;
            toolbarOffset = offset;
            toolbarHost.style.translate = offset ? `0 ${offset}px` : "";
            if (this.toolbar?.hasOpenPopover()) this.toolbar.applyPosition();
          },
        },
      );
      this.surface.setTool(this.toolState.tool);
      this.surface.setWritingGuides(this.guidesEnabled, this.writingGuides.style);
      this.toolbar?.syncWritingGuides();

      // Listen for Obsidian theme toggles during inline handwriting
      const onCssChange = () => {
        const isDark = containerEl.ownerDocument?.body?.classList.contains("theme-dark") ?? false;
        if (this.paperIsDark !== isDark) {
          this.paperIsDark = isDark;
          this.surface?.setDarkPaper(isDark);
          this.toolbar?.syncActive();
        }
      };
      const eventRef = app.workspace?.on?.("css-change", onCssChange);
      this.themeCleanup = eventRef ? () => app.workspace?.offref?.(eventRef) : null;

      // Bind Escape, Cmd/Ctrl+Enter, and Undo/Redo keyboard shortcuts
      const onKeyDown = (evt: KeyboardEvent) => {
        if (evt.key === "Escape") {
          evt.preventDefault();
          evt.stopPropagation();
          if (this.guidePopover?.isOpen) {
            this.guidePopover.close();
            this.guidePopover = null;
            return;
          }
          if (this.toolbar?.hasOpenPopover?.()) {
            this.toolbar.dismissPopover?.();
            return;
          }
          void this.close();
          return;
        }

        if ((evt.metaKey || evt.ctrlKey) && evt.key === "Enter") {
          evt.preventDefault();
          evt.stopPropagation();
          void this.close();
          return;
        }

        const isMac =
          typeof navigator !== "undefined" &&
          /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
        const mod = isMac ? evt.metaKey : evt.ctrlKey;
        if (mod && !evt.altKey) {
          if (evt.key === "z" || evt.key === "Z") {
            evt.preventDefault();
            evt.stopPropagation();
            if (evt.shiftKey) {
              this.surface?.redo();
            } else {
              this.surface?.undo();
            }
            return;
          }
          if (evt.key === "y" || evt.key === "Y") {
            evt.preventDefault();
            evt.stopPropagation();
            this.surface?.redo();
            return;
          }
        }
      };
      containerEl.addEventListener("keydown", onKeyDown);
      this.keydownCleanup = () => containerEl.removeEventListener("keydown", onKeyDown);

    } catch (err) {
      new Notice(
        `FineNotes: ${err instanceof Error ? err.message : "Could not open handwriting."}`,
      );
      await this.close();
    }
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
    this.saving = this.persist(this.base, structuredClone(this.currentPage), this.revision).finally(
      () => {
        this.saving = null;
      },
    );
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
      new Notice(
        `FineNotes: ${reason} ${recovered ? "Recovery copy saved." : "Keep this editor open and retry Done."}`,
        10000,
      );
      return false;
    }
    // Advance only through the snapshot that was written. Keep external ink out
    // of the local undo stack, so a later save cannot accidentally erase it.
    this.base = page;
    this.savedRevision = revision;
    try {
      plugin.embedManager?.refreshEmbedsForFile(notebookFile.path);
      await plugin.embedManager?.refreshPngEmbeds(notebookFile);
    } catch (err) {
      console.warn("[FineNotes] Handwriting saved; preview refresh failed:", err);
    }
    return true;
  }

  private recoveryText(page: Page): string {
    const copy = structuredClone(page);
    delete copy.pageEmbedPath;
    for (const clip of copy.clips ?? []) delete clip.imagePath;
    const { version, view } = this.doc!;
    return buildInkFile(
      `# Recovered handwriting

Source notebook: ${this.options.notebookFile.path}

Block: ${page.id}`,
      {
        version,
        view,
        pages: [copy],
      },
    );
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
    modal.contentEl.createEl("p", {
      text: "The notebook and recovery copy could not be written. Copy this text into a new .notebook.md file, or close this dialog and retry the handwriting block.",
    });
    const text = modal.contentEl.createEl("textarea");
    text.value = this.recoveryText(page);
    text.readOnly = true;
    text.rows = 8;
    modal.open();
    text.select();
  }

  close(detached = false): Promise<boolean> {
    if (this.closed) return Promise.resolve(true);
    if (this.closing)
      return detached ? this.closing.then((closed) => closed || this.close(true)) : this.closing;
    this.closing = this.finishClose(detached).finally(() => {
      this.closing = null;
    });
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
        if (!(await this.checkpoint(this.currentPage, this.revision))) {
          this.showRecovery(this.currentPage);
          return false;
        }
      }
      this.closed = true;
      this.guidePopover?.close();
      this.guidePopover = null;
      this.guideSubscribers.clear();
      this.themeCleanup?.();
      this.themeCleanup = null;
      this.keydownCleanup?.();
      this.keydownCleanup = null;
      this.toolbar?.destroy();
      this.toolbar = null;
      this.surface?.destroy();
      this.surface = null;
      containerEl.empty();
      containerEl.removeClass("finenotes-inline-active", "is-inline-locked");
      if (activeInlineSession === this) activeInlineSession = null;
      onClosed?.();
      return true;
    } finally {
      containerEl.inert = false;
    }
  }

  private toggleGuidePopover(anchor: HTMLElement): void {
    const open = this.guidePopover;
    this.guidePopover = null;
    if (open?.isOpen) {
      open.close();
      if (open.anchorEl === anchor) return;
    }
    this.guidePopover = new WritingGuidePopover(anchor, this.writingGuideHost());
  }

  private writingGuideHost(): WritingGuideHost {
    return {
      state: () => ({
        enabled: this.guidesEnabled,
        style: this.writingGuides.style,
        includeInPreview: this.writingGuides.includeInPreview,
        ...(this.surface?.writingGuideContext() ?? { eligible: true, paper: "#ffffff", scale: 1 }),
      }),
      enable: (enabled) => this.updateWritingGuides({ enabled }),
      includeInPreview: (includeInPreview) => this.updateWritingGuides({ includeInPreview }),
      configure: (patch) => this.updateWritingGuides({ style: writingGuidesOf({ ...this.writingGuides.style, ...patch }) }),
      subscribe: (changed) => {
        this.guideSubscribers.add(changed);
        return () => {
          this.guideSubscribers.delete(changed);
        };
      },
    };
  }

  private updateWritingGuides(patch: Partial<EmbedWritingGuides>): void {
    const clip = this.currentPage?.clips?.[0];
    if (!clip || this.closed || this.closing) return;
    const current = this.writingGuides;
    const next = { ...current, ...patch };
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    clip.writingGuides = next;
    this.revision++;
    this.toolbar?.syncWritingGuides();
    this.surface?.setWritingGuides(next.enabled, next.style);
    for (const sub of this.guideSubscribers) sub();
  }
}

export function startInlineHandwriteSession(
  options: InlineSessionOptions,
): InlineHandwriteSession {
  const session = new InlineHandwriteSession(options);
  void session.start();
  return session;
}
