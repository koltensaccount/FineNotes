import { getGardenPublisher, publishStagedNote } from "./garden-publish";
import { ReadingPngQueue } from "./reading-png";
import { paintWritingGuides } from "../canvas/writing-guides";
import { equationBounds } from "../model/equation";
import { paintEquation } from "../canvas/equation-paint";
import { relinkDocument } from "../model/moved-files";
import { renderClipPng, adaptColorForTheme, parseColorToRgb } from "./clip-png";
import { findBlockInDocument, resolveBlockBounds } from "../model/handwrite-block";
import { startInlineHandwriteSession, getActiveInlineSession, type InlineHandwriteSession } from "./inline-handwrite";
import { VIEW_TYPE_INK } from "../constants";
import type { InkView } from "./ink-view";
import { PdfBackdropCache } from "./pdf-backdrop";
/**
 * Live FineNotes embeds for Obsidian markdown notes.
 *
 * Renders live, cropped notebook regions or full pages directly inside ordinary
 * Obsidian markdown notes, alongside standard live PNG image links.
 *
 * Automatically keeps embed canvases updated when the source notebook changes,
 * dynamically follows handwriting when moved or space is inserted, and opens
 * the notebook at the exact source page and region when clicked.
 */

import {
  type App,
  type MarkdownPostProcessorContext,
  type MarkdownView,
  TFile,
  setIcon,
  MarkdownRenderChild,
  Notice,
} from "obsidian";
import {
  type Bounds,
  type InkDocument,
  type NotebookClip,
  type Page,
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
import { LIGHT_PAPER, DARK_PAPER } from "../canvas/backdrop";
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

const notebookPngName = /-(?:clip|page|block)-/i;

function isPrintRender(element: Element): boolean {
  return Boolean(element.closest?.(".print"));
}

export class FineNotesEmbedManager {
  readonly readingPngQueue = new ReadingPngQueue(element => this.canSharpenReading(element));
  private readonly readingPngs = new Map<string, { page: Page; src: string }>();
  private readingPngBytes = 0;
  private readonly finalPngs = new Map<string, { page: Page; png: ArrayBuffer }>();
  private finalPngBytes = 0;
  private printImages = new Map<string, { src: string; width?: number }>();
  private pngRefreshPending = false;
  private pngRefreshRunning: Promise<void> | null = null;
  private readonly pendingPngFiles = new Set<TFile>();
  private disposed = false;
  private gardenPublishRunning = false;
  private sourceIndex: Promise<Map<string, string>> | null = null;
  private readonly docCache = new Map<string, CachedDoc>();
  private readonly imageCache: VaultImageCache;
  private readonly backdropPainter: VaultBackdropRenderer;
  readonly pdfCache: PdfBackdropCache;
  private readonly activeEmbedViews = new Set<FineNotesEmbedView>();
  private readonly liveNotebookEmbeds = new Map<HTMLElement, { mount: HTMLElement; view: FineNotesEmbedView; src: string }>();

  canSharpenReading(element: Element): boolean {
    return !this.disposed && !getActiveInlineSession() && element.isConnected &&
      Boolean(element.closest(".workspace-leaf.mod-active .markdown-reading-view")) &&
      !element.closest(".popover, .print, .finenotes-inline-active");
  }

  async readingPng(page: Page, key: string, render: () => Promise<ArrayBuffer>): Promise<string> {
    const cached = this.readingPngs.get(key);
    if (cached?.page === page) {
      this.readingPngs.delete(key);
      this.readingPngs.set(key, cached);
      return cached.src;
    }
    const src = await this.printDataUrl(await render());
    if (this.disposed || src.length > 8_000_000) return src;
    if (cached) {
      this.readingPngBytes -= cached.src.length;
      this.readingPngs.delete(key);
    }
    for (const [oldKey, old] of this.readingPngs) {
      if (this.readingPngBytes + src.length <= 8_000_000 && this.readingPngs.size < 32) break;
      this.readingPngBytes -= old.src.length;
      this.readingPngs.delete(oldKey);
    }
    this.readingPngs.set(key, { page, src });
    this.readingPngBytes += src.length;
    return src;
  }

  /** Returns the active inline handwriting session, if one is currently active. */
  getActiveInlineSession(): InlineHandwriteSession | null {
    return getActiveInlineSession();
  }

  /** Refresh theme-dependent PNGs, including notebooks that are not open. */
  refreshPngEmbeds(file?: TFile): Promise<void> {
    if (file) this.pendingPngFiles.add(file);
    else this.pngRefreshPending = true;
    if (this.pngRefreshRunning) return this.pngRefreshRunning;
    this.pngRefreshRunning = (async () => {
      while ((this.pngRefreshPending || this.pendingPngFiles.size > 0) && !this.disposed) {
        const refreshAll = this.pngRefreshPending;
        const files = refreshAll ? this.app.vault.getFiles() : [...this.pendingPngFiles];
        this.pngRefreshPending = false;
        this.pendingPngFiles.clear();
        const themeMode = typeof document !== "undefined" && document.body?.classList.contains("theme-dark") ? "dark" : "light";
        const includeBackground = this.plugin.settings.embedBackground === true;
        const openViews = this.app.workspace.getLeavesOfType(VIEW_TYPE_INK).map(leaf => leaf.view as InkView);
        const openPaths = new Set(openViews.map(view => view.file?.path));
        const viewsToRefresh = refreshAll ? openViews : openViews.filter((view) => view.file && files.includes(view.file));
        await Promise.all(viewsToRefresh.map((view) => view.updateClipsPng(true)));
        for (const file of files) {
          if (this.disposed || this.pngRefreshPending) break;
          if (!this.plugin.isInkFile(file) || openPaths.has(file.path)) continue;
          try {
            const mtime = file.stat.mtime;
            const doc = await this.loadDocument(file);
            if (!doc?.pages) continue;
            for (const page of doc.pages) {
              const geom = page.geometry ?? { width: 1024, height: 1366 };
              const assets = (page.clips ?? []).filter(clip => clip.imagePath).map(clip => ({
                path: clip.imagePath!, bounds: resolveBlockBounds(page, clip), padding: 8, writingGuides: clip.writingGuides,
              }));
              if (page.pageEmbedPath) assets.push({path: page.pageEmbedPath, bounds: {minX: 0, minY: 0, maxX: geom.width, maxY: geom.height}, padding: 0, writingGuides: undefined});
              for (const asset of assets) {
                if (this.disposed || this.pngRefreshPending || file.stat.mtime !== mtime) break;
                const image = this.app.vault.getAbstractFileByPath(asset.path);
                if (!(image instanceof TFile)) continue;
                const buffer = await renderClipPng(page, asset.bounds, {
                  images: this.imageCache, backdropPainter: this.backdropPainter, pdf: this.pdfCache,
                  includeBackground, themeMode, padding: asset.padding, writingGuides: asset.writingGuides,
                  usePressure: this.plugin.settings.pressureWidth,
                  highlighterAlpha: this.plugin.settings.highlighterAlpha,
                });
                if (this.disposed || this.pngRefreshPending || file.stat.mtime !== mtime) break;
                // A notebook opened during rendering is now owned by its InkView.
                if (this.app.workspace.getLeavesOfType(VIEW_TYPE_INK).some(leaf => (leaf.view as InkView).file === file)) break;
                await this.app.vault.modifyBinary(image, buffer);
                this.refreshEmbedImagesInDom(image);
              }
            }
          } catch (error) {
            console.warn("[FineNotes] Failed to refresh embed appearance", file.path, error);
          }
        }
      }
    })().finally(() => { this.pngRefreshRunning = null; });
    return this.pngRefreshRunning;
  }

  private pendingActivation: { filePath: string; blockId: string } | null = null;

  queuePendingActivation(filePath: string, blockId: string): void {
    this.pendingActivation = { filePath, blockId };
  }

  checkAndClearPendingActivation(filePath: string, subpath: string): boolean {
    if (!this.pendingActivation) return false;
    const cleanSub = subpath.replace(/^#?\^?/, "").trim();
    const cleanTarget = this.pendingActivation.blockId.replace(/^#?\^?/, "").trim();
    if (
      this.pendingActivation.filePath === filePath &&
      (cleanSub === cleanTarget ||
        cleanSub === `block-${cleanTarget}` ||
        `block-${cleanSub}` === cleanTarget)
    ) {
      this.pendingActivation = null;
      return true;
    }
    return false;
  }

  constructor(
    readonly plugin: GoodObsidianPlugin,
    private readonly app: App,
  ) {
    this.pdfCache = new PdfBackdropCache(app);
    this.imageCache = new VaultImageCache(app);
    this.plugin.register(() => {
      this.disposed = true;
      this.readingPngQueue.destroy();
      this.readingPngs.clear();
      this.finalPngs.clear();
      for (const [element, embed] of this.liveNotebookEmbeds) {
        embed.mount.remove();
        element.removeClass("finenotes-live-notebook-embed");
      }
      this.liveNotebookEmbeds.clear();
      for (const view of [...this.activeEmbedViews]) view.destroy();
      this.imageCache.destroy();
      this.pdfCache.destroy();
      this.docCache.clear();
      this.sourceIndex = null;
    });
    this.backdropPainter = new VaultBackdropRenderer(this.pdfCache);

    this.imageCache.onReady = () => {
      for (const view of this.activeEmbedViews) {
        view.refresh();
      }
    };

    this.plugin.registerEvent(
      this.app.workspace.on("css-change", () => {
        void this.refreshPngEmbeds();
        for (const view of this.activeEmbedViews) {
          view.refresh();
        }
      }),
    );

    // Watch vault modifications to update embedded notes in real-time
    this.plugin.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "png" && /-(?:clip|page|block)-/i.test(file.name)) {
          this.refreshEmbedImagesInDom(file);
        }
        if (file instanceof TFile && this.plugin.isInkFile(file)) {
          this.sourceIndex = null;
          this.docCache.delete(file.path);
          this.refreshEmbedsForFile(file.path);
        }
      }),
    );

    this.plugin.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          this.sourceIndex = null;
          this.docCache.delete(file.path);
          this.refreshEmbedsForFile(file.path);
        }
      }),
    );

    this.plugin.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.sourceIndex = null;
        this.docCache.clear();
        if (file instanceof TFile) {
          this.refreshEmbedsForFile(oldPath);
          this.refreshEmbedsForFile(file.path);
        }
      }),
    );

    this.hookExportPdf();

    // Register markdown post processor for ![[Notebook#...]] embeds
    this.plugin.registerMarkdownPostProcessor?.((el, ctx) => {
      return this.processMarkdownEmbeds(el, ctx);
    });

    // Register code block processor for ```finenotes and ```finenotes-embed
    const codeBlockHandler = (
      source: string,
      el: HTMLElement,
      ctx: MarkdownPostProcessorContext,
    ) => {
      return this.processCodeBlock(source, el, ctx);
    };

    this.plugin.registerMarkdownCodeBlockProcessor?.("finenotes", codeBlockHandler);
    this.plugin.registerMarkdownCodeBlockProcessor?.("finenotes-embed", codeBlockHandler);

    const markImages = (root: Element, sourcePath?: string): Promise<unknown> | void => {
      if (!isPrintRender(root)) return;

      // In print window, ensure MathJax CHTML stylesheet is synced immediately so glyph widths never collapse
      if (typeof document !== "undefined" && root.ownerDocument && root.ownerDocument !== document) {
        const printDoc = root.ownerDocument;
        if ((window as any).MathJax && typeof (window as any).MathJax.chtmlStylesheet === "function") {
          const mjxStyle = (window as any).MathJax.chtmlStylesheet();
          if (mjxStyle && !printDoc.getElementById("MJX-CHTML-styles-sync")) {
            const clone = mjxStyle.cloneNode(true) as HTMLStyleElement;
            clone.id = "MJX-CHTML-styles-sync";
            printDoc.head.appendChild(clone);
          }
        }
      }

      const images = root.tagName === "IMG"
        ? [root as HTMLImageElement]
        : [...root.querySelectorAll<HTMLImageElement>("img")];
      const pending: Promise<void>[] = [];
      for (const image of images) {
        if (image.dataset.finenotesPrintReady) continue;
        const src = (image.getAttribute("src") || "").split("?")[0];
        const apply = async () => {
          let printSrc = this.printImages.get(src);
          if (!printSrc && sourcePath && notebookPngName.test(src)) {
            const link = image.closest(".internal-embed")?.getAttribute("src") || image.alt;
            const candidate = this.app.metadataCache.getFirstLinkpathDest(link, sourcePath);
            const matches = (file: TFile) => file.extension === "png" &&
              this.app.vault.getResourcePath(file).split("?")[0] === src;
            const file = candidate && matches(candidate) ? candidate : this.app.vault.getFiles().find(matches);
            if (file) printSrc = await this.preparePrintImage(file);
          }
          if (!printSrc) return;
          image.dataset.finenotesPrintReady = "true";
          // Older themes may still invert the whole PNG via a print stylesheet.
          image.style.setProperty("filter", "none", "important");
          if (printSrc.width && !image.hasAttribute("width")) image.width = printSrc.width;
          image.removeAttribute("srcset");
          image.src = printSrc.src;
          await image.decode();
        };
        pending.push(apply());
      }
      if (pending.length) return Promise.allSettled(pending);
    };

    this.plugin.registerMarkdownPostProcessor((el, ctx) => {
      if (!isPrintRender(el)) return;
      // Obsidian inserts native wiki-image elements after invoking post-processors.
      // Return the work to Obsidian so PDF capture waits for the replacement to decode.
      return Promise.resolve().then(() => markImages(el, ctx.sourcePath));
    });
    this.plugin.registerMarkdownPostProcessor((el, ctx) => {
      if (isPrintRender(el)) return;
      const owner = el.ownerDocument?.defaultView;
      if (!owner?.IntersectionObserver) return;
      const child = new MarkdownRenderChild(el);
      const observer = new owner.IntersectionObserver(entries => {
        for (const entry of entries) {
          const image = entry.target as HTMLImageElement;
          this.readingPngQueue.cancel(image);
          if (!entry.isIntersecting) continue;
          this.readingPngQueue.add(image, async () => {
            const original = image.src;
            const valid = () => live && this.canSharpenReading(image) && image.src === original;
            const src = original.split("?")[0];
            const file = this.app.vault.getFiles().find(file => file.extension === "png" &&
              notebookPngName.test(file.name) && this.app.vault.getResourcePath(file).split("?")[0] === src);
            if (!file) return;
            const png = await this.renderHighQualityClip(file, false, valid);
            if (!png || !valid()) return;
            const ready = new owner.Image();
            ready.src = await this.printDataUrl(png);
            await ready.decode();
            if (!valid()) return;
            if (!image.hasAttribute("width") && image.naturalWidth) image.width = image.naturalWidth;
            image.style.content = `url("${ready.src}")`;
            image.dataset.finenotesReadingPng = "true";
            observer.unobserve(image);
          });
        }
      });
      let live = true;
      const images = new Set<HTMLImageElement>();
      child.onunload = () => {
        live = false;
        observer.disconnect();
        for (const image of images) this.readingPngQueue.cancel(image);
      };
      ctx.addChild(child);
      owner.requestAnimationFrame(() => {
        if (!live || !el.closest(".markdown-reading-view")) return;
        for (const image of el.querySelectorAll<HTMLImageElement>("img")) {
          if (!notebookPngName.test(image.src)) continue;
          images.add(image);
          observer.observe(image);
        }
      });
    });
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined" && document.body) {
      const observer = new MutationObserver((records) => {
        this.pruneLiveNotebookEmbeds();
        for (const record of records) {
          if (record.type === "attributes" && record.target instanceof Element) {
            markImages(record.target);
            this.processLiveNotebookEmbeds(record.target);
          } else {
            for (const node of record.addedNodes) {
              if (!(node instanceof Element)) continue;
              markImages(node);
              this.processLiveNotebookEmbeds(node);
            }
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "data-src"] });
      this.plugin.register(() => observer.disconnect());
      this.app.workspace.onLayoutReady(() => {
        if (this.disposed) return;
        markImages(document.body);
        this.processLiveNotebookEmbeds(document.body);
      });
    }
    if (typeof document !== "undefined") {
      this.plugin.registerDomEvent(document,"click",(event:MouseEvent)=>{
        const target=event.target instanceof Element ? event.target : null;
        if(!target || event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const anchor=target.closest("a");
        const href=anchor?.getAttribute("href") || (anchor as HTMLElement | null)?.dataset.href;
        if(href && /\.notebook(?:\.md)?#(?:\^clip-|page=)/i.test(href)) {
          event.preventDefault(); event.stopPropagation();
          let destination=href;
          try {destination=decodeURIComponent(href);} catch { /* Retain a literal percent in an unencoded name. */ }
          void this.app.workspace.openLinkText(destination,this.app.workspace.getActiveFile()?.path ?? "",false);
          return;
        }
        const image=target.closest("img");
        if(image?.classList.contains("finenotes-live-embed-image")) { event.preventDefault(); event.stopPropagation(); }
        if(image) void this.imageSource(image).then(source=>{
          if(source) {
            image.classList.add("finenotes-live-embed-image");
            void this.app.workspace.openLinkText(source,"",false);
          }
        });
      });
    }
  }

  private logHq(_msg: string): void {
    // Disabled in production
  }

  getActiveMarkdownFile(): TFile | null {
    const direct = this.app.workspace.getActiveFile();
    if (direct && direct.extension === "md") return direct;
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const file = (leaf.view as any)?.file;
      if (file instanceof TFile && file.extension === "md") return file;
    }
    return direct;
  }

  private hookExportPdf(): void {
    const installHook = () => {
      const commands = (this.app as any).commands?.commands;
      if (!commands) return;
      for (const cmdId of Object.keys(commands)) {
        if (cmdId === "workspace:export-pdf") {
          const exportCmd = commands[cmdId];
          if (exportCmd && !exportCmd._finenotesHooked) {
            exportCmd._finenotesHooked = true;
            const origCallback = exportCmd.callback;
            const origCheckCallback = exportCmd.checkCallback;
            if (origCheckCallback) {
              exportCmd.checkCallback = (checking: boolean) => {
                if (checking) return origCheckCallback(checking);
                const active = this.getActiveMarkdownFile();
                if (active) {
                  void (async () => {
                    let notice: Notice | null = null;
                    const timer = setTimeout(() => {
                      notice = new Notice("Preparing high-quality handwriting for PDF export…", 3000);
                    }, 300);
                    try {
                      await this.prepareHighQualityClipsForFile(active, true);
                    } catch (e) {
                      console.warn("[FineNotes] Failed to prepare high-quality clips:", e);
                    } finally {
                      clearTimeout(timer);
                      if (notice) (notice as any).hide?.();
                      origCheckCallback(false);
                    }
                  })();
                  return true;
                }
                return origCheckCallback(false);
              };
            } else if (origCallback) {
              exportCmd.callback = () => {
                const active = this.getActiveMarkdownFile();
                if (active) {
                  void (async () => {
                    let notice: Notice | null = null;
                    const timer = setTimeout(() => {
                      notice = new Notice("Preparing high-quality handwriting for PDF export…", 3000);
                    }, 300);
                    try {
                      await this.prepareHighQualityClipsForFile(active, true);
                    } catch (e) {
                      console.warn("[FineNotes] Failed to prepare high-quality clips:", e);
                    } finally {
                      clearTimeout(timer);
                      if (notice) (notice as any).hide?.();
                      origCallback();
                    }
                  })();
                } else {
                  origCallback();
                }
              };
            }
          }
        }
      }
    };

    installHook();
    if (this.app.workspace.layoutReady) {
      installHook();
    } else {
      this.app.workspace.onLayoutReady(() => { if (!this.disposed) installHook(); });
    }
    setTimeout(installHook, 1000);
    setTimeout(installHook, 3000);

  }

  /**
   * Render a specific notebook clip or page PNG at high resolution (3x / 300 DPI vector crispness)
   * strictly on export/publish, keeping live editing lightweight and fast.
   */
  async prepareHighQualityClip(imageFile: TFile): Promise<boolean> {
    const buffer = await this.renderHighQualityClip(imageFile);
    if (!buffer) return false;
    await this.app.vault.modifyBinary(imageFile, buffer);
    this.refreshEmbedImagesInDom(imageFile);
    return true;
  }

  private async renderHighQualityClip(
    imageFile: TFile,
    forPrint = false,
    shouldContinue?: () => boolean,
  ): Promise<ArrayBuffer | null> {
    void this.logHq(`prepareHighQualityClip started for ${imageFile.path}`);
    if (imageFile.extension !== "png") return null;
    let page: Page | null = null;
    let bounds: Bounds | null = null;
    let isClip = false;
    let writingGuides: NotebookClip["writingGuides"];

    const clipMatch = /^(.*?)-(?:clip|block)-([a-zA-Z0-9_-]+)\.png$/i.exec(imageFile.name);
    const pageMatch = /^(.*?)-(?:page)-(\d+)\.png$/i.exec(imageFile.name);
    const prefix = clipMatch?.[1] ?? pageMatch?.[1];

    let notebookFile: TFile | null = null;
    if (prefix) {
      const candidates = this.app.vault.getFiles().filter(file =>
        this.plugin.isInkFile(file) && (file.basename === prefix || stripInkSuffix(file.basename) === prefix)
      );
      if (candidates.length === 1) notebookFile = candidates[0];
    }
    void this.logHq(`prefix=${prefix}, notebookFile=${notebookFile?.path}`);

    if (!notebookFile) {
      const sources = await this.imageSources();
      for (const [imgPath, srcRef] of sources) {
        if (imgPath === imageFile.path || imgPath.endsWith("/" + imageFile.name) || imgPath === imageFile.name) {
          const [nPath] = srcRef.split("#");
          const nb = this.app.vault.getAbstractFileByPath(nPath);
          if (nb instanceof TFile && this.plugin.isInkFile(nb)) {
            notebookFile = nb;
            break;
          }
        }
      }
      void this.logHq(`fallback imageSources notebookFile=${notebookFile?.path}`);
    }

    if (!notebookFile) {
      for (const f of this.app.vault.getFiles()) {
        if (!this.plugin.isInkFile(f)) continue;
        const d = await this.loadDocument(f);
        if (d?.pages.some(p => p.clips?.some(c => c.imagePath === imageFile.path || c.imagePath?.endsWith("/" + imageFile.name)) || p.pageEmbedPath === imageFile.path || p.pageEmbedPath?.endsWith("/" + imageFile.name))) {
          notebookFile = f;
          break;
        }
      }
      void this.logHq(`fallback doc scan notebookFile=${notebookFile?.path}`);
    }

    if (notebookFile) {
      const doc = await this.loadDocument(notebookFile);
      if (doc) {
        for (let i = 0; i < doc.pages.length; i++) {
          const p = doc.pages[i];
          const clip = p.clips?.find(c =>
            c.imagePath === imageFile.path ||
            c.imagePath?.endsWith("/" + imageFile.name) ||
            c.imagePath === imageFile.name ||
            (clipMatch && (c.id === clipMatch[2] || c.id === `clip-${clipMatch[2]}` || c.id === `block-${clipMatch[2]}`))
          );
          if (clip) {
            isClip = true;
            writingGuides = clip.writingGuides;
            page = p;
            bounds = resolveBlockBounds(p, clip);
            break;
          }
          if (p.pageEmbedPath === imageFile.path || p.pageEmbedPath?.endsWith("/" + imageFile.name) || (pageMatch && i === parseInt(pageMatch[2], 10) - 1)) {
            page = p;
            const geom = p.geometry ?? { width: 1024, height: 1366 };
            bounds = { minX: 0, minY: 0, maxX: geom.width, maxY: geom.height };
            break;
          }
        }
      }
    }

    void this.logHq(`Found page=${Boolean(page)}, bounds=${JSON.stringify(bounds)}`);
    if (!page || !bounds) return null;

    try {
      const isDark = !forPrint && typeof document !== "undefined" && document.body?.classList.contains("theme-dark");
      const incBg = this.plugin.settings.embedBackground === true;
      const key = JSON.stringify([imageFile.path, page.id, bounds, forPrint, isDark, incBg,
        this.plugin.settings.pressureWidth, this.plugin.settings.highlighterAlpha, writingGuides]);
      const cached = this.finalPngs.get(key);
      if (cached?.page === page) return cached.png;
      const buffer = await renderClipPng(page, bounds, {
        images: this.imageCache,
        backdropPainter: this.backdropPainter,
        pdf: this.pdfCache,
        includeBackground: incBg,
        usePressure: this.plugin.settings.pressureWidth,
        highlighterAlpha: this.plugin.settings.highlighterAlpha,
        themeMode: isDark ? "dark" : "light",
        padding: isClip ? 8 : 0,
        writingGuides,
        highQuality: true,
        scale: forPrint ? 4 : 3,
        shouldContinue,
      });
      if (shouldContinue?.() === false) return null;
      if (buffer.byteLength <= 16_000_000 && !this.disposed) {
        const previous = this.finalPngs.get(key);
        if (previous) this.finalPngBytes -= previous.png.byteLength;
        this.finalPngs.delete(key);
        for (const [oldKey, old] of this.finalPngs) {
          if (this.finalPngBytes + buffer.byteLength <= 16_000_000 && this.finalPngs.size < 24) break;
          this.finalPngBytes -= old.png.byteLength;
          this.finalPngs.delete(oldKey);
        }
        this.finalPngs.set(key, { page, png: buffer });
        this.finalPngBytes += buffer.byteLength;
      }

      void this.logHq(`Rendered buffer size: ${buffer?.byteLength}`);
      return buffer && buffer.byteLength > 8 ? buffer : null;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return null;
      void this.logHq(`Error in renderClipPng: ${err}`);
      console.warn("[FineNotes] Failed to generate high-quality clip:", imageFile.path, err);
    }
    return null;
  }

  /**
   * Scan a Markdown note for all embedded FineNotes clip/page references and render them
   * at high quality for PDF export or digital garden publishing.
   */
  async prepareHighQualityClipsForFile(markdownFile: TFile, forPrint = false): Promise<number> {
    void this.logHq(`prepareHighQualityClipsForFile: note=${markdownFile.path}`);
    if (markdownFile.extension !== "md") return 0;
    const printImages = new Map<string, { src: string; width?: number }>();
    try {
      const content = await this.app.vault.read(markdownFile);
      const regex = /!\[\[([^\]]+)\]\]|!\[[^\]]*\]\(([^)]+)\)/g;
      const targets = new Set<string>();
      let match;
      while ((match = regex.exec(content)) !== null) {
        const raw = match[1] || match[2] || "";
        const pathOrName = raw.split("|")[0].split("#")[0].trim();
        if (notebookPngName.test(pathOrName)) {
          targets.add(pathOrName.replace(/^<|>$/g, ""));
        }
      }
      for (const embed of this.app.metadataCache.getFileCache(markdownFile)?.embeds ?? []) {
        if (notebookPngName.test(embed.link)) targets.add(embed.link);
      }
      void this.logHq(`Targets found in note: ${[...targets].join(", ")}`);
      let count = 0;
      for (const name of targets) {
        const file = this.app.metadataCache.getFirstLinkpathDest(name, markdownFile.path) ||
                     this.app.vault.getFiles().find(f => f.name === name || f.path === name || f.path.endsWith("/" + name));
        if (file instanceof TFile && file.extension === "png") {
          void this.logHq(`Found file for target ${name}: ${file.path}`);
          if (forPrint) {
            const resource = this.app.vault.getResourcePath(file).split("?")[0];
            if (printImages.has(resource)) continue;
            const rendered = await this.preparePrintImage(file);
            if (rendered) {
              printImages.set(resource, rendered);
              count++;
            }
          } else if (await this.prepareHighQualityClip(file)) {
            count++;
          }
        } else {
          void this.logHq(`Target ${name} did not resolve to a PNG TFile`);
        }
      }
      void this.logHq(`Upgraded ${count}/${targets.size} clips to high quality`);
      return count;
    } catch (err) {
      void this.logHq(`Error in prepareHighQualityClipsForFile: ${err}`);
      console.warn("[FineNotes] Failed to prepare high-quality clips for note:", markdownFile.path, err);
      return 0;
    } finally {
      if (forPrint) this.printImages = printImages;
    }
  }

  async publishToGarden(file: TFile): Promise<void> {
    const garden = getGardenPublisher(this.app);
    if (!garden || this.gardenPublishRunning) return;
    if (this.app.metadataCache.getFileCache(file)?.frontmatter?.["dg-publish"] !== true) {
      new Notice("Enable dg-publish on this note before publishing to Digital Garden.");
      return;
    }
    this.gardenPublishRunning = true;
    let notice: Notice | undefined;
    try {
      const content = await this.app.vault.cachedRead(file);
      const targets = new Map<string, TFile>();
      const stage = (path: string) => {
        const asset = this.app.metadataCache.getFirstLinkpathDest(path, file.path)
          ?? this.app.vault.getFileByPath(path);
        if (!(asset instanceof TFile) || asset.extension !== "png") {
          throw new Error(`Missing handwriting attachment: ${path}`);
        }
        targets.set(asset.path, asset);
        return asset.path;
      };
      for (const ref of this.app.metadataCache.getFileCache(file)?.embeds ?? []) {
        if (notebookPngName.test(ref.link) && /\.png$/i.test(ref.link)) stage(ref.link);
      }

      const fences = /^(?<prefix>(?:[ \t]*>[ \t]?)*[ \t]*)```finenotes(?:-embed)?[ \t]*\r?\n(?<body>[^\r\n]+)\r?\n\k<prefix>```[ \t]*$/gm;
      const replacements = [];
      for (const match of content.matchAll(fences)) {
        const { prefix, body } = match.groups!;
        const json = body.replace(/^(?:[ \t]*>[ \t]?)*/, "").trim();
        if (!json.startsWith("{")) continue;
        const ref: { notebook?: unknown; block?: unknown } = JSON.parse(json);
        if (typeof ref.notebook !== "string" || typeof ref.block !== "string") continue;
        const path = this.plugin.fileMoves?.relink(ref.notebook) ?? ref.notebook;
        const notebook = this.app.vault.getFileByPath(path);
        const doc = notebook && this.plugin.isInkFile(notebook) ? await this.loadDocument(notebook) : null;
        const block = doc && findBlockInDocument(doc, ref.block);
        if (!block?.clip.imagePath) throw new Error(`Missing handwriting source: ${ref.block}`);
        const asset = stage(block.clip.imagePath);
        replacements.push({ from: match.index!, to: match.index! + match[0].length, text: `${prefix}![[${asset}]]` });
      }

      if (targets.size) notice = new Notice(`Preparing ${targets.size} handwriting image(s) for Digital Garden…`, 0);
      const images = new Map<string, ArrayBuffer>();
      let bytes = 0;
      for (const asset of targets.values()) {
        // Let the progress notice paint and keep only one full-sized canvas alive.
        await new Promise(resolve => setTimeout(resolve, 0));
        const png = await this.renderHighQualityClip(asset, true);
        if (!png) throw new Error(`Original ink is unavailable for ${asset.name}`);
        bytes += png.byteLength;
        if (bytes > 32_000_000) throw new Error("This note exceeds the 32 MB handwriting upload budget.");
        images.set(asset.path, png);
      }
      let markdown = content;
      for (const { from, to, text } of replacements.reverse()) {
        markdown = markdown.slice(0, from) + text + markdown.slice(to);
      }
      notice?.hide();
      await publishStagedNote(garden, file, markdown, images);
    } catch (error) {
      new Notice(`FineNotes could not prepare this note for Digital Garden. ${error instanceof Error ? error.message : String(error)}`, 9000);
    } finally {
      notice?.hide();
      this.gardenPublishRunning = false;
    }
  }

  private async preparePrintImage(file: TFile): Promise<{ src: string; width?: number } | undefined> {
    try {
      const original = await this.app.vault.readBinary(file);
      const buffer = await this.renderHighQualityClip(file, true);
      const src = buffer ? await this.printDataUrl(buffer) : await this.prepareLegacyPrintImage(original);
      const header = new DataView(original);
      const width = original.byteLength >= 24 && header.getUint32(0) === 0x89504e47 ? header.getUint32(16) : undefined;
      return { src, width };
    } catch (err) {
      console.warn("[FineNotes] Could not prepare print image:", file.path, err);
      return undefined;
    }
  }

  printDataUrl(buffer: ArrayBuffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(new Blob([buffer], { type: "image/png" }));
    });
  }

  private async prepareLegacyPrintImage(buffer: ArrayBuffer): Promise<string> {
    const original = await this.printDataUrl(buffer);
    const image = new Image();
    image.src = original;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    try {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return original;
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { data } = pixels;
      let transparent = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] === 0) transparent++;
      if (transparent < data.length / 400) return original;

      let changed = false;
      for (let i = 0; i < data.length; i += 4) {
        if (!data[i + 3]) continue;
        const min = Math.min(data[i], data[i + 1], data[i + 2]);
        const max = Math.max(data[i], data[i + 1], data[i + 2]);
        if (min >= 180 && max - min <= 35) {
          data[i] = data[i + 1] = data[i + 2] = 26;
          changed = true;
        }
      }
      if (!changed) return original;
      ctx.putImageData(pixels, 0, 0);
      return canvas.toDataURL("image/png");
    } finally {
      canvas.width = canvas.height = 0;
    }
  }

  /** Resolve by persisted image path, not basename or a warm notebook cache. */
  private async imageSource(image: HTMLImageElement): Promise<string | null> {
    const src = (image.getAttribute("src") || "").split("?")[0];
    const alt = image.getAttribute("alt") || "";
    const cleanSrc = decodeURIComponent(src);

    const asset = this.app.vault.getFiles().find(file => {
      if (file.extension !== "png") return false;
      if (file.name === alt || file.path === alt) return true;
      if (cleanSrc.includes(file.path) || cleanSrc.endsWith("/" + file.name)) return true;
      try {
        const resPath = this.app.vault.getResourcePath(file).split("?")[0];
        if (decodeURIComponent(resPath) === cleanSrc) return true;
      } catch {}
      return false;
    });
    if (!asset) return null;
    return (await this.imageSources()).get(asset.path) ?? null;
  }

  /** Index arbitrary PNG names once; ordinary note images must not repeatedly scan notebooks. */
  private async imageSources(): Promise<Map<string, string>> {
    if (this.disposed) return new Map();
    if (!this.sourceIndex) {
      this.sourceIndex = (async () => {
        const sources = new Map<string, string>();
        for (const file of this.app.vault.getFiles()) {
          if (!this.plugin.isInkFile(file)) continue;
          const doc = await this.loadDocument(file);
          if (!doc) continue;
          for (const [index, page] of doc.pages.entries()) {
            for (const clip of page.clips ?? []) if (clip.imagePath && !sources.has(clip.imagePath)) sources.set(clip.imagePath, `${file.path}#^${clip.id}`);
            if (page.pageEmbedPath && !sources.has(page.pageEmbedPath)) sources.set(page.pageEmbedPath, `${file.path}#page=${index + 1}`);
          }
        }
        return sources;
      })();
    }
    const pending = this.sourceIndex;
    const sources = await pending;
    return pending === this.sourceIndex ? sources : this.imageSources();
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
    const openViews = this.app.workspace.getLeavesOfType("goodobsidian-view");
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

  /**
   * Immediately refresh all <img> elements in open markdown notes that display this embed file.
   */
  refreshEmbedImagesInDom(file: TFile): void {
    if (typeof document === "undefined") return;
    let resourcePath = "";
    try {
      resourcePath = (this.app.vault.getResourcePath(file) || "").split("?")[0];
    } catch {
      // In testing or environments without getResourcePath
    }
    const filename = file.name;
    const filePath = file.path;
    const images = Array.from(document.querySelectorAll<HTMLImageElement>("img"));
    const now = Date.now();
    for (const img of images) {
      const srcAttr = img.getAttribute("src") || "";
      const baseSrc = srcAttr.split("?")[0];
      const alt = img.getAttribute("alt") || "";
      const parentEmbed = img.closest(".image-embed");
      const parentSrc = parentEmbed?.getAttribute("src") || "";

      const matches =
        (resourcePath && baseSrc === resourcePath) ||
        alt === filename ||
        alt === filePath ||
        parentSrc === filename ||
        parentSrc === filePath ||
        baseSrc.endsWith("/" + encodeURIComponent(filename)) ||
        baseSrc.endsWith("/" + filename) ||
        srcAttr.includes(encodeURIComponent(filename)) ||
        srcAttr.includes(filename);

      if (matches) {
        if (img.dataset?.finenotesReadingPng) {
          img.style.removeProperty("content");
          delete img.dataset.finenotesReadingPng;
        }
        const cleanBase = (img.src || srcAttr).split("?")[0];
        img.src = `${cleanBase}?t=${img.classList?.contains("finenotes-block-preview") ? file.stat.mtime : now}`;
      }
    }
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
      relinkDocument(cached.doc, path => this.plugin.fileMoves?.relink(path));
      return cached.doc;
    }
    try {
      const content = await this.app.vault.read(file);
      const parsed = parseInkFile(content, this.plugin.settings.paperWidth);
      if (parsed.doc) {
        relinkDocument(parsed.doc, path => this.plugin.fileMoves?.relink(path));
        this.docCache.set(file.path, { mtime: file.stat.mtime, doc: parsed.doc });
        return parsed.doc;
      }
    } catch {
      // Ignore read errors
    }
    return null;
  }

  private createNotebookEmbed(el: HTMLElement, file: TFile, subpath: string, sourcePath: string): FineNotesEmbedView {
    return new FineNotesEmbedView(
      this, this.app, el, file, subpath, sourcePath, this.backdropPainter, this.imageCache,
      this.plugin.settings.pressureWidth !== false, this.plugin.settings.highlighterAlpha,
    );
  }

  private pruneLiveNotebookEmbeds(): void {
    for (const [el, embed] of this.liveNotebookEmbeds) {
      if (el.isConnected && embed.mount.parentElement === el &&
          embed.src === (el.getAttribute("src") || el.getAttribute("data-src"))) continue;
      this.liveNotebookEmbeds.delete(el);
      embed.view.destroy();
      embed.mount.remove();
      el.removeClass("finenotes-live-notebook-embed");
    }
  }

  /** Live Preview creates native embeds outside the Markdown postprocessor. */
  private processLiveNotebookEmbeds(root: Element): void {
    const selector = '.internal-embed:is([src*="#^block-"], [data-src*="#^block-"])';
    const containing = root.closest<HTMLElement>(selector);
    const embeds = containing ? [containing] : [];
    embeds.push(...root.querySelectorAll<HTMLElement>(selector));
    for (const el of embeds) {
      if (!el.isConnected || this.liveNotebookEmbeds.has(el) || el.hasClass("finenotes-embed-wrapper") ||
          !el.closest(".markdown-source-view.mod-cm6")) continue;
      const owner = this.app.workspace.getLeavesOfType("markdown")
        .map((leaf) => leaf.view as MarkdownView)
        .find((view) => view.contentEl.contains(el));
      if (!owner?.file) continue;
      const src = el.getAttribute("src") || el.getAttribute("data-src") || "";
      const match = /^(.*)(#\^block-[a-zA-Z0-9_-]+)$/.exec(src);
      if (!match) continue;
      const file = this.app.metadataCache.getFirstLinkpathDest(match[1], owner.file.path);
      if (!file || !this.plugin.isInkFile(file)) continue;

      // Keep Obsidian's native subtree intact so disabling FineNotes restores it.
      const mount = el.createDiv({ cls: "finenotes-embed-wrapper" });
      const view = this.createNotebookEmbed(mount, file, match[2], owner.file.path);
      this.liveNotebookEmbeds.set(el, { mount, view, src });
      el.addClass("finenotes-live-notebook-embed");
      void view.render();
    }
  }

  private processMarkdownEmbeds(el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<unknown> | void {
    const embeds = el.matches(".internal-embed") ? [el] : [];
    embeds.push(...el.querySelectorAll<HTMLElement>(".internal-embed"));
    const pending: Promise<void>[] = [];
    for (const embedEl of embeds) {
      if (embedEl.hasClass("finenotes-embed-wrapper") || this.liveNotebookEmbeds.has(embedEl)) continue;
      const src = embedEl.getAttribute("src") || embedEl.getAttribute("data-src");
      if (!src) continue;
      const [linkpath, subpath] = src.split("#");
      const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, ctx.sourcePath);
      if (!file || !this.plugin.isInkFile(file)) continue;
      embedEl.addClass("finenotes-embed-wrapper");
      const render = this.renderMarkdownEmbed(embedEl, file, subpath ? `#${subpath}` : "", ctx);
      if (render) pending.push(render);
    }
    if (pending.length) return Promise.allSettled(pending);
  }

  private renderMarkdownEmbed(el: HTMLElement, file: TFile, subpath: string, ctx: MarkdownPostProcessorContext): Promise<void> | void {
    const view = this.createNotebookEmbed(el, file, subpath, ctx.sourcePath);
    const child = new MarkdownRenderChild(el);
    const forPrint = isPrintRender(el);
    if (!forPrint) child.onload = () => { void view.render(); };
    child.onunload = () => view.destroy();
    ctx.addChild(child);
    if (forPrint) return view.render();
  }

  private processCodeBlock(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
  ): Promise<void> | void {
    el.empty();
    const trimmed = source.trim();

    // Check if user wrote ![[Notebook#...]] or [[Notebook#...]] inside the code block
    const wikilinkMatch = /!?\[\[([^\]#]+)(?:#([^\]]+))?\]\]/.exec(trimmed);
    let linkpath = "";
    let subpath = "";

    const exactPath = trimmed.startsWith("{");
    if (exactPath) {
      try {
        const reference: unknown = JSON.parse(trimmed);
        if (reference && typeof reference === "object" && "notebook" in reference && "block" in reference &&
            typeof reference.notebook === "string" && typeof reference.block === "string" &&
            /^block-[a-zA-Z0-9_-]+$/.test(reference.block)) {
          linkpath = this.plugin.fileMoves?.relink(reference.notebook) ?? reference.notebook;
          subpath = `^${reference.block}`;
        }
      } catch {
        // Report an invalid reference through the missing-notebook state below.
      }
    } else if (wikilinkMatch) {
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

    const targetFile = exactPath
      ? this.app.vault.getFileByPath(linkpath)
      : this.app.metadataCache.getFirstLinkpathDest(linkpath, ctx.sourcePath);
    if (!targetFile || !this.plugin.isInkFile(targetFile)) {
      el.createDiv({
        cls: "finenotes-embed-error",
        text: `FineNotes embed: notebook "${linkpath}" not found.`,
      });
      return;
    }

    return this.renderMarkdownEmbed(el, targetFile, subpath && !subpath.startsWith("#") ? `#${subpath}` : subpath, ctx);
  }
}

export class FineNotesEmbedView {
  get filePath(): string { return this.file.path; }
  private canvas: HTMLCanvasElement | null = null;
  private containerEl: HTMLElement | null = null;
  private isDestroyed = false;
  private inlineBlockId: string | null = null;
  private readingObserver: IntersectionObserver | null = null;
  private readingRevision = 0;

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

    // Clicking anywhere on the embed activates inline editing; Alt/Meta-click opens full notebook
    this.containerEl.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      if (this.containerEl?.hasClass("finenotes-inline-active")) return;
      if (evt.target instanceof Element && evt.target.closest(".goodobsidian-toolbar, .goodobsidian-options, .goodobsidian-popover, .finenotes-inline-surface-host")) return;
      if (evt.altKey || evt.metaKey || evt.ctrlKey) {
        const linkText = `${this.file.path}${this.subpath}`;
        void this.app.workspace.openLinkText(linkText, this.sourcePath, false);
        return;
      }
      this.activateInlineEditing();
    });

    this.containerEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        this.activateInlineEditing();
      }
    });

    await this.paintContent();
    if (isPrintRender(this.parentEl)) return;

    const activateIfPending = () => {
      if (this.inlineBlockId && this.containerEl?.isConnected &&
          this.manager.checkAndClearPendingActivation(this.file.path, this.subpath)) {
        this.activateInlineEditing();
      }
    };
    if (this.containerEl?.isConnected) activateIfPending();
    else this.parentEl.ownerDocument.defaultView?.requestAnimationFrame(activateIfPending);
  }

  private activateInlineEditing(): void {
    if (this.isDestroyed || !this.containerEl) return;
    if (!this.inlineBlockId) {
      void this.app.workspace.openLinkText(`${this.file.path}${this.subpath}`, this.sourcePath, false);
      return;
    }
    this.cancelReadingPng();
    startInlineHandwriteSession({
      plugin: this.manager.plugin,
      app: this.app,
      containerEl: this.containerEl,
      notebookFile: this.file,
      blockId: this.inlineBlockId,
      sourcePath: this.sourcePath,
      onClosed: () => {
        if (!this.canvas?.isConnected) this.canvas = null;
        void this.paintContent();
      },
    });
  }

  async refresh(): Promise<void> {
    if (this.isDestroyed || !this.containerEl) return;
    await this.paintContent();
  }

  destroy(): void {
    this.isDestroyed = true;
    this.cancelReadingPng();
    const session = getActiveInlineSession();
    if (session && session.hostContainer === this.containerEl) {
      void session.close(true);
    }
    this.manager.unregisterActiveView(this);
    if(this.canvas) {this.canvas.width=0;this.canvas.height=0;}
    this.canvas=null;
    this.containerEl = null;
  }

  private async paintContent(): Promise<void> {
    if (this.isDestroyed || !this.containerEl || this.containerEl.hasClass("finenotes-inline-active")) return;
    this.cancelReadingPng();
    const revision = this.readingRevision;
    const doc = await this.manager.loadDocument(this.file);
    if (revision !== this.readingRevision || this.isDestroyed || !this.containerEl || this.containerEl.hasClass("finenotes-inline-active")) return;
    this.inlineBlockId = null;
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
      // First check if it's a dedicated block:
      const blockFound = findBlockInDocument(doc, sub);
      if (blockFound) {
        clip = blockFound.clip;
        page = blockFound.page;
        pageIndex = blockFound.pageIndex;
        cropBounds = resolveBlockBounds(page, clip);
      }

      if (!page) {
        // Check if it's a legacy clip reference: #^clip-..., #clip=..., or #^...
        const clipIdMatch = /^#?\^?(?:clip=)?([a-zA-Z0-9_-]+)/i.exec(sub);
        if (clipIdMatch) {
          const found = findClip(doc, clipIdMatch[1]);
          if (found) {
            clip = found.clip;
            page = found.page;
            pageIndex = found.pageIndex;
            cropBounds = resolveBlockBounds(page, clip);
          }
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

    if (!page && sub) {
      this.containerEl.empty(); this.canvas=null;
      this.containerEl.createDiv({cls:"finenotes-embed-error",text:"This notebook page or clip is unavailable."});
      return;
    }
    if (!page) {
      pageIndex = 0;
      page = doc.pages[0];
    }

    if (clip && page.id.startsWith("block-") && page.id === clip.id &&
        page.clips?.length === 1 && page.clips[0].id === clip.id) {
      this.inlineBlockId = clip.id;
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
    if (isPrintRender(this.containerEl)) {
      const png = await renderClipPng(page, cropBounds, {
        images: this.imageCache,
        backdropPainter: this.backdropPainter,
        pdf: this.manager.pdfCache,
        includeBackground: !this.inlineBlockId || this.manager.plugin.settings.embedBackground === true,
        usePressure: this.usePressure,
        highlighterAlpha: this.highlighterAlpha,
        writingGuides: clip?.writingGuides,
        themeMode: "light",
        padding: 0,
        highQuality: true,
        scale: 4,
      });
      if (!png || this.isDestroyed || !this.containerEl) return;
      const src = await this.manager.printDataUrl(png);
      if (this.isDestroyed || !this.containerEl) return;
      this.containerEl.empty();
      const image = this.containerEl.createEl("img", {
        attr: { src, alt: "Handwritten ink", "data-finenotes-print-ready": "true" },
      });
      image.width = cssWidth;
      image.style.maxWidth = "100%";
      await image.decode();
      return;
    }

    const dpr = window.devicePixelRatio || 1;

    if (!this.canvas?.isConnected) {
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

    const isDark =
      typeof document !== "undefined" &&
      (this.containerEl?.ownerDocument?.body?.classList.contains("theme-dark") ??
        document.body?.classList.contains("theme-dark") ??
        false);
    const paperTheme = this.inlineBlockId && isDark ? DARK_PAPER : LIGHT_PAPER;
    this.backdropPainter.theme = paperTheme;

    const includeBackground = !this.inlineBlockId || this.manager.plugin.settings.embedBackground === true;
    const paperBg = paperColorOf(page, paperTheme);
    const rgb = parseColorToRgb(paperBg);
    const contrast = !this.inlineBlockId ? "disabled" : (
      includeBackground && rgb ? (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000 < 128 : isDark
    ) ? "dark" : "light";

    this.containerEl.toggleClass("is-transparent", !includeBackground);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (includeBackground) {
      ctx.fillStyle = paperBg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    const imageFile = this.inlineBlockId && clip?.imagePath
      ? this.app.vault.getAbstractFileByPath(clip.imagePath)
      : null;
    let preview = this.containerEl.querySelector<HTMLImageElement>("img.finenotes-block-preview");
    if (imageFile instanceof TFile) {
      if (!preview) {
        const container = this.containerEl;
        preview = container.createEl("img", {
          cls: "finenotes-block-preview",
          attr: { alt: "Handwritten ink" },
        });
        preview.addEventListener("load", () => container.toggleClass("has-png-preview", true));
        preview.addEventListener("error", () => container.toggleClass("has-png-preview", false));
      }
      const url = this.app.vault.getResourcePath(imageFile).split("?")[0];
      preview.style.width = `${cssWidth}px`;
      const src = `${url}?t=${imageFile.stat.mtime}`;
      if (preview.getAttribute("src") !== src) preview.src = src;
    } else {
      preview?.remove();
      this.containerEl.removeClass("has-png-preview");
    }

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

    // Await PDF pixels rather than painting a temporary missing/blank background.
    if(page.backdrop.kind === "pdf") {
      await this.manager.pdfCache.resolve(page.backdrop.path,page.backdrop.page,scaleX,{geometry:page.geometry});
      if(this.isDestroyed || !this.containerEl?.isConnected) return;
    }
    // 1. Backdrop ruling
    this.backdropPainter.paint(
      ctx,
      page.backdrop,
      page.geometry,
      Math.max(1, (0.5 * pW) / cssWidth),
      { deviceScale: scaleX },
    );

    if (clip?.writingGuides?.includeInPreview) {
      paintWritingGuides(ctx, page, cropBounds, clip.writingGuides.style,
        includeBackground ? paperBg : paperTheme.paper, 1, scaleX);
    }

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

    for (const equation of page.equations ?? []) {
      if (boundsIntersect(equationBounds(equation), cropBounds)) {
        const color = adaptColorForTheme(equation.color, contrast);
        paintEquation(ctx, color === equation.color ? equation : { ...equation, color });
      }
    }

    // 4. Text boxes
    for (const box of page.textBoxes) {
      if (boxesIntersect(box.x, box.y, box.w, box.h ?? 30, cropBounds)) {
        const adaptedColor = adaptColorForTheme(box.color, contrast);
        paintTextBox(ctx, adaptedColor === box.color ? box : { ...box, color: adaptedColor });
      }
    }

    // 5. Strokes
    for (const stroke of page.strokes) {
      const sb = strokeBounds(stroke);
      if (!sb || boundsIntersect(sb, cropBounds)) {
        const adaptedColor = adaptColorForTheme(stroke.color, contrast);
        const strokeToPaint = adaptedColor === stroke.color ? stroke : { ...stroke, color: adaptedColor };
        fillStroke(
          ctx,
          strokeToPaint.pts,
          styleOf(strokeToPaint, this.usePressure),
          this.highlighterAlpha ?? DEFAULT_HIGHLIGHTER_ALPHA,
        );
      }
    }

    ctx.restore();

    const container = this.containerEl;
    if (revision !== this.readingRevision || !container?.closest(".markdown-reading-view")) return;
    const owner = container.ownerDocument.defaultView;
    if (!owner?.IntersectionObserver) return;
    const sourcePage = page;
    const bounds = cropBounds;
    const themeMode = this.inlineBlockId && isDark ? "dark" : "light";
    const key = JSON.stringify([this.file.path, sourcePage.id, this.subpath, bounds, themeMode,
      includeBackground, this.usePressure, this.highlighterAlpha]);
    let visible = false;
    const valid = () => visible && revision === this.readingRevision && this.manager.canSharpenReading(container);
    const observer = new owner.IntersectionObserver(([entry]) => {
      this.manager.readingPngQueue.cancel(container);
      visible = entry?.isIntersecting === true;
      if (!visible) return;
      this.manager.readingPngQueue.add(container, async () => {
        const src = await this.manager.readingPng(sourcePage, key, () => renderClipPng(sourcePage, bounds, {
          images: this.imageCache,
          backdropPainter: this.backdropPainter,
          pdf: this.manager.pdfCache,
          includeBackground,
          usePressure: this.usePressure,
          highlighterAlpha: this.highlighterAlpha,
          writingGuides: clip?.writingGuides,
          themeMode,
          padding: 0,
          highQuality: true,
          scale: 3,
          shouldContinue: valid,
        }));
        if (!valid()) return;
        const image = container.ownerDocument.createElement("img");
        image.className = "finenotes-block-preview";
        image.alt = "Handwritten ink";
        image.style.width = `${cssWidth}px`;
        image.src = src;
        await image.decode();
        if (!valid()) return;
        container.querySelector("img.finenotes-block-preview")?.remove();
        container.appendChild(image);
        container.addClass("has-png-preview");
        observer.disconnect();
      });
    });
    this.readingObserver = observer;
    observer.observe(container);
  }

  private cancelReadingPng(): void {
    this.readingRevision++;
    this.readingObserver?.disconnect();
    this.readingObserver = null;
    if (this.containerEl) this.manager.readingPngQueue.cancel(this.containerEl);
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
