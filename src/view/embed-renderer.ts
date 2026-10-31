import { relinkDocument } from "../model/moved-files";
import { renderClipPng } from "./clip-png";
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
  TFile,
  setIcon,
  MarkdownRenderChild,
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
  private pngRefreshPending = false;
  private pngRefreshRunning: Promise<void> | null = null;
  private disposed = false;
  private sourceIndex: Promise<Map<string, string>> | null = null;
  private readonly docCache = new Map<string, CachedDoc>();
  private readonly imageCache: VaultImageCache;
  private readonly backdropPainter: VaultBackdropRenderer;
  readonly pdfCache: PdfBackdropCache;
  private readonly activeEmbedViews = new Set<FineNotesEmbedView>();

  /** Refresh theme-dependent PNGs, including notebooks that are not open. */
  refreshPngEmbeds(): Promise<void> {
    this.pngRefreshPending = true;
    if (this.pngRefreshRunning) return this.pngRefreshRunning;
    this.pngRefreshRunning = (async () => {
      while (this.pngRefreshPending && !this.disposed) {
        this.pngRefreshPending = false;
        const themeMode = typeof document !== "undefined" && document.body?.classList.contains("theme-dark") ? "dark" : "light";
        const includeBackground = this.plugin.settings.embedBackground === true;
        const openViews = this.app.workspace.getLeavesOfType(VIEW_TYPE_INK).map(leaf => leaf.view as InkView);
        const openPaths = new Set(openViews.map(view => view.file?.path));
        await Promise.all(openViews.map(view => view.updateClipsPng(true)));
        for (const file of this.app.vault.getFiles()) {
          if (this.disposed || this.pngRefreshPending) break;
          if (!this.plugin.isInkFile(file) || openPaths.has(file.path)) continue;
          try {
            const mtime = file.stat.mtime;
            const doc = await this.loadDocument(file);
            if (!doc?.pages) continue;
            for (const page of doc.pages) {
              const geom = page.geometry ?? { width: 1024, height: 1366 };
              const assets = (page.clips ?? []).filter(clip => clip.imagePath).map(clip => ({
                path: clip.imagePath!, bounds: clipCurrentBounds(page, clip), padding: 8,
              }));
              if (page.pageEmbedPath) assets.push({path: page.pageEmbedPath, bounds: {minX: 0, minY: 0, maxX: geom.width, maxY: geom.height}, padding: 0});
              for (const asset of assets) {
                if (this.disposed || this.pngRefreshPending || file.stat.mtime !== mtime) break;
                const image = this.app.vault.getAbstractFileByPath(asset.path);
                if (!(image instanceof TFile)) continue;
                const buffer = await renderClipPng(page, asset.bounds, {
                  images: this.imageCache, backdropPainter: this.backdropPainter, pdf: this.pdfCache,
                  includeBackground, themeMode, padding: asset.padding,
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

  constructor(
    private readonly plugin: GoodObsidianPlugin,
    private readonly app: App,
  ) {
    this.pdfCache = new PdfBackdropCache(app);
    this.imageCache = new VaultImageCache(app);
    this.plugin.register(()=>{ this.disposed = true; for(const view of [...this.activeEmbedViews]) view.destroy(); this.imageCache.destroy(); this.pdfCache.destroy(); this.docCache.clear(); this.sourceIndex = null; });
    this.backdropPainter = new VaultBackdropRenderer(this.pdfCache);

    this.imageCache.onReady = () => {
      for (const view of this.activeEmbedViews) {
        view.refresh();
      }
    };

    this.plugin.registerEvent(this.app.workspace.on("css-change", () => { void this.refreshPngEmbeds(); }));

    // Watch vault modifications to update embedded notes in real-time
    this.plugin.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "png" && /-clip-|-page-/i.test(file.name)) {
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

    const markImages = (root: Element): void => {
      const isPrint = Boolean(
        root.closest?.(".print") ||
        (typeof document !== "undefined" && root.ownerDocument && root.ownerDocument !== document)
      );
      const isMainDark = typeof document !== "undefined" && document.body?.classList.contains("theme-dark");

      // In print window, ensure MathJax CHTML stylesheet is synced immediately so glyph widths never collapse
      if (isPrint && typeof document !== "undefined" && root.ownerDocument && root.ownerDocument !== document) {
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

      const images = root instanceof HTMLImageElement ? [root] : [...root.querySelectorAll<HTMLImageElement>("img")];
      for (const image of images) {
        const src = image.getAttribute("src") || "";
        const alt = image.getAttribute("alt") || "";
        const isFineNotes =
          /-clip-|-page-/i.test(src) ||
          /-clip-|-page-/i.test(alt) ||
          image.classList.contains("finenotes-live-embed-image");

        if (isFineNotes) {
          image.classList.add("finenotes-live-embed-image");
          if (isMainDark) {
            image.dataset.finenotesTheme = "dark";
            image.classList.add("finenotes-dark-clip");
            if (isPrint) {
              image.style.filter = "invert(1) hue-rotate(180deg)";
              (image.style as any).webkitFilter = "invert(1) hue-rotate(180deg)";
            }
          } else {
            image.dataset.finenotesTheme = "light";
            image.classList.remove("finenotes-dark-clip");
          }
          if (isPrint && image.dataset.finenotesHq !== "true") {
            void this.upgradeImageForPrint(image);
          }
        }
      }
    };

    this.plugin.registerMarkdownPostProcessor((el) => markImages(el));
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined" && document.body) {
      const observer = new MutationObserver(records => {
        for (const record of records) {
          if (record.type === "attributes" && record.target instanceof Element) void markImages(record.target);
          else for (const node of record.addedNodes) if (node instanceof Element) void markImages(node);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
      this.plugin.register(() => observer.disconnect());
      this.app.workspace.onLayoutReady(() => { if (!this.disposed) void markImages(document.body); });
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
    const onExportTriggered = () => {
      void this.logHq("Export PDF triggered via command/button");
      const active = this.getActiveMarkdownFile();
      void this.logHq(`Active note: ${active?.path}`);
      if (active) void this.prepareHighQualityClipsForFile(active);
    };

    const installHook = () => {
      const commands = (this.app as any).commands?.commands;
      if (!commands) return;
      void this.logHq(`Installing export hooks across ${Object.keys(commands).length} commands`);
      for (const cmdId of Object.keys(commands)) {
        if (/export.*pdf|pdf.*export/i.test(cmdId)) {
          void this.logHq(`Hooking PDF command: ${cmdId}`);
          const exportCmd = commands[cmdId];
          if (exportCmd && !exportCmd._finenotesHooked) {
            exportCmd._finenotesHooked = true;
            const origCallback = exportCmd.callback;
            const origCheckCallback = exportCmd.checkCallback;
            if (origCallback) {
              exportCmd.callback = () => {
                onExportTriggered();
                origCallback();
              };
            }
            if (origCheckCallback) {
              exportCmd.checkCallback = (checking: boolean) => {
                if (!checking) onExportTriggered();
                return origCheckCallback(checking);
              };
            }
          }
        }
      }
    };

    if (this.app.workspace.layoutReady) {
      installHook();
    } else {
      this.app.workspace.onLayoutReady(() => { if (!this.disposed) installHook(); });
    }

    if (typeof document !== "undefined") {
      this.plugin.registerDomEvent(document, "click", (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        const btn = target?.closest?.("button.mod-cta, button");
        if (btn && btn.textContent?.trim() === "Export") {
          const modal = btn.closest(".modal");
          if (modal && modal.querySelector(".modal-title")?.textContent?.includes("Export to PDF")) {
            void this.logHq("Export button clicked in PDF modal");
            onExportTriggered();
          }
        }
      });
    }
  }

  private async upgradeImageForPrint(image: HTMLImageElement): Promise<void> {
    if (image.dataset.finenotesHq === "true") return;
    const src = (image.getAttribute("src") || "").split("?")[0];
    const alt = image.getAttribute("alt") || "";
    const cleanSrc = decodeURIComponent(src);
    void this.logHq(`upgradeImageForPrint: src=${src}, alt=${alt}`);

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
    if (!asset) {
      void this.logHq(`upgradeImageForPrint: no asset found for ${src}`);
      return;
    }
    image.dataset.finenotesHq = "true";
    void this.logHq(`upgradeImageForPrint: calling prepareHighQualityClip for ${asset.path}`);
    const ok = await this.prepareHighQualityClip(asset);
    void this.logHq(`upgradeImageForPrint: prepareHighQualityClip result=${ok}`);
    if (ok && image.isConnected) {
      const resPath = this.app.vault.getResourcePath(asset).split("?")[0];
      image.src = `${resPath}?t=${Date.now()}`;
    }
  }

  /**
   * Render a specific notebook clip or page PNG at high resolution (3x / 300 DPI vector crispness)
   * strictly on export/publish, keeping live editing lightweight and fast.
   */
  async prepareHighQualityClip(imageFile: TFile): Promise<boolean> {
    void this.logHq(`prepareHighQualityClip started for ${imageFile.path}`);
    if (imageFile.extension !== "png") return false;
    let page: Page | null = null;
    let bounds: Bounds | null = null;
    let isClip = false;

    const clipMatch = /^(.*?)-(?:clip)-([a-zA-Z0-9_-]+)\.png$/i.exec(imageFile.name);
    const pageMatch = /^(.*?)-(?:page)-(\d+)\.png$/i.exec(imageFile.name);
    const prefix = clipMatch ? clipMatch[1] : pageMatch ? pageMatch[1] : null;

    let notebookFile: TFile | null = null;
    if (prefix) {
      notebookFile = this.app.vault.getFiles().find(f =>
        this.plugin.isInkFile(f) &&
        (f.name.startsWith(prefix) || f.basename === prefix || stripInkSuffix(f.basename) === prefix || f.path.includes(prefix))
      ) ?? null;
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
            (clipMatch && (c.id === clipMatch[2] || c.id === `clip-${clipMatch[2]}`))
          );
          if (clip) {
            isClip = true;
            page = p;
            bounds = clipCurrentBounds(p, clip);
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
    if (!page || !bounds) return false;

    try {
      const isDark = typeof document !== "undefined" && document.body?.classList.contains("theme-dark");
      const incBg = this.plugin.settings.embedBackground === true;
      const buffer = await renderClipPng(page, bounds, {
        images: this.imageCache,
        backdropPainter: this.backdropPainter,
        pdf: this.pdfCache,
        includeBackground: incBg,
        usePressure: this.plugin.settings.pressureWidth,
        highlighterAlpha: this.plugin.settings.highlighterAlpha,
        themeMode: isDark ? "dark" : "light",
        padding: isClip ? 8 : 0,
        highQuality: true,
        scale: 3.0,
      });

      void this.logHq(`Rendered buffer size: ${buffer?.byteLength}`);
      if (buffer && buffer.byteLength > 8) {
        await this.app.vault.modifyBinary(imageFile, buffer);
        this.refreshEmbedImagesInDom(imageFile);
        void this.logHq(`Successfully modified binary for ${imageFile.path}!`);
        return true;
      }
    } catch (err) {
      void this.logHq(`Error in renderClipPng: ${err}`);
      console.warn("[FineNotes] Failed to generate high-quality clip:", imageFile.path, err);
    }
    return false;
  }

  /**
   * Scan a Markdown note for all embedded FineNotes clip/page references and render them
   * at high quality for PDF export or digital garden publishing.
   */
  async prepareHighQualityClipsForFile(markdownFile: TFile): Promise<number> {
    void this.logHq(`prepareHighQualityClipsForFile: note=${markdownFile.path}`);
    if (markdownFile.extension !== "md") return 0;
    try {
      const content = await this.app.vault.read(markdownFile);
      const regex = /!\[\[([^\]]+)\]\]|!\[[^\]]*\]\(([^)]+)\)/g;
      const targets = new Set<string>();
      let match;
      while ((match = regex.exec(content)) !== null) {
        const raw = match[1] || match[2] || "";
        const pathOrName = raw.split("|")[0].split("#")[0].trim();
        if (/-clip-|-page-/i.test(pathOrName)) {
          targets.add(pathOrName);
        }
      }
      void this.logHq(`Targets found in note: ${[...targets].join(", ")}`);
      let count = 0;
      for (const name of targets) {
        const file = this.app.metadataCache.getFirstLinkpathDest(name, markdownFile.path) ||
                     this.app.vault.getFiles().find(f => f.name === name || f.path === name || f.path.endsWith("/" + name));
        if (file instanceof TFile && file.extension === "png") {
          void this.logHq(`Found file for target ${name}: ${file.path}`);
          const ok = await this.prepareHighQualityClip(file);
          if (ok) count++;
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
        const cleanBase = (img.src || srcAttr).split("?")[0];
        img.src = `${cleanBase}?t=${now}`;
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
      const child=new MarkdownRenderChild(embedEl);
      child.onunload=()=>view.destroy(); ctx.addChild(child);
      void view.render();
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
    const child=new MarkdownRenderChild(el);
    child.onunload=()=>view.destroy(); ctx.addChild(child);
    void view.render();
  }
}

export class FineNotesEmbedView {
  get filePath(): string { return this.file.path; }
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
    if(this.canvas) {this.canvas.width=0;this.canvas.height=0;}
    this.canvas=null;
  }

  private async paintContent(): Promise<void> {
    if (!this.containerEl) return;
    const doc = await this.manager.loadDocument(this.file);
    if(this.isDestroyed || !this.containerEl?.isConnected) return;
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

    if (!page && sub) {
      this.containerEl.empty(); this.canvas=null;
      this.containerEl.createDiv({cls:"finenotes-embed-error",text:"This notebook page or clip is unavailable."});
      return;
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
