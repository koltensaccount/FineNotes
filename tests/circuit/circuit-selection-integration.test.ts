import { describe, expect, it, vi } from "vitest";
import { History } from "../../src/model/history";
import { StrokeIndex } from "../../src/view/stroke-index";
import { blankPage, emptyDocument, type CircuitElement } from "../../src/model/document";
import { polygonOf } from "../../src/canvas/lasso";
import { TranslateElements, copyElements } from "../../src/model/selection-commands";
import { KIRCHHOFF_IR_VERSION } from "../../src/circuit/ir";

vi.mock("obsidian", () => ({ Modal: class {}, Notice: class {}, Platform: {}, setIcon: vi.fn() }));

const { InkSurface } = await import("../../src/view/ink-surface");

type State = Record<string, any>;

function call<T = any>(s: State, name: string, ...args: any[]): T {
  return (s[name] as (...a: any[]) => T).apply(s, args);
}

function createFixture() {
  const page = blankPage("p1");
  page.geometry = { width: 800, height: 1000 };
  page.circuits = [];

  const doc = emptyDocument();
  doc.pages = [page];
  const history = new History();
  const strokeIndex = new StrokeIndex();
  let seq = 0;

  const circuit: CircuitElement = {
    id: "c_test_1",
    x: 100,
    y: 100,
    w: 200,
    h: 150,
    ir: {
      version: KIRCHHOFF_IR_VERSION,
      components: {
        r1: { id: "r1", type: "resistor", x: 2, y: 2, rotation: 0, ports: { a: "n1", b: "n2" }, label: "R1" },
      },
      nodes: {
        n1: { id: "n1", x: 0, y: 2 },
        n2: { id: "n2", x: 4, y: 2 },
      },
      wires: [],
      gridSize: 20,
    },
  };
  page.circuits.push(circuit);

  const s: State = Object.assign(Object.create(InkSurface.prototype), {
    doc,
    history,
    strokeIndex,
    selection: null,
    pdfRegion: null,
    pdfRegionCandidate: null,
    imageSel: null,
    baseScale: 1,
    userZoom: 1,
    toolState: { tool: "select", lassoMode: "rect", lassoFilter: { images: true } },
    callbacks: {},
    renderer: null,
    groupDrag: null,
    selectedShapeFrame: null,
    imagesShown: true,
    openCircuitEditor: vi.fn(),
    clearSelection() {
      this.selection = null;
      this.pdfRegion = null;
      this.pdfRegionCandidate = null;
    },
    deselectImage() {
      this.imageSel = null;
    },
    cancelImageDrag: vi.fn(),
    cancelGroupDrag: vi.fn(),
    endCrop: vi.fn(),
    editingTextView: () => null,
    syncSelectionOverlay: vi.fn(),
    syncImageOverlay: vi.fn(),
    syncActionBar: vi.fn(),
    renderDry: vi.fn(),
    syncTextBoxes: vi.fn(),
    changed: vi.fn(),
    selectionTakenAway: vi.fn(),
    boxForPage: () => ({ index: 0, x: 0, y: 0, width: 800, height: 1000 }),
    pageAt: () => page,
    textBoxFrameOf: (_id: string, box: any) => box,
    freshIds: () => ({
      stroke: () => `s${++seq}`,
      image: () => `i${++seq}`,
      textBox: () => `t${++seq}`,
      circuit: () => `c${++seq}`,
    }),
  });

  return { s, page, doc, history, circuit };
}

describe("Circuit selection and editing integration", () => {
  it("selects circuit inside lasso rectangle and provides 'Edit Circuit' action", () => {
    const { s, circuit } = createFixture();

    // Lasso rectangle enclosing (90, 90) to (320, 260), which covers the circuit (100, 100, 200, 150)
    const poly = polygonOf([90, 90, 320, 90, 320, 260, 90, 260])!;
    call(s, "selectInside", { index: 0 }, poly);

    expect(s.selection).not.toBeNull();
    expect(s.selection.circuits).toHaveLength(1);
    expect(s.selection.circuits[0].id).toBe("c_test_1");

    // Check group actions
    const actions: any[] = call(s, "groupActions", s.selection);
    const editAction = actions.find((a) => a.id === "edit-circuit");
    expect(editAction).toBeDefined();
    expect(editAction.label).toBe("Edit Circuit");

    // Trigger Edit Circuit action
    editAction.run();
    expect(s.openCircuitEditor).toHaveBeenCalledWith("p1", circuit);
  });

  it("selects circuit via tapSelect when clicking within circuit bounds", () => {
    const { s, circuit } = createFixture();

    // Tap inside the circuit at (150, 150)
    call(s, "tapSelect", { index: 0 }, { x: 150, y: 150 }, 10);

    expect(s.selection).not.toBeNull();
    expect(s.selection.circuits).toHaveLength(1);
    expect(s.selection.circuits[0].id).toBe(circuit.id);

    // Tap outside at (500, 500)
    call(s, "tapSelect", { index: 0 }, { x: 500, y: 500 }, 10);
    expect(s.selection).toBeNull();
  });

  it("moves circuit with TranslateElements and restores geometry on undo", () => {
    const { doc, history, circuit } = createFixture();

    const cmd = new TranslateElements("p1", { strokes: [], images: [], textBoxes: [], circuits: [circuit] }, 50, 30);
    history.push(doc, cmd);

    expect(circuit.x).toBe(150);
    expect(circuit.y).toBe(130);

    // Undo
    history.undo(doc);
    expect(circuit.x).toBe(100);
    expect(circuit.y).toBe(100);

    // Redo
    history.redo(doc);
    expect(circuit.x).toBe(150);
    expect(circuit.y).toBe(130);
  });

  it("removes circuit with removeSelection and restores on undo", () => {
    const { s, page, doc, history, circuit } = createFixture();

    // Select the circuit first
    s.selection = {
      pageId: "p1",
      strokes: [],
      images: [],
      textBoxes: [],
      circuits: [circuit],
    };

    const deleted = call<boolean>(s, "removeSelection", "Delete selection");
    expect(deleted).toBe(true);
    expect(page.circuits).toHaveLength(0);

    // Undo
    history.undo(doc);
    expect(page.circuits).toBeDefined();
    expect(page.circuits![0].id).toBe(circuit.id);
  });

  it("duplicates circuit with deep copy and fresh ID", () => {
    const { s, circuit } = createFixture();

    const elements = { strokes: [], images: [], textBoxes: [], circuits: [circuit] };
    const copies = copyElements(elements, s.freshIds(), 20, 20);

    expect(copies.circuits).toHaveLength(1);
    expect(copies.circuits![0].id).not.toBe(circuit.id);
    expect(copies.circuits![0].x).toBe(circuit.x + 20);
    expect(copies.circuits![0].y).toBe(circuit.y + 20);
    expect(copies.circuits![0].ir).toEqual(circuit.ir);
  });
});
