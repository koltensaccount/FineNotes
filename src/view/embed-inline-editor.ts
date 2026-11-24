/**
 * Inline handwriting editor mounted directly over a single-page FineNotes
 * embed (`page-embed.ts`) inside a Markdown note in Live Preview.
 *
 * Reuses FineNotes' real `Toolbar` (preserving the user's exact saved pens,
 * colors, widths, and toolbar layout order) and `InkSurface`. Supports:
 * - Direct Apple Pencil writing (`touch-action: pan-y` keeps finger scroll smooth)
 * - Auto-growing bottom height on pen-up + auto-trim on Done for `hw-*` sketches
 * - Manual bottom drag handle (clamped so content is never clipped)
 * - Surface popover: Transparent (with optional Writing Guides) vs. Note Paper
 */

import { type App, type TFile, Notice, setIcon } from "obsidian";
import type GoodObsidianPlugin from "../main";
import { attachmentDefaults, penPreferencesOf } from "../settings-data";
import { PALETTE, SIZES } from "../constants";
import { pushRecentColor } from "../model/colors";
import { InsertImage } from "../model/commands";
import { resolveAttachmentFolder } from "../model/attachment-folders";
import { newImageElement, placeImageBox } from "../model/images";
import { addSavedPen, isPenId, samePen, savedPensOf } from "../model/saved-pens";
import type { InkDocument, Page, Ruling, SyntheticBackdrop } from "../model/document";
import {
  inlineClampedResizeHeight,
  inlineGrowHeight,
  inlineTrimHeight,
  isInlineSketchPage,
} from "../model/inline-sketch";
import { parseInkFile } from "../model/serialize";
import { DARK_PAPER, LIGHT_PAPER } from "../canvas/backdrop";
import {
  DEFAULT_WRITING_GUIDES,
  writingGuidesOf,
  type WritingGuideStyle,
} from "../model/writing-guides";
import { renderWritingGuideControls, type WritingGuideHost } from "./writing-guides";
import { ConfirmModal } from "../ui/confirm-modal";
import { pickImageFiles, prepareImageBytes, saveImageAttachment } from "./image-import";
import { copyPictureToSystemClipboard } from "./picture-clipboard";
import { VaultImageCache } from "./image-cache";
import { InkSurface } from "./ink-surface";
import { toolStateFrom } from "./ink-view";
import { SavedPenModal } from "./saved-pen-modal";
import { penOfState, Toolbar, type ToolbarState } from "./toolbar";
import { normalizeLayout, type BarItemId, type ToolbarLayout } from "./toolbar-layout";
import { editClosedNotebook, notebookIsOpen } from "./notebook-transaction";

export interface EmbedInlineEditRequest {
  plugin: GoodObsidianPlugin;
  app: App;
  slotEl: HTMLElement;
  notebookFile: TFile;
  pageId: string;
  pageNumber: number;
  sourcePath: string;
  onClosed?: () => void;
}

const INLINE_BAR_ITEMS = new Set<BarItemId>([
  "undo",
  "redo",
  "select",
  "pen",
  "eraser",
  "shape",
  "text",
  "accessories",
  "stylus",
  "ruler",
  "fill",
  "tape",
  "laser",
  "image",
  "sticker",
  "sticky",
  "calculator",
]);

const DEFAULT_INLINE_LAYOUT: ToolbarLayout = {
  start: ["undo", "redo"],
  middle: ["select", "pen", "eraser", "shape", "text", "accessories"],
  end: ["stylus"],
  off: [],
};

const ISOLATED_EVENTS = [
  "mousedown",
  "pointerdown",
  "touchstart",
  "touchend",
  "click",
  "dblclick",
  "contextmenu",
] as const;

const PAPER_SWATCHES: ReadonlyArray<{ label: string; color: string }> = [
  { label: "White", color: "#ffffff" },
  { label: "Ivory", color: "#fbf8f1" },
  { label: "Cream", color: "#f6f0de" },
  { label: "Charcoal", color: "#26282c" },
];

