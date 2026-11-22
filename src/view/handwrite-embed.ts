/**
 * Live Markdown embed manager for Handwrite Here blocks (both `finenotes`
 * code blocks and legacy `*-block-*.png` / `*-clip-*.png` image embeds).
 *
 * Reuses upstream 2.10.0's `renderPageThumbnail(..., { crop })` for crisp,
 * theme-aware previews and activates `InlineHandwriteSession` on tap/click.
 */

import { type App, MarkdownRenderChild, Notice, TFile, setIcon } from "obsidian";
import type GoodObsidianPlugin from "../main";
import type { Bounds, Page } from "../model/document";
import { handwritingForBackground } from "../canvas/handwriting-contrast";
import { parseInkFile } from "../model/serialize";
import {
  findBlockInDocument,
  INITIAL_BLOCK_HEIGHT,
  resolveBlockBounds,
} from "../model/handwrite-block";
import { DARK_PAPER, LIGHT_PAPER } from "../canvas/backdrop";
import { renderPageThumbnail } from "../canvas/renderer";
import { getGardenPublisher, publishStagedNote, type StagedHandwriting } from "./garden-publish";
import { VaultBackdropRenderer } from "./backdrop-renderer";
import { VaultImageCache } from "./image-cache";
import { PdfBackdropCache } from "./pdf-backdrop";
import { getActiveInlineSession, startInlineHandwriteSession } from "./inline-handwrite";

const LEGACY_EMBED_PNG = /-(block|clip|page)-([a-z0-9-]+)\.png$/i;
const FINE_NOTES_FENCE =
  /^(?<prefix>(?:[ \t]*>[ \t]?)*[ \t]*)```finenotes(?:-embed)?[ \t]*\r?\n(?<body>[^\r\n]+)\r?\n\k<prefix>```[ \t]*$/gm;

function blockReference(raw: string): { notebook: string; block: string } | null {
  try {
    const value = JSON.parse(raw) as { notebook?: unknown; block?: unknown; clip?: unknown } | null;
    const block = value?.block ?? value?.clip;
    return typeof value?.notebook === "string" &&
      value.notebook.trim() &&
      typeof block === "string" &&
      block.trim()
      ? { notebook: value.notebook.trim(), block: block.trim() }
      : null;
  } catch {
    return null;
  }
}

function pageBounds(page: Page): Bounds {
  return { minX: 0, minY: 0, maxX: page.geometry.width, maxY: page.geometry.height };
}

function blockBounds(
  page: Page,
  clip: Parameters<typeof resolveBlockBounds>[1],
  block: string,
): Bounds {
  return page.id === block && clip.isExpandable && page.geometry.height > INITIAL_BLOCK_HEIGHT
    ? pageBounds(page)
    : resolveBlockBounds(page, clip);
}

export class HandwriteEmbedManager {
  private readonly backdrop: VaultBackdropRenderer;
  private readonly images: VaultImageCache;
  private pendingActivation: { notebookPath: string; blockId: string } | null = null;
  private publishing = false;
  private readonly activeCards = new Set<() => void>();

  constructor(
    private readonly app: App,
    private readonly plugin: GoodObsidianPlugin,
  ) {
    this.backdrop = new VaultBackdropRenderer(new PdfBackdropCache(app));
    this.images = new VaultImageCache(app);
  }

  queuePendingActivation(notebookPath: string, blockId: string): void {
    this.pendingActivation = { notebookPath, blockId };
  }

