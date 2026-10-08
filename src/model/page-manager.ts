/** Page management builds on the existing commands and duplicate semantics. */
import { AddPage, RemovePage, type Command } from "./commands";
import type { InkDocument, Page } from "./document";
import { CompositeCommand, duplicatePageAfter } from "./page-commands";

export type PageDestination = "before" | "after" | "beginning" | "end";
export function pageInsertionIndex(kind: PageDestination, current: number, total: number): number {
  return kind === "beginning"
    ? 0
    : kind === "end"
      ? total
      : Math.max(0, Math.min(total, current + (kind === "after" ? 1 : 0)));
}
export function reorderedPages(
  pages: readonly Page[],
  ids: ReadonlySet<string>,
  gap: number,
): Page[] {
  const selected = pages.filter((page) => ids.has(page.id));
  if (!selected.length) return [...pages];
  const at = Math.max(0, Math.min(pages.length, gap));
  const first = pages.indexOf(selected[0]),
    last = pages.indexOf(selected[selected.length - 1]);
  if (at >= first && at <= last + 1) return [...pages];
  const remaining = pages.filter((page) => !ids.has(page.id));
  const destination = pages.slice(0, at).filter((page) => !ids.has(page.id)).length;
  remaining.splice(destination, 0, ...selected);
  return remaining;
}
export class MovePages implements Command {
  readonly label = "Move pages";
  private previous: Page[] | null = null;
  constructor(
    private readonly ids: ReadonlySet<string>,
    private readonly gap: number,
  ) {}
  apply(doc: InkDocument): void {
    this.previous = [...doc.pages];
    doc.pages = reorderedPages(doc.pages, this.ids, this.gap);
  }
  invert(doc: InkDocument): void {
    if (this.previous) doc.pages = this.previous;
  }
}
/** References (PDF/image/audio timing) follow the existing Duplicate Page rules. */
export function copiedPages(doc: InkDocument, sources: readonly Page[]): Page[] {
  const virtual = { ...doc, pages: [...doc.pages] };
  const copies: Page[] = [];
  for (const source of sources) {
    virtual.pages.push(source);
    const copy = duplicatePageAfter(virtual, virtual.pages.length - 1)?.page;
    virtual.pages.pop();
    if (copy) {
      virtual.pages.push(copy);
      copies.push(copy);
    }
  }
  return copies;
}
export function insertPages(
  pages: readonly Page[],
  gap: number,
  label = "Paste pages",
): CompositeCommand {
  return new CompositeCommand(
    label,
    pages.map((page, i) => new AddPage(gap + i, page)),
  );
}
export function deletePages(doc: InkDocument, ids: ReadonlySet<string>): CompositeCommand | null {
  const indices = doc.pages.flatMap((page, index) => (ids.has(page.id) ? [index] : []));
  if (indices.length === doc.pages.length) indices.pop(); // Retain the last page, matching RemovePage's safeguard.
  return indices.length
    ? new CompositeCommand(
        "Delete pages",
        indices.reverse().map((index) => new RemovePage(index)),
      )
    : null;
}
/** Separate from both the object clipboard and the OS clipboard; same-vault references only. */
export const pageClipboard: { vault: object | null; pages: Page[] } = { vault: null, pages: [] };