const PAPER_TEMPLATES: ReadonlyArray<{ kind: Ruling; label: string }> = [
  { kind: "blank", label: "Blank" },
  { kind: "lined", label: "Lined" },
  { kind: "grid", label: "Grid" },
  { kind: "dotted", label: "Dotted" },
];

function inlineLayoutFrom(raw: unknown, savedPenIds: ReadonlySet<string>): ToolbarLayout {
  const full = normalizeLayout(raw, savedPenIds);
  const keep = (ids: BarItemId[]): BarItemId[] =>
    ids.filter((id) => isPenId(id) || INLINE_BAR_ITEMS.has(id));
  const start = keep(full.start);
  const middle = keep(full.middle);
  const end = keep(full.end);
  if (!middle.includes("pen") && !start.includes("pen") && !end.includes("pen")) {
    middle.unshift("pen");
  }
  return { start, middle, end, off: full.off };
}

let activeEditor: EmbedInlineEditor | null = null;

function setActiveEditor(editor: EmbedInlineEditor | null): void {
  activeEditor = editor;
}

export function getActiveEmbedInlineEditor(): EmbedInlineEditor | null {
  return activeEditor;
}

export class EmbedInlineEditor {
  private surface: InkSurface | null = null;
  private toolbar: Toolbar | null = null;
  private images: VaultImageCache | null = null;
  private surfacePopover: HTMLElement | null = null;
  private surfaceBtn: HTMLButtonElement | null = null;
  private toolState: ToolbarState;
  private doc: InkDocument | null = null;
  private stageEl: HTMLElement | null = null;
  private manualHeight: number | null = null;
  private closed = false;
  private revision = 0;
  private savedRevision = 0;
  private saves: Promise<boolean> = Promise.resolve(true);
  private closing: Promise<boolean> | null = null;
  private saveTimer: number | null = null;
  private onlyStylus = false;
  private paperIsDark = false;
  private imageFolder: string | undefined;
  private guideStyle: WritingGuideStyle;
  private guidesEnabled = false;
  private guideListeners = new Set<() => void>();
  private cleanups: Array<() => void> = [];

