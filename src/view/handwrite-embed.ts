/**
 * Live Markdown embed manager for Handwrite Here blocks (both `finenotes`
 * code blocks and legacy `*-block-*.png` / `*-clip-*.png` image embeds).
 *
 * Reuses upstream 2.10.0's `renderPageThumbnail(..., { crop })` for crisp,
 * theme-aware previews and activates `InlineHandwriteSession` on tap/click.
 */

import {
  type App,
  MarkdownRenderChild,
  Notice,
  TFile,
  setIcon,
} from "obsidian";
import type GoodObsidianPlugin from "../main";
import { parseInkFile } from "../model/serialize";
import { findBlockInDocument, resolveBlockBounds } from "../model/handwrite-block";
import { DARK_PAPER, LIGHT_PAPER } from "../canvas/backdrop";
import { renderPageThumbnail } from "../canvas/renderer";
import { VaultBackdropRenderer } from "./backdrop-renderer";
import { VaultImageCache } from "./image-cache";
import { PdfBackdropCache } from "./pdf-backdrop";
import {
  getActiveInlineSession,
  startInlineHandwriteSession,
} from "./inline-handwrite";

const LEGACY_EMBED_PNG = /-(block|clip)-([a-z0-9-]+)\.png$/i;

export class HandwriteEmbedManager {
  private readonly backdrop: VaultBackdropRenderer;
  private readonly images: VaultImageCache;
  private pendingActivation: { notebookPath: string; blockId: string } | null = null;
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
    // 1. Standard ```finenotes {"notebook":"...","block":"..."}``` code blocks
    this.plugin.registerMarkdownCodeBlockProcessor("finenotes", (source, el, ctx) => {
      let parsed: { notebook?: string; block?: string; clip?: string } | null = null;
      try {
        parsed = JSON.parse(source.trim()) as { notebook?: string; block?: string; clip?: string };
      } catch {
        parsed = null;
      }
      const notebookPath = parsed?.notebook?.trim();
      const blockId = (parsed?.block ?? parsed?.clip)?.trim();
      if (!notebookPath || !blockId) {
        el.createDiv({ cls: "finenotes-embed-error", text: "Invalid FineNotes handwriting block." });
        return;
      }
      const child = new HandwriteBlockChild(
        el,
        this.app,
        this.plugin,
        this,
        notebookPath,
        blockId,
        ctx.sourcePath,
      );
      ctx.addChild(child);
    });

    // 2. Backward compatibility for legacy PNG embeds (![[Note-block-xxx.png]] / ![[Note-clip-xxx.png]])
    this.plugin.registerMarkdownPostProcessor((el, ctx) => {
      const embeds = el.querySelectorAll<HTMLElement>(".internal-embed");
      for (const embed of Array.from(embeds)) {
        const src = embed.getAttribute("src") ?? "";
        if (!LEGACY_EMBED_PNG.test(src)) continue;
        if (embed.hasClass("finenotes-legacy-wired")) continue;
        embed.addClass("finenotes-legacy-wired");
        const imgFile = this.app.metadataCache.getFirstLinkpathDest(src, ctx.sourcePath);
        if (!imgFile) continue;

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
    const match = LEGACY_EMBED_PNG.exec(imgFile.name);
    const candidateId = match ? `${match[1].toLowerCase()}-${match[2]}` : null;
    const notebooks = this.app.vault
      .getFiles()
      .filter((f) => /\.notebook\.md$/i.test(f.path));

    for (const nb of notebooks) {
      try {
        const raw = await this.app.vault.cachedRead(nb);
        if (!raw.includes(imgFile.path) && (!candidateId || !raw.includes(candidateId))) continue;
        const parsed = parseInkFile(raw, this.plugin.settings.paperWidth);
        if (!parsed.doc) continue;
        for (const page of parsed.doc.pages) {
          const clip = page.clips?.find(
            (c) => c.imagePath === imgFile.path || (candidateId && c.id === candidateId),
          );
          if (clip) {
            await startInlineHandwriteSession({
              plugin: this.plugin,
              app: this.app,
              containerEl: embedEl,
              notebookFile: nb,
              blockId: clip.id,
              sourcePath,
              onClosed: () => {
                void this.renderBlockPreview(embedEl, nb, clip.id, () => {
                  void this.openLegacyPngInline(embedEl, imgFile, sourcePath);
                });
              },
            });
            return;
          }
        }
      } catch {
        // Ignore unreadable notebooks during lookup
      }
    }
    new Notice("FineNotes: could not locate the backing notebook for this handwriting embed.");
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
    onEdit: () => void,
  ): Promise<void> {
    if (!containerEl.isConnected) return;
    if (getActiveInlineSession()?.hostContainer === containerEl) return;

    try {
      const raw = await this.app.vault.cachedRead(notebookFile);
      const parsed = parseInkFile(raw, this.plugin.settings.paperWidth);
      if (!parsed.doc) {
        containerEl.empty();
        containerEl.createDiv({ cls: "finenotes-embed-error", text: "Could not read handwriting notebook." });
        return;
      }
      const found = findBlockInDocument(parsed.doc, blockId);
      if (!found) {
        containerEl.empty();
        containerEl.createDiv({ cls: "finenotes-embed-error", text: "Handwriting block not found." });
        return;
      }

      const { page, clip } = found;
      const bounds = resolveBlockBounds(page, clip);
      const cropW = Math.max(100, bounds.maxX - bounds.minX);
      const cropH = Math.max(80, bounds.maxY - bounds.minY);
      const dark = containerEl.ownerDocument?.body?.classList.contains("theme-dark") ?? false;

      containerEl.empty();
      containerEl.addClass("finenotes-embed-card");

      const canvas = containerEl.createEl("canvas", { cls: "finenotes-embed-canvas" });
      const cssWidth = Math.min(800, Math.max(320, containerEl.clientWidth || 680));
      const dpr = Math.min(2, window.devicePixelRatio || 1);

      renderPageThumbnail(canvas, page, this.backdrop, cssWidth, dpr, {
        crop: { x: bounds.minX, y: bounds.minY, width: cropW, height: cropH },
        paper: dark ? DARK_PAPER : LIGHT_PAPER,
        highlighterAlpha: this.plugin.settings.highlighterAlpha,
        usePressure: this.plugin.settings.pressureWidth !== false,
        images: this.images,
      });

      const editBtn = containerEl.createEl("button", {
        cls: "clickable-icon finenotes-embed-edit-pill",
        attr: { "aria-label": "Write inline", title: "Tap to write inline" },
      });
      setIcon(editBtn, "pencil");
      editBtn.createSpan({ text: "Write" });
      editBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onEdit();
      });

      canvas.addEventListener("click", (e) => {
        e.preventDefault();
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
    void getActiveInlineSession()?.close();
  }
}

class HandwriteBlockChild extends MarkdownRenderChild {
  private untrack: (() => void) | null = null;

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

    if (this.manager.consumePendingActivation(file.path, this.blockId)) {
      startEdit();
    } else {
      render();
    }
  }

  override onunload(): void {
    this.untrack?.();
    this.untrack = null;
    if (getActiveInlineSession()?.hostContainer === this.containerEl) {
      void getActiveInlineSession()?.close();
    }
  }
}
