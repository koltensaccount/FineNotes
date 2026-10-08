import { type App, Modal } from "obsidian";
import type { Page } from "../model/document";
import { pageInsertionIndex, type PageDestination } from "../model/page-manager";

/** One confirmed destination picker for PDF import, Move and Paste Pages. */
export class PagePositionPicker extends Modal {
  private gap: number;
  private confirmed = false;
  private observer: IntersectionObserver | null = null;
  constructor(
    app: App,
    private readonly pages: readonly Page[],
    current: number,
    private readonly paint: (canvas: HTMLCanvasElement, index: number) => void,
    private readonly resolve: (gap: number | null) => void,
  ) {
    super(app);
    this.gap = pageInsertionIndex("after", current, pages.length);
    this.current = current;
  }
  private readonly current: number;
  override onOpen(): void {
    this.titleEl.setText("Insert pages");
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-page-position");
    const choices = this.contentEl.createDiv({ cls: "goodobsidian-page-destinations" });
    const custom = this.contentEl.createDiv({ cls: "goodobsidian-page-gaps is-hidden" });
    const buttons: HTMLButtonElement[] = [];
    const pick = (gap: number): void => {
      this.gap = gap;
      buttons.forEach((button, i) => {
        button.toggleClass("is-active", i === gap);
        button.setAttribute("aria-pressed", String(i === gap));
      });
    };
    for (const [label, kind] of [
      ["Before current page", "before"],
      ["After current page", "after"],
      ["Beginning of notebook", "beginning"],
      ["End of notebook", "end"],
      ["Choose position…", "custom"],
    ] as const) {
      const button = choices.createEl("button", { cls: "clickable-icon", text: label });
      button.setAttribute("aria-pressed", String(kind === "after"));
      button.addEventListener("click", () => {
        choices
          .querySelectorAll("button")
          .forEach((el) => el.setAttribute("aria-pressed", String(el === button)));
        custom.toggleClass("is-hidden", kind !== "custom");
        if (kind !== "custom")
          pick(pageInsertionIndex(kind as PageDestination, this.current, this.pages.length));
      });
    }
    // Thumbnail DOM is created only when Choose position is requested; paint visible rows lazily.
    let built = false;
    choices.lastElementChild?.addEventListener("click", () => {
      if (built) return;
      built = true;
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries)
            if (entry.isIntersecting) {
              const canvas = entry.target as HTMLCanvasElement;
              this.paint(canvas, Number(canvas.dataset.pageIndex));
              this.observer?.unobserve(canvas);
            }
        },
        { root: custom, rootMargin: "100px" },
      );
      for (let i = 0; i <= this.pages.length; i++) {
        const gap = custom.createEl("button", {
          cls: "goodobsidian-page-gap clickable-icon",
          text:
            i === 0
              ? "Insert before first page"
              : i === this.pages.length
                ? "Insert after last page"
                : `Insert between pages ${i} and ${i + 1}`,
        });
        gap.addEventListener("click", () => pick(i));
        buttons.push(gap);
        if (i < this.pages.length) {
          const row = custom.createDiv({ cls: "goodobsidian-position-page" });
          const canvas = row.createEl("canvas");
          row.createSpan({ text: `Page ${i + 1}` });
          canvas.dataset.pageIndex = String(i);
          this.observer.observe(canvas);
        }
      }
      pick(this.gap);
    });
    const footer = this.contentEl.createDiv({ cls: "goodobsidian-page-position-actions" });
    const cancel = footer.createEl("button", { cls: "clickable-icon", text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const confirm = footer.createEl("button", { cls: "mod-cta", text: "Confirm position" });
    confirm.addEventListener("click", () => {
      this.confirmed = true;
      this.resolve(this.gap);
      this.close();
    });
  }
  override onClose(): void {
    this.observer?.disconnect();
    if (!this.confirmed) this.resolve(null);
    this.contentEl.empty();
  }
}
