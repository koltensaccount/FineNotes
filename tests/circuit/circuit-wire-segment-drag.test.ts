import { describe, expect, it } from "vitest";
import { createEmptyCircuit, type KirchhoffCircuit } from "../../src/circuit/ir";
import { rerouteCircuitWires } from "../../src/circuit/layout";
import {
  dragCircuitWireSegment,
  hitTestCircuitWireSegment,
  simplifyCircuitWire,
} from "../../src/circuit/wire-geometry";

describe("LTspice-Inspired Wire Segment Dragging", () => {
  function makeCircuit(): KirchhoffCircuit {
    const c = createEmptyCircuit("Test Wire Drag");
    c.nodes["n1"] = { id: "n1", x: 0, y: 0 };
    c.nodes["n2"] = { id: "n2", x: 10, y: 0 };
    c.wires.push({
      id: "w1",
      fromNode: "n1",
      toNode: "n2",
    });
    return c;
  }

  it("detects wire segment hit for a straight horizontal wire", () => {
    const circuit = makeCircuit();
    const hit = hitTestCircuitWireSegment(circuit, 5, 0.2, 0.5);
    expect(hit).not.toBeNull();
    expect(hit?.wireId).toBe("w1");
    expect(hit?.segmentIndex).toBe(0);
    expect(hit?.isHorizontal).toBe(true);
  });

  it("drags horizontal segment vertically creating orthogonal bends and preserving endpoints", () => {
    const circuit = makeCircuit();
    // Drag segment 0 of horizontal wire w1 from y=0 to y=3
    const success = dragCircuitWireSegment(circuit, "w1", 0, 3);
    expect(success).toBe(true);

    const wire = circuit.wires.find((w) => w.id === "w1");
    expect(wire).toBeDefined();
    expect(wire?.userEdited).toBe(true);
    expect(wire?.direct).toBe(false);

    // Endpoints n1 and n2 remain unchanged at y=0
    expect(circuit.nodes["n1"].y).toBe(0);
    expect(circuit.nodes["n2"].y).toBe(0);

    // Waypoints should be inserted to form the bridge: (0, 3) and (10, 3)
    expect(wire?.waypoints).toEqual([
      { x: 0, y: 3 },
      { x: 10, y: 3 },
    ]);
  });

  it("drags vertical segment horizontally creating orthogonal bends", () => {
    const c = createEmptyCircuit("Vertical Wire Test");
    c.nodes["n1"] = { id: "n1", x: 2, y: 0 };
    c.nodes["n2"] = { id: "n2", x: 2, y: 8 };
    c.wires.push({
      id: "w_vert",
      fromNode: "n1",
      toNode: "n2",
    });

    const success = dragCircuitWireSegment(c, "w_vert", 0, 5);
    expect(success).toBe(true);

    const wire = c.wires.find((w) => w.id === "w_vert");
    expect(wire?.userEdited).toBe(true);
    // Vertical wire dragged to x=5 has bends at (5, 0) and (5, 8)
    expect(wire?.waypoints).toEqual([
      { x: 5, y: 0 },
      { x: 5, y: 8 },
    ]);
  });

  it("simplifies collinear waypoints after segment drag", () => {
    const c = createEmptyCircuit("Collinear Collapse");
    c.nodes["n1"] = { id: "n1", x: 0, y: 0 };
    c.nodes["n2"] = { id: "n2", x: 10, y: 0 };
    c.wires.push({
      id: "w1",
      fromNode: "n1",
      toNode: "n2",
      waypoints: [
        { x: 2, y: 0 }, // Collinear with start (0, 0)
        { x: 5, y: 0 }, // Collinear
        { x: 8, y: 0 }, // Collinear with end (10, 0)
      ],
    });

    simplifyCircuitWire(c, "w1");
    const wire = c.wires.find((w) => w.id === "w1");
    // All intermediate points are collinear with (0,0) and (10,0), so they should collapse
    expect(wire?.waypoints).toBeUndefined();
  });

  it("protects userEdited wires from being overwritten during automatic reroute", () => {
    const circuit = makeCircuit();
    dragCircuitWireSegment(circuit, "w1", 0, 4);

    const wireBefore = circuit.wires.find((w) => w.id === "w1");
    expect(wireBefore?.userEdited).toBe(true);
    const waypointsBefore = JSON.stringify(wireBefore?.waypoints);

    // Run automatic reroute without forceAll
    const rerouted = rerouteCircuitWires(circuit);
    const wireAfter = rerouted.wires.find((w) => w.id === "w1");

    expect(JSON.stringify(wireAfter?.waypoints)).toBe(waypointsBefore);
  });
});