  register(): void {
    for (const language of ["finenotes", "finenotes-embed"]) {
      this.plugin.registerMarkdownCodeBlockProcessor(language, async (source, el, ctx) => {
        const ref = blockReference(source);
        if (!ref) {
          el.createDiv({
            cls: "finenotes-embed-error",
            text: "Invalid FineNotes handwriting block.",
          });
          return;
        }
        if (el.closest(".print") || el.ownerDocument.body?.classList.contains("print")) {
          const notebook = this.resolveNotebook(ref.notebook, ctx.sourcePath);
          if (notebook) await this.renderBlockPreview(el, notebook, ref.block, null);
          else el.setText("FineNotes handwriting notebook not found.");
          return;
        }
        ctx.addChild(
          new HandwriteBlockChild(
            el,
            this.app,
            this.plugin,
            this,
            ref.notebook,
            ref.block,
            ctx.sourcePath,
          ),
        );
      });
    }

    this.plugin.addCommand({
      id: "publish-garden-high-quality",
      name: "Publish current note to Digital Garden with high-quality ink",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (
          !file ||
          file.extension !== "md" ||
          this.plugin.isInkFile(file) ||
          !getGardenPublisher(this.app)
        )
          return false;
        if (!checking) void this.publishToGarden(file);
        return true;
      },
    });

