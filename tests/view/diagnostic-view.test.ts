import { expect, it } from "vitest";
import { diagnosticView } from "../../src/view/diagnostic-view";
it("chooses the view that received Pencil input when command-palette focus is lost", () => {
 const idle={lastDrawingAt:0}, drawing={lastDrawingAt:100}; expect(diagnosticView(null,[idle,drawing])).toBe(drawing);
});
it("does not copy an idle active view's document-wide outside touch observations",()=>{
 const idle={lastDrawingAt:0}, drawing={lastDrawingAt:100}; expect(diagnosticView(idle,[idle,drawing])).toBe(drawing);
});
it("keeps the active view when no drawing occurred, and handles no open views",()=>{
 const first={lastDrawingAt:0}, active={lastDrawingAt:0}; expect(diagnosticView(active,[first,active])).toBe(active); expect(diagnosticView(null,[])).toBeNull();
});
