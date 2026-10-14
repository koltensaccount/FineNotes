/**
 * Live FineNotes embeds for Obsidian markdown notes.
 *
 * Renders live, cropped notebook regions or full pages directly inside ordinary
 * Obsidian markdown notes without creating separate image files or intermediate notes.
 *
 * Automatically keeps embed canvases updated when the source notebook changes,
 * dynamically follows handwriting when moved or space is inserted, and opens
 * the notebook at the exact source page and region when clicked.
 */

import {
  type App,
  type MarkdownPostProcessorContext,
  TFile,
  setIcon,
} from "obsidian";
import {
  type Bounds,
  type InkDocument,
  type NotebookClip,
  type Page,
  clipCurrentBounds,
  findClip,
  strokeBounds,
} from "../model/document";
import { parseInkFile } from "../model/serialize";
import { VaultBackdropRenderer } from "./backdrop-renderer";
import { VaultImageCache } from "./image-cache";
import {
  fillStroke,
  paintTextBox,
  paperColorOf,
  styleOf,
} from "../canvas/renderer";
import { LIGHT_PAPER } from "../canvas/backdrop";
import { DEFAULT_HIGHLIGHTER_ALPHA } from "../constants";
import { drawPlacedCircuit } from "../circuit/circuit-render";
import { stripInkSuffix } from "../model/new-notebook";
import { pageFromSubpath } from "../search/notebook-search";
import type GoodObsidianPlugin from "../main";

/** Max CSS width for inline embeds in reading mode. */
const MAX_EMBED_WIDTH_PX = 800;

interface CachedDoc {
  mtime: number;
  doc: InkDocument;
}

export class FineNotesEmbedManager {
  private readonly docCache = new Map<string, CachedDoc>();
  private readonly imageCache: VaultImageCache;
  private readonly backdropPainter: VaultBackdropRenderer;
  private readonly activeEmbedViews = new Set<FineNotesEmbedView>();