  constructor(private readonly req: EmbedInlineEditRequest) {
    this.onlyStylus = req.plugin.stylusOnly;
    this.paperIsDark = req.slotEl.ownerDocument?.body?.classList.contains("theme-dark") ?? false;
    this.toolState = toolStateFrom(req.plugin.settings);
    this.guideStyle = writingGuidesOf(req.plugin.settings.writingGuides ?? DEFAULT_WRITING_GUIDES);
    this.guidesEnabled = req.plugin.settings.writingGuidesEnabled === true;
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

  get hostSlot(): HTMLElement {
    return this.req.slotEl;
  }

  async start(): Promise<void> {
    const { app, slotEl, notebookFile, pageId, plugin } = this.req;
    while (activeEditor && activeEditor !== this) {
      if (activeEditor.hostSlot === slotEl || !(await activeEditor.close())) {
        return;
      }
    }
    if (this.closed || !slotEl.isConnected) return;
    setActiveEditor(this);

    const contentEditable = slotEl.getAttribute("contenteditable");
    slotEl.setAttribute("contenteditable", "false");
    this.cleanups.push(() => {
      if (contentEditable === null) slotEl.removeAttribute("contenteditable");
      else slotEl.setAttribute("contenteditable", contentEditable);
    });

    // Isolate pointer/mouse/touch/click events so Live Preview (CodeMirror 6)
    // never flips the active embed back into raw `![[...]]` Markdown text.
    const stopBubble = (e: Event): void => e.stopPropagation();
    for (const evt of ISOLATED_EVENTS) {
      slotEl.addEventListener(evt, stopBubble);
      this.cleanups.push(() => slotEl.removeEventListener(evt, stopBubble));
    }

    try {
      if (notebookIsOpen(app, notebookFile)) {
        throw new Error("Close the full notebook tab before editing inline.");
      }
      const raw = await app.vault.read(notebookFile);
      if (this.closed || this.closing || !slotEl.isConnected) {
        if (activeEditor === this) setActiveEditor(null);
        return;
      }
      const parsed = parseInkFile(raw, plugin.settings.paperWidth);
      if (!parsed.doc) throw new Error("Could not read notebook ink data.");
      const target =
        parsed.doc.pages.find((p) => p.id === pageId) ?? parsed.doc.pages[this.req.pageNumber - 1];
      if (!target) throw new Error("Embedded page not found in notebook.");

      this.imageFolder = resolveAttachmentFolder(
        parsed.doc,
        "images",
        attachmentDefaults(plugin.settings),
      );
      const clone: Page = structuredClone(target);
      this.doc = {
        version: parsed.doc.version,
        view: { scrollY: 0, width: clone.geometry.width, scale: 1 },
        pages: [clone],
      };

      this.mount();
    } catch (error) {
      new Notice(
        `FineNotes: ${error instanceof Error ? error.message : "Could not open inline editor."}`,
      );
      await this.close();
    }
  }

  private rememberPen(): void {
    if (this.toolState.tool === "pen" || this.toolState.tool === "highlighter") {
      this.req.plugin.saveLastPen(penOfState(this.toolState));
    }
  }

  private syncUndoRedo(): void {
    if (!this.surface || !this.toolbar) return;
    this.toolbar.setHistoryState(this.surface.canUndo, this.surface.canRedo);
  }

  private mount(): void {
    const { app, slotEl, plugin, notebookFile } = this.req;
    const doc = this.doc;
    if (!doc) return;
    const page = doc.pages[0];
    const expandable = isInlineSketchPage(page);

    slotEl.addClass("is-inline-editing");
    const embedHost = slotEl.closest<HTMLElement>(".internal-embed, .cm-embed-block");
    embedHost?.addClass("finenotes-inline-active-embed");
    const scroller = slotEl.closest<HTMLElement>(".cm-scroller");
    scroller?.addClass("finenotes-inline-active-scroller");
    this.cleanups.push(() => {
      slotEl.removeClass("is-inline-editing");
      embedHost?.removeClass("finenotes-inline-active-embed");
      scroller?.removeClass("finenotes-inline-active-scroller");
    });

    const overlay = slotEl.createDiv({ cls: "goodobsidian-inline-overlay" });
    this.cleanups.push(() => overlay.remove());

    // Floating top bar: real FineNotes Toolbar + Surface popover + Open + Done
    const barWrap = overlay.createDiv({ cls: "goodobsidian-inline-bar" });
    const toolbarHost = barWrap.createDiv({ cls: "goodobsidian-inline-toolbar-host" });
    const trailing = barWrap.createDiv({ cls: "goodobsidian-inline-trailing" });

    const surfaceBtn = trailing.createEl("button", {
      cls: "clickable-icon goodobsidian-inline-surface-btn",
      attr: { type: "button", "aria-label": "Background & guides" },
    });
    setIcon(surfaceBtn, "layers");
    surfaceBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleSurfacePopover();
    });
    this.surfaceBtn = surfaceBtn;

