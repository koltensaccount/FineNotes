import { describe, it, expect, vi } from "vitest";
import { editorFixture, terminalPartition } from "./editor-fixture";
import { cloneCircuit, getComponentPortPosition } from "../../src/circuit/ir";
import { routeAllTerminalLeads } from "../../src/circuit/layout";
import { materializeCircuitGeometry, junctionOnWire } from "../../src/circuit/editor-geometry";
import { getWirePolyline } from "../../src/circuit/wire-geometry";
import { circuitToTikz } from "../../src/circuit/ir2tikz";
vi.mock("obsidian", () => ({ Modal: class {}, Notice: class {}, setIcon: vi.fn() }));
const { CircuitModal } = await import("../../src/view/circuit-modal");
function editor() {
  const modal = new CircuitModal({} as never, {
    circuit: editorFixture(),
    onSave: vi.fn(),
  }) as unknown as Record<string, any>;
  modal.renderVisualView = vi.fn();
  modal.renderVisualStage = vi.fn();
  modal.renderReviewIssues = vi.fn();
  modal.renderCodeView = vi.fn();
  modal.renderBlocksView = vi.fn();
  modal.svgPoint = (e: PointerEvent) => ({ x: e.clientX, y: e.clientY });
  let captured = false;
  modal.visualStageEl = {
    setPointerCapture: () => {
      captured = true;
    },
    hasPointerCapture: () => captured,
    releasePointerCapture: () => {
      captured = false;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return modal;
}
function pointer(
  m: ReturnType<typeof editor>,
  method: string,
  x: number,
  y: number,
  pointerId = 1,
  pointerType = "mouse",
) {
  m[method]({
    pointerId,
    pointerType,
    clientX: x * 20,
    clientY: y * 20,
    target: null,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  });
}
function drag(
  m: ReturnType<typeof editor>,
  x: number,
  y: number,
  toX: number,
  toY: number,
  cancel = false,
) {
  pointer(m, "handleStagePointerDown", x, y);
  pointer(m, "handleStagePointerMove", toX, toY);
  pointer(m, cancel ? "handleStagePointerCancel" : "handleStagePointerUp", toX, toY);
}
describe("circuit editor pointer transactions", () => {
  it("normalizes every generated lead once without changing electrical terminal membership", () => {
    const c = editorFixture(),
      nets = terminalPartition(c);
    expect(routeAllTerminalLeads(c).length).toBeGreaterThan(0);
    materializeCircuitGeometry(c);
    expect(routeAllTerminalLeads(c)).toEqual([]);
    expect(terminalPartition(c)).toEqual(nets);
    const snapshot = JSON.stringify(c);
    materializeCircuitGeometry(c);
    expect(JSON.stringify(c)).toBe(snapshot);
    const reopened = cloneCircuit(JSON.parse(JSON.stringify(c)));
    expect(terminalPartition(reopened)).toEqual(nets);
    expect(circuitToTikz(reopened)).toBe(circuitToTikz(c));
  });
  it.each(["r", "di"])(
    "moves %s through captured pointer events and restores exact geometry through undo/redo",
    (id) => {
      const m = editor(),
        c = m.circuit,
        nets = terminalPartition(c),
        before = JSON.stringify(c),
        comp = c.components[id];
      drag(m, comp.x, comp.y, comp.x + 1, comp.y + 1);
      expect(terminalPartition(m.circuit)).toEqual(nets);
      expect(m.historyUndo).toHaveLength(1);
      const moved = JSON.stringify(m.circuit);
      expect(moved).not.toBe(before);
      for (const w of m.circuit.wires) {
        const pts = getWirePolyline(w, m.circuit.nodes);
        for (let i = 1; i < pts.length; i++)
          expect(
            Math.min(Math.abs(pts[i].x - pts[i - 1].x), Math.abs(pts[i].y - pts[i - 1].y)),
          ).toBeLessThan(0.001);
      }
      m.undo();
      expect(JSON.stringify(m.circuit)).toBe(before);
      m.redo();
      expect(JSON.stringify(m.circuit)).toBe(moved);
    },
  );
  it("moves the bottom junction onto the source bottom row without changing its net and straightens the branch", () => {
    const m = editor(),
      nets = terminalPartition(m.circuit);
    drag(m, 5, 8.5, 5, 8);
    expect(m.circuit.nodes.g.y).toBe(8);
    expect(terminalPartition(m.circuit)).toEqual(nets);
    const wire = m.circuit.wires.find((w: any) => w.id === "bottom-left");
    expect(getWirePolyline(wire, m.circuit.nodes).every((p) => p.y === 8)).toBe(true);
    expect(m.historyUndo).toHaveLength(1);
  });
  it("creates a real junction when a wire ends on another wire, then undoes the entire split in one step", () => {
    const m = editor();
    m.interactionMode = "wire";
    const before = JSON.stringify(m.circuit);
    const port = getComponentPortPosition(
      m.circuit.components.r,
      Object.keys(m.circuit.components.r.ports)[0],
    )!;
    pointer(m, "handleStagePointerDown", port.x, port.y);
    pointer(m, "handleStagePointerDown", 4, 0);
    const junction = Object.values(m.circuit.nodes).find((n: any) => n.x === 4 && n.y === 0) as any;
    expect(junction.junction).toBe(true);
    expect(
      m.circuit.wires.filter((w: any) => w.fromNode === junction.id || w.toNode === junction.id)
        .length,
    ).toBeGreaterThanOrEqual(3);
    expect(m.historyUndo).toHaveLength(1);
    m.undo();
    expect(JSON.stringify(m.circuit)).toBe(before);
    m.redo();
    expect(Object.values(m.circuit.nodes).some((n: any) => n.x === 4 && n.y === 0)).toBe(true);
  });
  it("places ground with its pin on a wire and keeps the existing wire's endpoints connected", () => {
    const m = editor();
    m.addComponent("ground", 4, 0);
    const ground = m.circuit.components[m.selectedComponentId];
    const port = getComponentPortPosition(ground, Object.keys(ground.ports)[0])!;
    expect(port).toEqual({ x: 4, y: 0 });
    expect(routeAllTerminalLeads(m.circuit)).toEqual([]);
    expect(m.historyUndo).toHaveLength(1);
  });
  it("cancels a moving component without any undo entry or electrical changes", () => {
    const m = editor(),
      before = JSON.stringify(m.circuit);
    drag(m, 8, 2, 9, 3, true);
    expect(JSON.stringify(m.circuit)).toBe(before);
    expect(m.historyUndo).toHaveLength(0);
  });
  it("wire splitting is geometric and preserves the previous electrical terminal partition", () => {
    const c = editorFixture(),
      nets = terminalPartition(c);
    const id = junctionOnWire(c, "top", { x: 4, y: 0.1 });
    expect(c.nodes[id!]).toMatchObject({ x: 4, y: 0, junction: true });
    expect(terminalPartition(c)).toEqual(nets);
  });
});

it("a dragged straight bottom segment carries its free junctions, preserves nets and undoes in one step", () => {
  const m = editor();
  drag(m, 5, 8.5, 5, 8);
  const before = JSON.stringify(m.circuit),
    nets = terminalPartition(m.circuit);
  drag(m, 2, 8, 2, 9);
  expect(m.circuit.nodes.e.y).toBe(9);
  expect(m.circuit.nodes.g.y).toBe(9);
  const wire = m.circuit.wires.find((w: any) => w.id === "bottom-left");
  expect(getWirePolyline(wire, m.circuit.nodes).every((p) => p.y === 9)).toBe(true);
  expect(terminalPartition(m.circuit)).toEqual(nets);
  expect(m.historyUndo).toHaveLength(2);
  m.undo();
  expect(JSON.stringify(m.circuit)).toBe(before);
});
it.each([
  [2, 6],
  [6, 2],
])("splits two points on one wire correctly in either direction: %s to %s", (from, to) => {
  const m = editor();
  m.interactionMode = "wire";
  const before = JSON.stringify(m.circuit);
  pointer(m, "handleStagePointerDown", from, 0);
  pointer(m, "handleStagePointerDown", to, 0);
  expect(Object.values(m.circuit.nodes).some((n: any) => n.x === from && n.y === 0)).toBe(true);
  expect(Object.values(m.circuit.nodes).some((n: any) => n.x === to && n.y === 0)).toBe(true);
  expect(m.historyUndo).toHaveLength(1);
  m.undo();
  expect(JSON.stringify(m.circuit)).toBe(before);
});

it.each(["pen", "touch"])(
  "component pointer sequences work for %s and ignore a second contact",
  (pointerType) => {
    const m = editor(),
      nets = terminalPartition(m.circuit);
    pointer(m, "handleStagePointerDown", 8, 2, 1, pointerType);
    pointer(m, "handleStagePointerDown", 0, 4, 2, "touch");
    expect(m.draggingCompId).toBe("r");
    pointer(m, "handleStagePointerMove", 9, 3, 1, pointerType);
    pointer(m, "handleStagePointerUp", 9, 3, 1, pointerType);
    expect(m.circuit.components.r.x).toBe(9);
    expect(m.historyUndo).toHaveLength(1);
    expect(terminalPartition(m.circuit)).toEqual(nets);
  },
);

it("allows saving the displayed circuit despite validation errors", () => {
  const m = editor();
  m.codeDiagnostics = [{line:1,severity:"error",message:"Unrecognized command"}];
  m.close = vi.fn();
  m.handleSave();
  expect(m.onSave).toHaveBeenCalledOnce();
  expect(m.onSave.mock.calls[0][0]).toBe(m.circuit);
  expect(m.close).toHaveBeenCalledOnce();
});

it("allows off-grid component placement with snapping disabled, preserving connections", () => {
  const m = editor(); m.gridSnap = false;
  const nets = terminalPartition(m.circuit);
  drag(m, 8, 2, 8.13, 2.27);
  expect(m.circuit.components.r.x).toBeCloseTo(8.13);
  expect(m.circuit.components.r.y).toBeCloseTo(2.27);
  expect(terminalPartition(m.circuit)).toEqual(nets);
});

it("places an open terminal on an existing wire and keeps a voltage label non-electrical", () => {
  const m=editor();
  m.addComponent("node_open",4,0);
  const terminal=Object.values(m.circuit.components).find((c:any)=>c.type==="node_open") as any;
  const node=m.circuit.nodes[terminal.ports.p1];
  expect(node.x).toBe(4); expect(node.y).toBe(0);
  expect(m.circuit.wires.some((w:any)=>w.fromNode===node.id || w.toNode===node.id)).toBe(true);
  const wires=JSON.stringify(m.circuit.wires);
  m.addComponent("voltage_label",6,5);
  expect(JSON.stringify(m.circuit.wires)).toBe(wires);
  const annotation=Object.values(m.circuit.components).find((c:any)=>c.type==="voltage_label") as any;
  expect(annotation.ports).toEqual({});
});
