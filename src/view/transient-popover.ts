/** One transient tool popup per document; persistent panels and modals stay independent. */
const active = new WeakMap<Document, {owner: object; close: () => void}>();
export function claimTransient(doc: Document, owner: object, close: () => void): () => void {
  const previous = active.get(doc);
  if (previous && previous.owner !== owner) previous.close();
  active.set(doc, {owner, close});
  return () => {if (active.get(doc)?.owner === owner) active.delete(doc);};
}
export function presetActivation(selected: string | null, id: string, editor: string | null): "select" | "open" | "close" {
  if (selected !== id) return "select";
  if (editor === id) return "close";
  if (editor !== null) return "select";
  return "open";
}

export function dismissTransient(doc: Document): void { active.get(doc)?.close(); }

/** Obsidian owns outside/Escape dismissal; this adapter owns anchor toggle/state only. */
export class AnchoredNativeMenus<M extends { hide(): unknown; onHide(callback: () => void): void }> {
  private current: { menu: M; anchor: HTMLElement } | null = null;
  private tappedOpenAnchor: HTMLElement | null = null;
  private readonly events: EventTarget;
  private readonly down = (event: Event): void => {
    const target = event.target as Node | null;
    this.tappedOpenAnchor = target && this.current?.anchor.contains(target) ? this.current.anchor : null;
  };
  private readonly reset = (): void => { this.tappedOpenAnchor = null; };
  constructor(private readonly doc: Document) {
    // Window capture precedes the native menu's document outside-dismiss handler.
    this.events = doc.defaultView ?? doc;
    this.events.addEventListener("pointerdown", this.down, true);
    this.events.addEventListener("pointercancel", this.reset, true);
    this.events.addEventListener("keydown", this.reset, true);
  }
  open(anchor: HTMLElement, create: () => M): M | null {
    if (this.tappedOpenAnchor === anchor || this.current?.anchor === anchor) {
      this.close();
      return null;
    }
    this.close();
    const menu = create();
    this.current = { menu, anchor };
    const release = claimTransient(this.doc, menu, () => menu.hide());
    menu.onHide(() => {
      release();
      if (this.current?.menu === menu) this.current = null;
    });
    return menu;
  }
  close(): void {
    this.reset();
    this.current?.menu.hide();
    this.current = null;
  }
  destroy(): void {
    this.close();
    this.events.removeEventListener("pointerdown", this.down, true);
    this.events.removeEventListener("pointercancel", this.reset, true);
    this.events.removeEventListener("keydown", this.reset, true);
  }
}