    // 2. Backward compatibility for legacy PNG embeds (![[Note-block-xxx.png]] / ![[Note-clip-xxx.png]])
    this.plugin.registerMarkdownPostProcessor(async (el, ctx) => {
      const embeds = el.querySelectorAll<HTMLElement>(".internal-embed");
      for (const embed of Array.from(embeds)) {
        const src = embed.getAttribute("src") ?? "";
        if (!LEGACY_EMBED_PNG.test(src)) continue;
        if (embed.hasClass("finenotes-legacy-wired")) continue;
        embed.addClass("finenotes-legacy-wired");
        const imgFile = this.app.metadataCache.getFirstLinkpathDest(src, ctx.sourcePath);
        if (!imgFile) continue;
        if (el.closest(".print") || el.ownerDocument.body?.classList.contains("print")) {
          try {
            const source = await this.findLegacySource(imgFile);
            if (source) await this.addPrintImage(embed, source.page, source.bounds, true);
          } catch (error) {
            console.warn(
              "FineNotes could not render a legacy image for print",
              imgFile.path,
              error,
            );
          }
          continue;
        }
        if (LEGACY_EMBED_PNG.exec(src)?.[1].toLowerCase() === "page") continue;

        const btn = embed.createEl("button", {
          cls: "clickable-icon finenotes-embed-edit-pill",
          attr: { "aria-label": "Edit handwriting inline", title: "Edit handwriting inline" },
        });
        setIcon(btn, "pencil");
        btn.createSpan({ text: "Edit" });
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          void this.openLegacyPngInline(embed, imgFile, ctx.sourcePath);
        });
      }
    });

    // Re-render live previews when Obsidian theme changes (Dark <-> Light)
    this.plugin.registerEvent(
      this.app.workspace.on("css-change", () => {
        for (const refresh of this.activeCards) refresh();
      }),
    );
  }

  private async openLegacyPngInline(
    embedEl: HTMLElement,
    imgFile: TFile,
    sourcePath: string,
  ): Promise<void> {
    const source = await this.findLegacySource(imgFile);
    if (!source) {
      new Notice("FineNotes: could not locate the backing notebook for this handwriting embed.");
      return;
    }
    const { notebookFile, blockId } = source;
    await startInlineHandwriteSession({
      plugin: this.plugin,
      app: this.app,
      containerEl: embedEl,
      notebookFile,
      blockId,
      sourcePath,
      onClosed: () => {
        void this.renderBlockPreview(embedEl, notebookFile, blockId, () => {
          void this.openLegacyPngInline(embedEl, imgFile, sourcePath);
        });
      },
    });
  }

  private async findLegacySource(img: TFile) {
    const match = LEGACY_EMBED_PNG.exec(img.name);
    const candidate = match && `${match[1].toLowerCase()}-${match[2]}`;
    for (const notebookFile of this.app.vault.getMarkdownFiles()) {
      if (!this.plugin.isInkFile(notebookFile)) continue;
      const raw = await this.app.vault.cachedRead(notebookFile).catch(() => null);
      if (raw === null) continue;
      const doc = parseInkFile(raw, this.plugin.settings.paperWidth).doc;
      for (const page of doc?.pages ?? []) {
        const clip = page.clips?.find(
          (item) => item.imagePath === img.path || item.id === candidate,
        );
        if (clip)
          return { notebookFile, page, blockId: clip.id, bounds: blockBounds(page, clip, clip.id) };
        if (page.pageEmbedPath === img.path) {
          return { notebookFile, page, blockId: page.id, bounds: pageBounds(page) };
        }
      }
    }
    return null;
  }

  private resolveNotebook(path: string, sourcePath: string): TFile | null {
    const candidate =
      this.app.vault.getFileByPath(path) ??
      this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
    return candidate && this.plugin.isInkFile(candidate) ? candidate : null;
  }

  private async publishToGarden(file: TFile): Promise<void> {
    const garden = getGardenPublisher(this.app);
    if (!garden || this.publishing) return;
    if (this.app.metadataCache.getFileCache(file)?.frontmatter?.["dg-publish"] !== true) {
      new Notice("Enable dg-publish before publishing this note to Digital Garden.");
      return;
    }
    this.publishing = true;
    try {
      const content = await this.app.vault.cachedRead(file);
      const assets = new Map<string, StagedHandwriting>();
      const replacements: Array<{ index: number; length: number; text: string }> = [];
      let bytes = 0;
      const stage = async (asset: TFile, page: Page, bounds: Bounds): Promise<void> => {
        if (assets.has(asset.path)) return;
        const png = await this.exportPng(page, bounds, true, false);
        bytes += png.size;
        if (bytes > 32_000_000)
          throw new Error("Handwriting images exceed the 32 MB publish budget.");
        assets.set(asset.path, { file: asset, png: await png.arrayBuffer() });
      };
      for (const match of content.matchAll(FINE_NOTES_FENCE)) {
        const { prefix, body } = match.groups!;
        const ref = blockReference(body.replace(/^(?:[ \t]*>[ \t]?)*/, ""));
        const notebook = ref && this.resolveNotebook(ref.notebook, file.path);
        if (!ref || !notebook)
          throw new Error("A handwriting block has no readable backing notebook.");
        const doc = parseInkFile(
          await this.app.vault.cachedRead(notebook),
          this.plugin.settings.paperWidth,
        ).doc;
        const found = doc && findBlockInDocument(doc, ref.block);
        if (!found) throw new Error(`Handwriting block not found: ${ref.block}`);
        const name = `handwriting-block-${ref.block.replace(/[^a-z0-9-]/gi, "-")}.png`;
        const digest = new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(notebook.path)),
        );
        const folder = Array.from(digest.subarray(0, 12), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        const path = `FineNotes/Published-ink/${folder}/${name}`;
        const asset = Object.assign(Object.create(TFile.prototype) as TFile, {
          path,
          name,
          basename: name.slice(0, -4),
          extension: "png",
        });
        await stage(asset, found.page, blockBounds(found.page, found.clip, ref.block));
        replacements.push({
          index: match.index!,
          length: match[0].length,
          text: `${prefix}![[${path}]]`,
        });
      }
      for (const embed of this.app.metadataCache.getFileCache(file)?.embeds ?? []) {
        if (!LEGACY_EMBED_PNG.test(embed.link)) continue;
        const image = this.app.metadataCache.getFirstLinkpathDest(embed.link, file.path);
        if (!image) continue;
        const source = await this.findLegacySource(image);
        if (source) await stage(image, source.page, source.bounds);
      }
      let markdown = content;
      for (const { index, length, text } of replacements.reverse()) {
        markdown = markdown.slice(0, index) + text + markdown.slice(index + length);
      }
      await publishStagedNote(garden, file, markdown, assets);
    } catch (error) {
      new Notice(
        `FineNotes could not prepare this note for Digital Garden. ${String(error)}`,
        9000,
      );
    } finally {
      this.publishing = false;
    }
  }

  private paint(
    canvas: HTMLCanvasElement,
    page: Page,
    bounds: Bounds,
    width: number,
    dpr: number,
    dark: boolean,
    transparent = false,
  ): void {
    const paper = dark ? { ...DARK_PAPER, night: false } : LIGHT_PAPER;
    const backdrop =
      page.backdrop.kind === "pdf" ? page.backdrop : { ...page.backdrop, paperColor: paper.paper };
    renderPageThumbnail(
      canvas,
      handwritingForBackground({ ...page, backdrop }, dark),
      this.backdrop,
      width,
      dpr,
      {
        crop: {
          x: bounds.minX,
          y: bounds.minY,
          width: bounds.maxX - bounds.minX,
          height: bounds.maxY - bounds.minY,
        },
        paper,
        transparent,
        highlighterAlpha: this.plugin.settings.highlighterAlpha,
        usePressure: this.plugin.settings.pressureWidth !== false,
        images: this.images,
      },
    );
  }

  private async exportPng(
    page: Page,
    bounds: Bounds,
    transparent: boolean,
    dark: boolean,
    doc = document,
  ): Promise<Blob> {
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    const width = Math.min(2400, (4096 * w) / h);
    const canvas = doc.createElement("canvas");
    await this.images.prepare(page.images, width / w);
    try {
      this.paint(canvas, page, bounds, width, 1, dark, transparent);
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode handwriting PNG."))),
          "image/png",
        ),
      );
    } finally {
      canvas.width = canvas.height = 0;
    }
  }

  private async addPrintImage(
    host: HTMLElement,
    page: Page,
    bounds: Bounds,
    replace = false,
  ): Promise<void> {
    const png = await this.exportPng(page, bounds, false, false, host.ownerDocument);
    const src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(png);
    });
    const img = host.createEl("img", {
      cls: "finenotes-print-ink",
      attr: { src, alt: "Handwritten ink", "data-finenotes-print-ready": "true" },
    });
    try {
      await img.decode();
      if (replace) for (const child of Array.from(host.children)) if (child !== img) child.remove();
    } catch (err) {
      img.remove();
      throw err;
    }
  }

  consumePendingActivation(notebookPath: string, blockId: string): boolean {
    if (
      this.pendingActivation &&
      this.pendingActivation.notebookPath === notebookPath &&
      this.pendingActivation.blockId === blockId
    ) {
      this.pendingActivation = null;
      return true;
    }
    return false;
  }

  trackCard(refresh: () => void): () => void {
    this.activeCards.add(refresh);
    return () => this.activeCards.delete(refresh);
  }

  async renderBlockPreview(
    containerEl: HTMLElement,
    notebookFile: TFile,
    blockId: string,
    onEdit: (() => void) | null,
  ): Promise<void> {
    if (getActiveInlineSession()?.hostContainer === containerEl) return;

    try {
      const raw = await this.app.vault.cachedRead(notebookFile);
      if (getActiveInlineSession()?.hostContainer === containerEl) return;
      const parsed = parseInkFile(raw, this.plugin.settings.paperWidth);
      if (!parsed.doc) {
        containerEl.empty();
        containerEl.createDiv({
          cls: "finenotes-embed-error",
          text: "Could not read handwriting notebook.",
        });
        return;
      }
      const found = findBlockInDocument(parsed.doc, blockId);
      if (!found) {
        containerEl.empty();
        containerEl.createDiv({
          cls: "finenotes-embed-error",
          text: "Handwriting block not found.",
        });
        return;
      }

      const { page, clip } = found;
      const bounds = blockBounds(page, clip, blockId);
      containerEl.empty();
      if (!onEdit) {
        await this.addPrintImage(containerEl, page, bounds);
        return;
      }
      containerEl.addClass("finenotes-embed-card");

      const canvas = containerEl.createEl("canvas", { cls: "finenotes-embed-canvas" });
      const dark = containerEl.ownerDocument.body?.classList.contains("theme-dark") ?? false;
      const width = Math.min(
        800,
        Math.max(320, containerEl.clientWidth || 680),
        (2048 * (bounds.maxX - bounds.minX)) / (bounds.maxY - bounds.minY),
      );
      const dpr = Math.min(2, containerEl.ownerDocument.defaultView?.devicePixelRatio || 1);
      this.paint(canvas, page, bounds, width, dpr, dark);
      const printCanvas = containerEl.createEl("canvas", {
        cls: "finenotes-print-ink finenotes-print-copy",
      });
      this.paint(printCanvas, page, bounds, width, dpr, false);
      void this.images
        .prepare(page.images, (width * dpr) / (bounds.maxX - bounds.minX))
        .then(() => {
          if (canvas.parentElement !== containerEl) return;
          this.paint(canvas, page, bounds, width, dpr, dark);
          this.paint(printCanvas, page, bounds, width, dpr, false);
        });

      const editBtn = containerEl.createEl("button", {
        cls: "clickable-icon finenotes-embed-edit-pill",
        attr: { "aria-label": "Write inline", title: "Tap to write inline" },
      });
      setIcon(editBtn, "pencil");
      editBtn.createSpan({ text: "Write" });
      const stopForLivePreview = (e: Event): void => {
        e.stopPropagation();
      };
      for (const evt of ["mousedown", "pointerdown", "touchstart"] as const) {
        editBtn.addEventListener(evt, stopForLivePreview);
        canvas.addEventListener(evt, stopForLivePreview);
      }

      editBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onEdit();
      });

      canvas.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onEdit();
      });
    } catch (err) {
      containerEl.empty();
      containerEl.createDiv({
        cls: "finenotes-embed-error",
        text: `FineNotes: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  destroy(): void {
    this.activeCards.clear();
    this.images.destroy();
    void getActiveInlineSession()?.close();
  }
}

class HandwriteBlockChild extends MarkdownRenderChild {
  private untrack: (() => void) | null = null;
  private mountFrame: number | null = null;

  constructor(
    containerEl: HTMLElement,
    private readonly app: App,
    private readonly plugin: GoodObsidianPlugin,
    private readonly manager: HandwriteEmbedManager,
    private readonly notebookPath: string,
    private readonly blockId: string,
    private readonly sourcePath: string,
  ) {
    super(containerEl);
  }

  override onload(): void {
    const file =
      this.app.vault.getFileByPath(this.notebookPath) ??
      this.app.metadataCache.getFirstLinkpathDest(this.notebookPath, this.sourcePath);
    if (!(file instanceof TFile)) {
      this.containerEl.createDiv({
        cls: "finenotes-embed-error",
        text: `Handwriting notebook not found: ${this.notebookPath}`,
      });
      return;
    }

    const startEdit = (): void => {
      void startInlineHandwriteSession({
        plugin: this.plugin,
        app: this.app,
        containerEl: this.containerEl,
        notebookFile: file,
        blockId: this.blockId,
        sourcePath: this.sourcePath,
        onClosed: () => {
          void this.manager.renderBlockPreview(this.containerEl, file, this.blockId, startEdit);
        },
      });
    };

    const render = (): void => {
      void this.manager.renderBlockPreview(this.containerEl, file, this.blockId, startEdit);
    };

    this.untrack = this.manager.trackCard(render);

    // Nested Live Preview callouts can attach after the processor's first frame.
    // Render a usable preview immediately and consume auto-activation only on mount.
    render();
    const mount = (framesLeft: number): void => {
      this.mountFrame = this.containerEl.ownerDocument.defaultView!.requestAnimationFrame(() => {
        this.mountFrame = null;
        if (this.containerEl.isConnected) {
          if (this.manager.consumePendingActivation(file.path, this.blockId)) startEdit();
        } else if (framesLeft > 0) {
          mount(framesLeft - 1);
        }
      });
    };
    mount(30);
  }

  override onunload(): void {
    if (this.mountFrame !== null) {
      this.containerEl.ownerDocument.defaultView?.cancelAnimationFrame(this.mountFrame);
      this.mountFrame = null;
    }
    this.untrack?.();
    this.untrack = null;
    if (getActiveInlineSession()?.hostContainer === this.containerEl) {
      void getActiveInlineSession()?.close();
    }
  }
}
