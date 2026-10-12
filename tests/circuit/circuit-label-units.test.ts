import { describe, it, expect } from "vitest";
import { layoutComponentLabels } from "../../src/circuit/label-layout";
import { renderCircuitToSvg } from "../../src/circuit/svg-render";
import type { KirchhoffCircuit, CircuitComponent } from "../../src/circuit/ir";
import { KIRCHHOFF_IR_VERSION } from "../../src/circuit/ir";

describe("Manual label placement standardized in grid units", () => {
  it("treats labelOffset and valueOffset as grid units in label-layout.ts", () => {
    const gridSize = 20;
    const comp: CircuitComponent = {
      id: "R1",
      type: "resistor",
      x: 10, // 10 grid units -> cx = 200px
      y: 15, // 15 grid units -> cy = 300px
      rotation: 0,
      label: "R_1",
      value: "10k\\Omega",
      ports: { p1: "n1", p2: "n2" },
      // Stored in grid units
      labelOffset: { x: 1.5, y: -2.0, manual: true },
      valueOffset: { x: -0.5, y: 2.5, manual: true },
    };

    const circuit: KirchhoffCircuit = {
      version: KIRCHHOFF_IR_VERSION,
      title: "Test",
      gridSize,
      components: { R1: comp },
      nodes: {
        n1: { id: "n1", x: 8, y: 15 },
        n2: { id: "n2", x: 12, y: 15 },
      },
      wires: [],
    };

    const placedMap = layoutComponentLabels(circuit);
    const placed = placedMap.get("R1")!;
    const expectedCx = comp.x * gridSize; // 200
    const expectedCy = comp.y * gridSize; // 300

    // labelX = 200 + 1.5 * 20 = 230
    expect(placed.labelX).toBe(expectedCx + comp.labelOffset!.x * gridSize);
    expect(placed.labelX).toBe(230);

    // labelY = 300 + (-2.0) * 20 = 260
    expect(placed.labelY).toBe(expectedCy + comp.labelOffset!.y * gridSize);
    expect(placed.labelY).toBe(260);

    // valueX = 200 + (-0.5) * 20 = 190
    expect(placed.valueX).toBe(expectedCx + comp.valueOffset!.x * gridSize);
    expect(placed.valueX).toBe(190);

    // valueY = 300 + 2.5 * 20 = 350
    expect(placed.valueY).toBe(expectedCy + comp.valueOffset!.y * gridSize);
    expect(placed.valueY).toBe(350);
  });

  it("preserves label offset across drag -> rerender -> save -> reopen roundtrip", () => {
    const gridSize = 25;
    const initialCircuit: KirchhoffCircuit = {
      version: KIRCHHOFF_IR_VERSION,
      title: "Roundtrip Test",
      gridSize,
      components: {
        C1: {
          id: "C1",
          type: "capacitor",
          x: 4,
          y: 4,
          rotation: 0,
          label: "C_{in}",
          value: "1\\mu F",
          ports: { p1: "n1", p2: "n2" },
        },
      },
      nodes: {
        n1: { id: "n1", x: 2, y: 4 },
        n2: { id: "n2", x: 6, y: 4 },
      },
      wires: [],
    };

    // 1. Simulate dragging label in circuit-modal (grid units)
    // Target position is (x=4, y=2) -> offset is (0, -2) grid units
    const comp = initialCircuit.components["C1"];
    comp.labelOffset = { x: 0, y: -2, manual: true };

    // 2. Rerender to SVG with interactiveOverlay
    const svgOutput = renderCircuitToSvg(initialCircuit, { interactiveOverlay: true });
    expect(svgOutput).toContain('data-label-comp="C1"');
    expect(svgOutput).toContain('data-label-kind="label"');

    // Expected pixel position: cx = 4 * 25 = 100, cy = 4 * 25 = 100
    // labelY = 100 + (-2) * 25 = 50
    const placed = layoutComponentLabels(initialCircuit).get("C1")!;
    expect(placed.labelY).toBe(50);

    // 3. Save (serialize to JSON)
    const jsonSaved = JSON.stringify(initialCircuit);

    // 4. Reopen (deserialize from JSON)
    const reopenedCircuit: KirchhoffCircuit = JSON.parse(jsonSaved);
    const reopenedComp = reopenedCircuit.components["C1"];

    expect(reopenedComp.labelOffset).toEqual({ x: 0, y: -2, manual: true });

    // 5. Layout after reopen matches identical pixel coordinates
    const reopenedPlaced = layoutComponentLabels(reopenedCircuit).get("C1")!;
    expect(reopenedPlaced.labelX).toBe(placed.labelX);
    expect(reopenedPlaced.labelY).toBe(placed.labelY);
  });
});