  constructor(
    private readonly plugin: GoodObsidianPlugin,
    private readonly app: App,
  ) {
    this.imageCache = new VaultImageCache(app);
    this.backdropPainter = new VaultBackdropRenderer(null);

    this.imageCache.onReady = () => {
      for (const view of this.activeEmbedViews) {
        view.refresh();
      }
    };

    // Watch vault modifications to update embedded notes in real-time
    this.plugin.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && this.plugin.isInkFile(file)) {
          this.docCache.delete(file.path);
          this.refreshEmbedsForFile(file.path);
        }
      }),
    );

    this.plugin.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          this.docCache.delete(file.path);
          this.refreshEmbedsForFile(file.path);
        }
      }),
    );

    this.plugin.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.docCache.delete(oldPath);
        if (file instanceof TFile) {
          this.docCache.delete(file.path);
          this.refreshEmbedsForFile(oldPath);
          this.refreshEmbedsForFile(file.path);
        }
      }),
    );

    // Register markdown post processor for ![[Notebook#...]] embeds
    this.plugin.registerMarkdownPostProcessor?.((el, ctx) => {
      this.processMarkdownEmbeds(el, ctx);
    });

    // Register code block processor for ```finenotes and ```finenotes-embed
    const codeBlockHandler = (
      source: string,
      el: HTMLElement,
      ctx: MarkdownPostProcessorContext,
    ) => {
      this.processCodeBlock(source, el, ctx);
    };

    this.plugin.registerMarkdownCodeBlockProcessor?.("finenotes", codeBlockHandler);
    this.plugin.registerMarkdownCodeBlockProcessor?.("finenotes-embed", codeBlockHandler);

    // Global click listener to navigate to notebook clip/page when clicking an embed image or link
    this.plugin.registerDomEvent(document, "click", (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      // 1. Direct link to a notebook file (e.g. [![]()](<note.notebook#^clip-...>))
      const link = target.closest("a");
      const href = link?.getAttribute("href") || link?.dataset.href;
      if (href && (href.endsWith(".notebook") || href.includes(".notebook#"))) {
        event.preventDefault();
        event.stopPropagation();
        const activeFile = this.app.workspace.getActiveFile();
        void this.app.workspace.openLinkText(href, activeFile?.path ?? "", false);
        return;
      }

      // 2. Clicked image whose src or alt matches a notebook clip or page
      const img = target.closest("img");
      if (img) {
        const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
        const alt = img.getAttribute("alt") || "";
        const combined = `${src} ${alt}`;

        const clipMatch = /-clip-([a-zA-Z0-9_-]+)\.png/i.exec(combined);
        if (clipMatch) {
          const clipId = `clip-${clipMatch[1]}`;
          const notebook = this.findNotebookForClip(clipId);
          if (notebook) {
            event.preventDefault();
            event.stopPropagation();
            void this.app.workspace.openLinkText(`${notebook.path}#^${clipId}`, "", false);
            return;
          }
        }

        const pageMatch = /(.+)-page-(\d+)\.png/i.exec(combined);
        if (pageMatch) {
          const pageNum = parseInt(pageMatch[2], 10);
          const rawBase = pageMatch[1].split("/").pop() ?? "";
          const baseName = decodeURIComponent(rawBase);
          const notebook = this.findNotebookByBaseName(baseName);
          if (notebook) {
            event.preventDefault();
            event.stopPropagation();
            void this.app.workspace.openLinkText(`${notebook.path}#page=${pageNum}`, "", false);
            return;
          }
        }
      }
    });
  }

  findNotebookByBaseName(baseName: string): TFile | null {
    const files = this.app.vault.getFiles();
    return (
      files.find(
        (f) =>
          this.plugin.isInkFile(f) &&
          (f.basename === baseName || stripInkSuffix(f.basename) === baseName),
      ) ?? null
    );
  }

  findNotebookForClip(clipId: string): TFile | null {
    for (const [path, cached] of this.docCache) {
      if (findClip(cached.doc, clipId)) {
        const f = this.app.vault.getAbstractFileByPath(path);
        if (f instanceof TFile) return f;
      }
    }
    const openViews = this.app.workspace.getLeavesOfType("finenotes-view");
    for (const leaf of openViews) {
      const v = leaf.view as any;
      if (v?.file && v?.doc && findClip(v.doc, clipId)) {
        return v.file;
      }
    }
    for (const f of this.app.vault.getFiles()) {
      if (this.plugin.isInkFile(f)) {
        const cached = this.docCache.get(f.path);
        if (cached && findClip(cached.doc, clipId)) return f;
      }
    }
    return null;
  }

  /** Notify all active embed views for `filePath` to re-render. */
  refreshEmbedsForFile(filePath: string): void {
    for (const view of this.activeEmbedViews) {
      if (view.filePath === filePath) {
        view.refresh();
      }
    }
  }

  registerActiveView(view: FineNotesEmbedView): void {
    this.activeEmbedViews.add(view);
  }

  unregisterActiveView(view: FineNotesEmbedView): void {
    this.activeEmbedViews.delete(view);
  }

  async loadDocument(file: TFile): Promise<InkDocument | null> {
    const cached = this.docCache.get(file.path);
    if (cached && cached.mtime === file.stat.mtime) {
      return cached.doc;
    }
    try {
      const content = await this.app.vault.read(file);
      const parsed = parseInkFile(content, this.plugin.settings.paperWidth);
      if (parsed.doc) {
        this.docCache.set(file.path, { mtime: file.stat.mtime, doc: parsed.doc });
        return parsed.doc;
      }
    } catch {
      // Ignore read errors
    }
    return null;
  }

  private processMarkdownEmbeds(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    const embedEls = el.querySelectorAll<HTMLElement>(".internal-embed");
    for (let i = 0; i < embedEls.length; i++) {
      const embedEl = embedEls[i];
      const src = embedEl.getAttribute("src") || embedEl.getAttribute("data-src") || "";
      if (!src) continue;

      const [linkpath, subpath] = src.split("#");
      const targetFile = this.app.metadataCache.getFirstLinkpathDest(linkpath, ctx.sourcePath);
      if (!targetFile || !this.plugin.isInkFile(targetFile)) continue;

      // Intercept the internal-embed element
      embedEl.empty();
      embedEl.addClass("finenotes-embed-wrapper");

      const view = new FineNotesEmbedView(
        this,
        this.app,
        embedEl,
        targetFile,
        subpath ? `#${subpath}` : "",
        ctx.sourcePath,
        this.backdropPainter,
        this.imageCache,
        this.plugin.settings.pressureWidth !== false,
        this.plugin.settings.highlighterAlpha,
      );
      view.render();
    }
  }

  private processCodeBlock(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
  ): void {
    el.empty();
    const trimmed = source.trim();

    // Check if user wrote ![[Notebook#...]] or [[Notebook#...]] inside the code block
    const wikilinkMatch = /!?\[\[([^\]#]+)(?:#([^\]]+))?\]\]/.exec(trimmed);
    let linkpath = "";
    let subpath = "";

    if (wikilinkMatch) {
      linkpath = wikilinkMatch[1].trim();
      subpath = wikilinkMatch[2]?.trim() ?? "";
    } else {
      // Parse key-value lines: note: ..., clip: ..., page: ...
      const lines = trimmed.split("\n");
      for (const line of lines) {
        const parts = line.split(":");
        if (parts.length >= 2) {
          const key = parts[0].trim().toLowerCase();
          const val = parts.slice(1).join(":").trim().replace(/^["']|["']$/g, "");
          if (key === "note" || key === "notebook" || key === "file") linkpath = val;
          else if (key === "clip") subpath = `^${val.replace(/^\^/, "")}`;
          else if (key === "page") subpath = `page=${val}`;
        }
      }
    }

    if (!linkpath) {
      el.createDiv({
        cls: "finenotes-embed-error",
        text: "FineNotes embed: no notebook specified. Use note: \"Name\" or ![[Notebook#^clip-id]].",
      });
      return;
    }

    const targetFile = this.app.metadataCache.getFirstLinkpathDest(linkpath, ctx.sourcePath);
    if (!targetFile || !this.plugin.isInkFile(targetFile)) {
      el.createDiv({
        cls: "finenotes-embed-error",
        text: `FineNotes embed: notebook "${linkpath}" not found.`,
      });
      return;
    }

    const view = new FineNotesEmbedView(
      this,
      this.app,
      el,
      targetFile,
      subpath ? (subpath.startsWith("#") ? subpath : `#${subpath}`) : "",
      ctx.sourcePath,
      this.backdropPainter,
      this.imageCache,
      this.plugin.settings.pressureWidth !== false,
      this.plugin.settings.highlighterAlpha,
    );
    view.render();
  }
}

export class FineNotesEmbedView {
  readonly filePath: string;
  private canvas: HTMLCanvasElement | null = null;
  private containerEl: HTMLElement | null = null;
  private isDestroyed = false;

  constructor(
    private readonly manager: FineNotesEmbedManager,
    private readonly app: App,
    private readonly parentEl: HTMLElement,
    readonly file: TFile,
    readonly subpath: string,
    private readonly sourcePath: string,
    private readonly backdropPainter: VaultBackdropRenderer,
    private readonly imageCache: VaultImageCache,
    private readonly usePressure: boolean,
    private readonly highlighterAlpha: number,
  ) {
    this.filePath = file.path;
  }

  async render(): Promise<void> {
    this.manager.registerActiveView(this);
    this.parentEl.empty();

    this.containerEl = this.parentEl.createDiv({
      cls: "finenotes-embed",
      attr: {
        "data-finenotes-file": this.filePath,
        "data-finenotes-subpath": this.subpath,
        role: "button",
        tabindex: "0",
        "aria-label": `FineNotes embed: ${stripInkSuffix(this.file.basename)}`,
      },
    });

    // Clicking anywhere on the embed navigates directly to the source notebook & region
    this.containerEl.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const linkText = `${this.file.path}${this.subpath}`;
      void this.app.workspace.openLinkText(linkText, this.sourcePath, false);
    });

    this.containerEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        const linkText = `${this.file.path}${this.subpath}`;
        void this.app.workspace.openLinkText(linkText, this.sourcePath, false);
      }
    });

    await this.paintContent();
  }

  async refresh(): Promise<void> {
    if (this.isDestroyed || !this.containerEl) return;
    await this.paintContent();
  }

  destroy(): void {
    this.isDestroyed = true;
    this.manager.unregisterActiveView(this);
  }

  private async paintContent(): Promise<void> {
    if (!this.containerEl) return;
    const doc = await this.manager.loadDocument(this.file);
    if (!doc || doc.pages.length === 0) {
      this.containerEl.empty();
      this.containerEl.createDiv({
        cls: "finenotes-embed-error",
        text: `FineNotes embed: unable to load notebook "${this.file.basename}".`,
      });
      return;
    }

    // Resolve target page and crop bounds
    let page: Page | null = null;
    let pageIndex = 0;
    let cropBounds: Bounds | null = null;
    let clip: NotebookClip | null = null;

    const sub = this.subpath.trim();
    if (sub.length > 0) {
      // Check if it's a clip reference: #^clip-..., #clip=..., or #^...
      const clipIdMatch = /^#?\^?(?:clip=)?([a-zA-Z0-9_-]+)/i.exec(sub);
      if (clipIdMatch) {
        const found = findClip(doc, clipIdMatch[1]);
        if (found) {
          clip = found.clip;
          page = found.page;
          pageIndex = found.pageIndex;
          cropBounds = clipCurrentBounds(page, clip);
        }
      }

      // Check if it's a page reference: #page=2, #p2, etc.
      if (!page) {
        const parsedPage = pageFromSubpath(sub, doc.pages.length);
        if (parsedPage !== null) {
          pageIndex = parsedPage;
          page = doc.pages[pageIndex] ?? null;
        }
      }
    }

    if (!page) {
      pageIndex = 0;
      page = doc.pages[0];
    }

    // Default to whole page if no clip bounds
    const pW = page.geometry.width;
    const pH = page.geometry.height;
    if (!cropBounds) {
      cropBounds = { minX: 0, minY: 0, maxX: pW, maxY: pH };
    } else {
      // Clamp crop bounds to page with small safety margin
      cropBounds = {
        minX: Math.max(0, Math.min(pW - 1, cropBounds.minX)),
        minY: Math.max(0, Math.min(pH - 1, cropBounds.minY)),
        maxX: Math.max(1, Math.min(pW, cropBounds.maxX)),
        maxY: Math.max(1, Math.min(pH, cropBounds.maxY)),
      };
    }

    const cropW = Math.max(1, cropBounds.maxX - cropBounds.minX);
    const cropH = Math.max(1, cropBounds.maxY - cropBounds.minY);

    const cssWidth = Math.min(MAX_EMBED_WIDTH_PX, Math.max(160, cropW));
    const cssHeight = Math.round((cssWidth * cropH) / cropW);
    const dpr = window.devicePixelRatio || 1;

    if (!this.canvas) {
      this.containerEl.empty();
      this.canvas = this.containerEl.createEl("canvas", {
        cls: "finenotes-embed-canvas",
      });
      // Add subtle badge indicating notebook title and page
      const badge = this.containerEl.createDiv({ cls: "finenotes-embed-badge" });
      const iconSpan = badge.createSpan({ cls: "finenotes-embed-badge-icon" });
      setIcon(iconSpan, "external-link");
      badge.createSpan({
        cls: "finenotes-embed-badge-label",
        text: `${stripInkSuffix(this.file.basename)} · p. ${pageIndex + 1}`,
      });
    }

    const canvas = this.canvas;
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = paperColorOf(page, LIGHT_PAPER);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const scaleX = canvas.width / cropW;
    const scaleY = canvas.height / cropH;

    ctx.setTransform(
      scaleX,
      0,
      0,
      scaleY,
      -cropBounds.minX * scaleX,
      -cropBounds.minY * scaleY,
    );

    ctx.save();
    ctx.beginPath();
    ctx.rect(cropBounds.minX, cropBounds.minY, cropW, cropH);
    ctx.clip();

    // 1. Backdrop ruling
    this.backdropPainter.paint(
      ctx,
      page.backdrop,
      page.geometry,
      Math.max(1, (0.5 * pW) / cssWidth),
      { deviceScale: scaleX },
    );

    // 2. Images
    for (const img of page.images) {
      if (boxesIntersect(img.x, img.y, img.w, img.h, cropBounds)) {
        this.imageCache.paintImage(ctx, img, scaleX);
      }
    }

    // 3. Circuits
    if (page.circuits) {
      for (const circuit of page.circuits) {
        if (boxesIntersect(circuit.x, circuit.y, circuit.w, circuit.h, cropBounds)) {
          drawPlacedCircuit(ctx, circuit);
        }
      }
    }

    // 4. Text boxes
    for (const box of page.textBoxes) {
      if (boxesIntersect(box.x, box.y, box.w, box.h ?? 30, cropBounds)) {
        paintTextBox(ctx, box);
      }
    }

    // 5. Strokes
    for (const stroke of page.strokes) {
      const sb = strokeBounds(stroke);
      if (!sb || boundsIntersect(sb, cropBounds)) {
        fillStroke(
          ctx,
          stroke.pts,
          styleOf(stroke, this.usePressure),
          this.highlighterAlpha ?? DEFAULT_HIGHLIGHTER_ALPHA,
        );
      }
    }

    ctx.restore();
  }
}

function boxesIntersect(
  x: number,
  y: number,
  w: number,
  h: number,
  target: Bounds,
): boolean {
  return !(x + w < target.minX || x > target.maxX || y + h < target.minY || y > target.maxY);
}

function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}
