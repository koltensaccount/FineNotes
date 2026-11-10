/** Run at most one reading-view render at a time, after the initial preview paints. */
export class ReadingPngQueue {
  private readonly pending = new Map<Element, () => Promise<void>>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private disposed = false;

  constructor(private readonly canRender: (element: Element) => boolean) {}

  add(element: Element, render: () => Promise<void>): void {
    if (this.disposed) return;
    this.pending.set(element, render);
    this.schedule();
  }

  cancel(element: Element): void {
    this.pending.delete(element);
  }

  destroy(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.pending.clear();
  }

  private schedule(): void {
    if (this.timer !== undefined || this.running || !this.pending.size) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.renderNext();
    }, 200);
  }

  private async renderNext(): Promise<void> {
    for (const [element, render] of this.pending) {
      this.pending.delete(element);
      if (!this.canRender(element)) continue;
      this.running = true;
      try {
        await render();
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("[FineNotes] Could not sharpen reading preview:", error);
        }
      } finally {
        this.running = false;
      }
      break;
    }
    this.schedule();
  }
}