    const openBtn = trailing.createEl("button", {
      cls: "clickable-icon goodobsidian-inline-open-btn",
      attr: { type: "button", "aria-label": "Open in notebook" },
    });
    setIcon(openBtn, "external-link");
    openBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void this.close().then(() => {
        void app.workspace.openLinkText(
          `${notebookFile.path}#page=${this.req.pageNumber}`,
          this.req.sourcePath,
          true,
        );
      });
    });

    const doneBtn = trailing.createEl("button", {
      cls: "clickable-icon goodobsidian-inline-done-btn",
      text: "Done",
      attr: { type: "button" },
    });
    doneBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void this.close();
    });

    // Stage hosting FineNotes' real InkSurface
    const stage = overlay.createDiv({ cls: "goodobsidian-inline-stage" });
    this.stageEl = stage;
    this.syncStageAspect();

    // Bottom drag handle for expandable inline sketches
    if (expandable) {
      const handle = overlay.createDiv({
        cls: "goodobsidian-inline-resize-handle",
        attr: { role: "separator", "aria-label": "Resize handwriting area" },
      });
      handle.createDiv({ cls: "goodobsidian-inline-resize-pill" });
      this.wireResizeHandle(handle);
    }

    const palette = [...PALETTE, ...(plugin.settings.customColors ?? [])];
    const savedPenIds = new Set(
      savedPensOf(plugin.settings.savedPens)
        .map((p) => p.id)
        .filter((id): id is string => typeof id === "string"),
    );
    const allowedItems = new Set<BarItemId>([
      ...INLINE_BAR_ITEMS,
      ...(savedPenIds as Set<BarItemId>),
    ]);

    this.toolbar = new Toolbar(
      toolbarHost,
      palette,
      SIZES,
      this.toolState,
      {
        returnToPenOnReselect: () => plugin.settings.returnToPenOnReselect === true,
        onToolChange: (tool) => this.surface?.setTool(tool),
        onColorChange: () => {
          this.surface?.refreshPenCursor();
          this.rememberPen();
        },
        onSizeChange: () => {
          this.surface?.refreshPenCursor();
          this.rememberPen();
        },
        onLaserColorChange: (color) => {
          plugin.settings.laserDefaultColor = color;
          void plugin.saveSettings();
        },
        onPressureToggle: () => this.surface?.refreshPenCursor(),
        onPenTypeChange: () => {
          this.toolbar?.syncActive();
          this.surface?.refreshPenCursor();
          this.rememberPen();
        },
        savedPens: () => savedPensOf(plugin.settings.savedPens),
        onReorderPens: (pens) => plugin.saveSavedPens(pens),
        onDeletePen: (id) =>
          plugin.saveSavedPens(
            savedPensOf(plugin.settings.savedPens).filter((pen) => pen.id !== id),
          ),
        onSavePen: (pen) =>
          plugin.saveSavedPens(addSavedPen(savedPensOf(plugin.settings.savedPens), pen)),
        onNewPen: (start, onMade) => {
          new SavedPenModal(app, {
            pen: start,
            index: null,
            pens: savedPensOf(plugin.settings.savedPens),
            highlighterAlpha: plugin.settings.highlighterAlpha,
            recent: plugin.settings.recentColors,
            palette: plugin.settings.customColors,
            onCustomColor: (color) => {
              plugin.settings.recentColors = pushRecentColor(plugin.settings.recentColors, color);
              void plugin.saveSettings();
            },
            onSave: (pen) => {
              plugin.saveSavedPens(addSavedPen(savedPensOf(plugin.settings.savedPens), pen));
              const made = savedPensOf(plugin.settings.savedPens).find((saved) =>
                samePen(saved, pen),
              );
              if (made) onMade(made);
            },
          }).open();
        },
        onEditPens: () => plugin.openSettingsTab(),
        onPenColors: (colors) => plugin.savePenColors(colors),
        onPenTypeOrder: (order) => plugin.savePenTypeOrder(order),
        onPenInks: (inks) => plugin.savePenInks(inks),
        onPenStabilization: (all) => plugin.savePenStabilization(all),
        penPreferences: () => penPreferencesOf(plugin.settings),
        onPenPreferences: (patch) => plugin.savePenPreferences(patch),
        onWidthPresets: (presets) => plugin.saveWidthPresets(presets),
        onEraserPresets: (presets) => plugin.saveEraserPresets(presets),
        onEraserChange: (mode, size) => plugin.saveEraser(mode, size),
        sizePreviewScales: () => this.surface?.sizePreviewScales() ?? { pen: 1, eraser: 1 },
        paintSizePaper: (canvas, width, height) =>
          this.surface?.paintPaperSample(canvas, width, height) ?? false,
        onEraserFilterChange: (filter) => plugin.saveEraserFilter(filter),
        onEraserGreyChange: (on) => plugin.saveEraserGrey(on),
        onLassoChange: (mode, filter) => {
          this.surface?.refreshLassoChrome();
          plugin.saveLasso(mode, filter);
        },
        onPenGesturesChange: (gestures) => plugin.savePenGestures(gestures),
        onShapeColorChange: (color) => {
          this.surface?.refreshPenCursor();
          plugin.saveShapeColor(color);
        },
        onShapeStyleChange: (style) => plugin.saveShapeStyle(style),
        onFillGapChange: (gap) => plugin.saveFillGap(gap),
        onFillColorChange: (color) => plugin.saveFillColor(color),
        onTapeChange: (color, height, mode, heights) =>
          plugin.saveTape(color, height, mode, heights),
        onTapeSnapTextChange: (on) => plugin.saveTapeSnapText(on),
        tapesShown: () => this.surface?.tapesShown() ?? null,
        onShowTapes: (shown) => this.surface?.showTapes(shown),
        onTableHeaderChange: (on) => plugin.saveTableHeader(on),
        onRecentColors: (colors) => plugin.saveRecentColors(colors),
        onPickFromPage: (done) => {
          if (this.surface) this.surface.pickColorFromPage(done);
          else done(null);
        },
        onTextToolChange: (style, pinned, dragSize) => plugin.saveTextTool(style, pinned, dragSize),
        onTextStyle: (patch) => this.surface?.applyTextStyle(patch),
        onTextSizePreview: (size) => this.surface?.previewTextSize(size),
        onTextFieldDone: (to) => this.surface?.textFieldDone(to),
        onTextList: (kind) => void this.surface?.applyTextList(kind),
        onTextDelete: () => void this.surface?.deleteEditingTextBox(),
        onInsertImage: () => {
          void pickImageFiles(slotEl, false, "image/*", false).then(([file]) => {
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
        onClear: () => {
          void ConfirmModal.confirm(app, {
            title: "Clear handwriting?",
            message: "Remove handwriting and drawn shapes in this block? You can undo this action.",
            cta: "Clear",
          }).then((confirmed) => {
            if (confirmed) {
              this.surface?.clearStrokes();
              this.syncUndoRedo();
            }
          });
        },
        onOnlyStylusMode: (on) => {
          this.onlyStylus = on;
          this.toolbar?.setOnlyStylusMode(on);
          this.surface?.onlyStylusChanged();
          void plugin.setOnlyStylusMode(on);
        },
        onLayout: (next) => {
          plugin.settings.inlineToolbarLayout = next;
          void plugin.saveSettings();
        },
      },
      {
        defaultSize: plugin.settings.defaultSize,
        reservedColors: [plugin.settings.defaultColor, ...(plugin.settings.customColors ?? [])],
        layout:
          plugin.settings.inlineToolbarLayout ??
          inlineLayoutFrom(plugin.settings.toolbarLayout, savedPenIds),
        allowedItems,
        popoverBounds: slotEl,
        resetLayout: DEFAULT_INLINE_LAYOUT,
        onlyStylusMode: plugin.stylusOnly,
        fingerDrawing: plugin.fingerDrawing,
        laserColor: () => plugin.settings.laserDefaultColor,
      },
    );

    this.images = new VaultImageCache(app);
    this.surface = new InkSurface(
      stage,
      doc,
      this.toolState,
      {
        desynchronizedCanvas: false,
        highlighterAlpha: plugin.settings.highlighterAlpha,
        paper: this.paperIsDark ? DARK_PAPER : LIGHT_PAPER,
        debug: false,
        palette,
        laserColor: () => plugin.settings.laserDefaultColor,
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
        growInlinePage: () => {
          if (!expandable) return false;
          return this.maybeGrowHeight();
        },
        onChange: () => {
          this.revision++;
          if (expandable) this.maybeGrowHeight();
          this.syncUndoRedo();
          this.scheduleSave();
        },
      },
    );
    this.surface.setInlineWidthLocked(true);
    this.images.onReady = (path) => this.surface?.imageReady(path);
    this.surface.setImagePainter(this.images);
    this.surface.setWritingGuides(this.guidesEnabled && this.isTransparent(), this.guideStyle);
    this.surface.setTool(this.toolState.tool);
    this.toolbar.setNight(this.paperIsDark);
    this.syncUndoRedo();

    // Tap outside the active embed (and outside popovers) finishes & trims cleanly.
    const onOutside = (e: PointerEvent): void => {
      const target = e.target as Node | null;
      if (!target) return;
      if (slotEl.contains(target)) return;
      if (this.surfacePopover?.contains(target)) return;
      if ((target as Element).closest?.(".goodobsidian-popover, .modal-container")) return;
      void this.close();
    };
    const docObj = slotEl.ownerDocument;
    docObj.addEventListener("pointerdown", onOutside, true);
    this.cleanups.push(() => docObj.removeEventListener("pointerdown", onOutside, true));

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        void this.close();
      }
    };
    docObj.addEventListener("keydown", onKey, true);
    this.cleanups.push(() => docObj.removeEventListener("keydown", onKey, true));
  }

  private isTransparent(): boolean {
    const page = this.doc?.pages[0];
    return Boolean(
      page && page.backdrop.kind !== "pdf" && page.backdrop.paperColor === "transparent",
    );
  }

  private syncStageAspect(): void {
    const page = this.doc?.pages[0];
    if (!page || !this.stageEl) return;
    this.req.slotEl.setCssStyles({
      aspectRatio: `${page.geometry.width} / ${page.geometry.height}`,
    });
    this.req.slotEl.toggleClass("is-transparent", this.isTransparent());
  }

  private maybeGrowHeight(): boolean {
    const page = this.doc?.pages[0];
    if (!page) return false;
    const nextH = inlineGrowHeight(page);
    if (nextH > page.geometry.height) {
      page.geometry = { ...page.geometry, height: nextH };
      this.syncStageAspect();
      this.surface?.layout();
      return true;
    }
    return false;
  }

  private wireResizeHandle(handle: HTMLElement): void {
    let startY = 0;
    let startH = 0;
    let scale = 1;
    let pointerId: number | null = null;

    const onDown = (e: PointerEvent): void => {
      const page = this.doc?.pages[0];
      if (!page || !this.stageEl) return;
      e.preventDefault();
      e.stopPropagation();
      pointerId = e.pointerId;
      startY = e.clientY;
      startH = page.geometry.height;
      const cssW = this.stageEl.clientWidth || 600;
      scale = page.geometry.width / cssW;
      handle.setPointerCapture(pointerId);
    };
    const onMove = (e: PointerEvent): void => {
      const page = this.doc?.pages[0];
      if (pointerId === null || e.pointerId !== pointerId || !page) return;
      e.preventDefault();
      const desired = startH + (e.clientY - startY) * scale;
      const clamped = inlineClampedResizeHeight(page, desired);
      if (clamped !== page.geometry.height) {
        page.geometry = { ...page.geometry, height: clamped };
        this.manualHeight = clamped;
        this.revision++;
        this.syncStageAspect();
        this.surface?.layout();
      }
    };
    const onUp = (e: PointerEvent): void => {
      if (pointerId === null || e.pointerId !== pointerId) return;
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      pointerId = null;
      this.scheduleSave();
    };
    handle.addEventListener("pointerdown", onDown);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  private toggleSurfacePopover(): void {
    if (this.surfacePopover) {
      this.closeSurfacePopover();
      return;
    }
    const anchor = this.surfaceBtn;
    const page = this.doc?.pages[0];
    if (!anchor || !page) return;
    const docObj = anchor.ownerDocument;
    const win = docObj.defaultView ?? window;
    const pop = docObj.body.createDiv({
      cls: "goodobsidian-popover goodobsidian-inline-surface-popover",
    });
    this.surfacePopover = pop;
    this.surfaceBtn?.addClass("is-active");

    const stop = (e: Event): void => e.stopPropagation();
    for (const evt of ["mousedown", "pointerdown", "touchstart", "click"] as const) {
      pop.addEventListener(evt, stop);
    }

    const renderBody = (): void => {
      pop.empty();
      const transparent = this.isTransparent();
      const seg = pop.createDiv({
        cls: "goodobsidian-guide-segmented",
        attr: { role: "radiogroup", "aria-label": "Background" },
      });
      for (const [isTrans, label] of [
        [true, "Transparent"],
        [false, "Paper"],
      ] as const) {
        const btn = seg.createEl("button", {
          cls: "clickable-icon goodobsidian-guide-seg-btn",
          text: label,
          attr: { type: "button", role: "radio", "aria-checked": String(transparent === isTrans) },
        });
        btn.toggleClass("is-active", transparent === isTrans);
        btn.addEventListener("click", () => {
          if (transparent === isTrans) return;
          page.backdrop = isTrans
            ? { kind: "blank", paperColor: "transparent" }
            : { kind: "blank", paperColor: "#ffffff" };
          this.revision++;
          this.syncStageAspect();
          this.surface?.setWritingGuides(
            this.guidesEnabled && this.isTransparent(),
            this.guideStyle,
          );
          this.surface?.layout();
          this.scheduleSave();
          for (const fn of this.guideListeners) fn();
          renderBody();
        });
      }

      if (transparent) {
        const guideHost: WritingGuideHost = {
          state: () => ({
            enabled: this.guidesEnabled,
            style: this.guideStyle,
            eligible: true,
            paper: this.paperIsDark ? "#1e1f22" : "#ffffff",
            scale: 1,
          }),
          enable: (on) => {
            this.guidesEnabled = on;
            this.req.plugin.settings.writingGuidesEnabled = on;
            void this.req.plugin.saveSettings();
            this.surface?.setWritingGuides(on, this.guideStyle);
            for (const fn of this.guideListeners) fn();
          },
          configure: (patch) => {
            this.guideStyle = writingGuidesOf({ ...this.guideStyle, ...patch });
            this.req.plugin.settings.writingGuides = { ...this.guideStyle };
            void this.req.plugin.saveSettings();
            this.surface?.setWritingGuides(this.guidesEnabled, this.guideStyle);
            for (const fn of this.guideListeners) fn();
          },
          subscribe: (fn) => {
            this.guideListeners.add(fn);
            return () => this.guideListeners.delete(fn);
          },
        };
        renderWritingGuideControls(pop, guideHost);
      } else {
        const currentBg: SyntheticBackdrop =
          page.backdrop.kind === "pdf" ? { kind: "blank" } : page.backdrop;
        const colorRow = pop.createDiv({ cls: "goodobsidian-inline-surface-swatches" });
        for (const swatch of PAPER_SWATCHES) {
          const btn = colorRow.createEl("button", {
            cls: "clickable-icon goodobsidian-inline-paper-swatch",
            attr: {
              type: "button",
              "aria-label": swatch.label,
              title: swatch.label,
            },
          });
          btn.setCssProps({ "--swatch-bg": swatch.color });
          btn.toggleClass("is-active", (currentBg.paperColor ?? "#ffffff") === swatch.color);
          btn.addEventListener("click", () => {
            page.backdrop = { ...currentBg, paperColor: swatch.color };
            this.revision++;
            this.surface?.layout();
            this.scheduleSave();
            renderBody();
          });
        }
        const tplSeg = pop.createDiv({
          cls: "goodobsidian-guide-segmented",
          attr: { role: "radiogroup", "aria-label": "Paper template" },
        });
        for (const tpl of PAPER_TEMPLATES) {
          const btn = tplSeg.createEl("button", {
            cls: "clickable-icon goodobsidian-guide-seg-btn",
            text: tpl.label,
            attr: {
              type: "button",
              role: "radio",
              "aria-checked": String(currentBg.kind === tpl.kind),
            },
          });
          btn.toggleClass("is-active", currentBg.kind === tpl.kind);
          btn.addEventListener("click", () => {
            page.backdrop = { ...currentBg, kind: tpl.kind };
            this.revision++;
            this.surface?.layout();
            this.scheduleSave();
            renderBody();
          });
        }
      }
    };
    renderBody();

    const rect = anchor.getBoundingClientRect();
    const popW = Math.min(280, win.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.right - popW, win.innerWidth - popW - 8));
    const top = Math.min(rect.bottom + 8, win.innerHeight - 240);
    pop.setCssProps({ left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
  }

  private closeSurfacePopover(): void {
    this.surfacePopover?.remove();
    this.surfacePopover = null;
    this.surfaceBtn?.removeClass("is-active");
    this.guideListeners.clear();
  }

  private async pastePicture(file: File, at?: { x: number; y: number }): Promise<void> {
    const surface = this.surface;
    const doc = this.doc;
    const page = doc?.pages[0];
    if (!surface || !doc || !page || this.closing || this.closed) return;
    try {
      const prepared = await prepareImageBytes(await file.arrayBuffer(), file.type);
      if (this.surface !== surface || this.closing) return;
      const attachment = await saveImageAttachment(
        this.req.app,
        prepared,
        file.name || "Pasted image",
        this.req.notebookFile.path,
        this.imageFolder,
      );
      if (this.surface !== surface || this.closing) return;
      const region = at
        ? { minX: at.x - 1, minY: at.y - 1, maxX: at.x + 1, maxY: at.y + 1 }
        : surface.visibleRegion(0);
      const image = newImageElement(
        doc,
        attachment.path,
        placeImageBox(prepared, page.geometry, region),
      );
      surface.applyCommand(new InsertImage(page.id, image));
      surface.selectImage(page.id, image.id);
      this.revision++;
      this.scheduleSave();
    } catch (err) {
      new Notice(
        `FineNotes: could not add image (${err instanceof Error ? err.message : String(err)}).`,
      );
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.flushSave();
    }, 500);
  }

  private flushSave(): Promise<boolean> {
    if (this.revision === this.savedRevision || !this.doc) return this.saves;
    const targetRev = this.revision;
    const updatedPage: Page = structuredClone(this.doc.pages[0]);
    const { app, notebookFile, plugin } = this.req;
    this.saves = this.saves
      .catch(() => true)
      .then(async () => {
        try {
          await editClosedNotebook(app, notebookFile, plugin.settings.paperWidth, (doc) => {
            const idx = doc.pages.findIndex((p) => p.id === updatedPage.id);
            if (idx >= 0) doc.pages[idx] = updatedPage;
            else doc.pages.push(updatedPage);
          });
          this.savedRevision = Math.max(this.savedRevision, targetRev);
          return true;
        } catch (error) {
          new Notice(
            `FineNotes: could not save inline ink (${error instanceof Error ? error.message : String(error)})`,
          );
          return false;
        }
      });
    return this.saves;
  }

  close(): Promise<boolean> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      if (this.saveTimer !== null) {
        window.clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      this.closeSurfacePopover();
      const page = this.doc?.pages[0];
      if (page && isInlineSketchPage(page)) {
        const trimmed = inlineTrimHeight(page, this.manualHeight);
        if (trimmed !== page.geometry.height) {
          page.geometry = { ...page.geometry, height: trimmed };
          this.revision++;
        }
      }
      const ok = await this.flushSave();
      this.closed = true;
      this.toolbar?.destroy();
      this.toolbar = null;
      this.surface?.destroy();
      this.surface = null;
      this.images?.destroy();
      this.images = null;
      for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
      if (activeEditor === this) setActiveEditor(null);
      this.req.onClosed?.();
      return ok;
    })();
    return this.closing;
  }
}
