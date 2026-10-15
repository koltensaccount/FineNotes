import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => import("./fake-obsidian"));
import { InkView } from "../../src/view/ink-view";
import { emptyDocument } from "../../src/model/document";

describe("PDF entry in Add Pages", () => {
  it("keeps device and vault imports with the existing page commands", () => {
    const actions = new Map<string, () => void>();
    const menu = {
      addSeparator: vi.fn(), showAtPosition: vi.fn(),
      addItem: (build: (item: any) => void) => {
        let title = "";
        const item = {setTitle: (value: string) => {title = value; return item;},
          setIcon: () => item, setDisabled: () => item,
          onClick: (run: () => void) => {actions.set(title, run); return item;}};
        build(item);
      },
    };
    const view = Object.assign(Object.create(InkView.prototype), {
      doc: emptyDocument(), app: {vault: {}}, nativeMenus: {open: () => menu},
      isProtected: () => false, refuseSinglePage: () => false, importPdf: vi.fn(),
    });
    view.openAddPage({getBoundingClientRect: () => ({left: 10, bottom: 40}), ownerDocument: {}}, 0, "after");
    expect([...actions.keys()]).toEqual(["Blank page", "From template…", "Duplicate current page", "Import PDF from device…", "Import PDF from Obsidian vault…"]);
    actions.get("Import PDF from device…")!(); actions.get("Import PDF from Obsidian vault…")!();
    expect(view.importPdf.mock.calls).toEqual([[false], [true]]);
  });
});
