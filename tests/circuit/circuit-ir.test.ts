import { describe, expect, it } from "vitest";
import {
  type CircuitComponent,
  createEmptyCircuit,
  cloneCircuit,
  getComponentPortPosition,
  validateAndNormalizeCircuit,
} from "../../src/circuit/ir";

describe("Kirchhoff IR", () => {
  it("creates an empty circuit with default grid size", () => {
    const circuit = createEmptyCircuit("Test Circuit");
    expect(circuit.version).toBe("kirchhoff-ir/1.0");
    expect(circuit.title).toBe("Test Circuit");
    expect(circuit.gridSize).toBe(20);
    expect(Object.keys(circuit.nodes)).toHaveLength(0);
    expect(Object.keys(circuit.components)).toHaveLength(0);
    expect(circuit.wires).toHaveLength(0);
  });

  it("calculates component port positions under rotation and mirroring", () => {
    const comp: CircuitComponent = {
      id: "r1",
      type: "resistor" as const,
      label: "R1",
      x: 10,
      y: 10,
      rotation: 0,
      ports: {},
    };

    // Resistor ports are at (-1.5, 0) and (1.5, 0)
    const p1At0 = getComponentPortPosition(comp, "p1");
    expect(p1At0).toEqual({ x: 8.5, y: 10 });
    const p2At0 = getComponentPortPosition(comp, "p2");
    expect(p2At0).toEqual({ x: 11.5, y: 10 });

    // Rotated 90 degrees clockwise (y down)
    comp.rotation = 90;
    const p1At90 = getComponentPortPosition(comp, "p1");
    expect(p1At90?.x).toBeCloseTo(10, 5);
    expect(p1At90?.y).toBeCloseTo(8.5, 5); // x' = -y_offset = 0, y' = x_offset = -1.5 -> (10, 8.5)

    // Mirroring
    comp.rotation = 0;
    comp.mirror = true;
    const p1Mirrored = getComponentPortPosition(comp, "p1");
    expect(p1Mirrored?.x).toBeCloseTo(11.5, 5);
  });

  it("normalizes and sanitizes malformed input safely", () => {
    const raw = {
      version: "kirchhoff-ir/1.0",
      components: {
        bad: {
          type: "unknown_future_component",
          x: "not_a_number",
          ports: { p1: "n1" },
        },
      },
      nodes: {
        n1: { id: "n1", x: 5, y: 5 },
      },
      wires: [
        { fromNode: "n1", toNode: "n2" },
      ],
    };

    const normalized = validateAndNormalizeCircuit(raw);
    expect(normalized.version).toBe("kirchhoff-ir/1.0");
    // Unknown component falls back to generic_box
    expect(normalized.components.bad.type).toBe("generic_box");
    expect(normalized.components.bad.x).toBe(0);
    // Dangling wire to nonexistent n2 must be rejected
    expect(normalized.wires).toHaveLength(0);

    // Valid wire between existing nodes must survive
    const withValidWire = {
      ...raw,
      nodes: { n1: { x: 0, y: 0 }, n2: { x: 5, y: 0 } },
    };
    const normalizedValid = validateAndNormalizeCircuit(withValidWire);
    expect(normalizedValid.wires).toHaveLength(1);
    expect(normalizedValid.wires[0].id).toBe("w1");
  });

  it("clones circuit deeply without sharing mutable references", () => {
    const circuit = createEmptyCircuit();
    circuit.nodes["n1"] = { id: "n1", x: 1, y: 2 };
    circuit.components["r1"] = {
      id: "r1",
      type: "resistor",
      label: "R1",
      x: 1,
      y: 2,
      rotation: 0,
      ports: { p1: "n1" },
    };
    circuit.wires.push({ id: "w1", fromNode: "n1", toNode: "n2", waypoints: [{ x: 5, y: 5 }] });

    const clone = cloneCircuit(circuit);
    expect(clone).toEqual(circuit);

    // Modify clone
    clone.nodes["n1"].x = 99;
    clone.components["r1"].ports["p1"] = "n99";
    clone.wires[0].waypoints![0].x = 88;

    // Original must be untouched
    expect(circuit.nodes["n1"].x).toBe(1);
    expect(circuit.components["r1"].ports["p1"]).toBe("n1");
    expect(circuit.wires[0].waypoints![0].x).toBe(5);
  });
});
