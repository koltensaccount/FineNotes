import { describe, expect, it } from "vitest";
import {
  type KirchhoffCircuit,
  createEmptyCircuit,
} from "../../src/circuit/ir";
import { circuitToTikz, tikzToCircuit } from "../../src/circuit/ir2tikz";
import { rerouteCircuitWires } from "../../src/circuit/layout";
import { buildWirePathD, renderCircuitToSvg } from "../../src/circuit/svg-render";

describe("Circuit Wire Editing & Rerouting", () => {
  function makeTestCircuit(): KirchhoffCircuit {
    const c = createEmptyCircuit("Wire Test");
    // Place two resistors
    c.components["r1"] = {
      id: "r1",
      type: "resistor",
      label: "R1",
      x: 0,
      y: 0,
      rotation: 0,
      ports: { p1: "n1", p2: "n2" },
    };
    c.nodes["n1"] = { id: "n1", x: -1.5, y: 0 };
    c.nodes["n2"] = { id: "n2", x: 1.5, y: 0 };

    c.components["r2"] = {
      id: "r2",
      type: "resistor",
      label: "R2",
      x: 6,
      y: 4,
      rotation: 0,
      ports: { p1: "n3", p2: "n4" },
    };
    c.nodes["n3"] = { id: "n3", x: 4.5, y: 4 };
    c.nodes["n4"] = { id: "n4", x: 7.5, y: 4 };

    // Connect R1.p2 (n2) to R2.p1 (n3)
    c.wires.push({
      id: "w1",
      fromNode: "n2",
      toNode: "n3",
    });

    return c;
  }

  it("rerouteCircuitWires routes wires orthogonally without altering component or node positions", () => {
    const circuit = makeTestCircuit();
    const initialR1Pos = { x: circuit.components["r1"].x, y: circuit.components["r1"].y };
    const initialN2Pos = { x: circuit.nodes["n2"].x, y: circuit.nodes["n2"].y };
    const initialN3Pos = { x: circuit.nodes["n3"].x, y: circuit.nodes["n3"].y };

    const rerouted = rerouteCircuitWires(circuit);

    // Component and node coordinates remain unchanged
    expect(rerouted.components["r1"].x).toBe(initialR1Pos.x);
    expect(rerouted.components["r1"].y).toBe(initialR1Pos.y);
    expect(rerouted.nodes["n2"].x).toBe(initialN2Pos.x);
    expect(rerouted.nodes["n2"].y).toBe(initialN2Pos.y);
    expect(rerouted.nodes["n3"].x).toBe(initialN3Pos.x);
    expect(rerouted.nodes["n3"].y).toBe(initialN3Pos.y);

    // Wire w1 has valid orthogonal waypoints computed
    const wire = rerouted.wires.find((w) => w.id === "w1");
    expect(wire).toBeDefined();
    expect(wire?.waypoints).toBeDefined();
    expect(wire!.waypoints!.length).toBeGreaterThan(0);
  });

  it("rerouteCircuitWires targets only specified wireIds when provided", () => {
    const circuit = makeTestCircuit();
    // Add second wire
    circuit.wires.push({
      id: "w2",
      fromNode: "n1",
      toNode: "n4",
      waypoints: [{ x: 10, y: 10 }],
    });

    // Reroute only w1
    const rerouted = rerouteCircuitWires(circuit, ["w1"]);
    const w1 = rerouted.wires.find((w) => w.id === "w1");
    const w2 = rerouted.wires.find((w) => w.id === "w2");

    expect(w1?.waypoints).toBeDefined();
    // w2's custom waypoints are untouched
    expect(w2?.waypoints).toEqual([{ x: 10, y: 10 }]);
  });

  it("serializes orthogonal Manhattan wires to CircuitikZ using -| syntax when waypoints are absent", () => {
    const circuit = makeTestCircuit();
    // w1 has no explicit waypoints and endpoints differ in both X and Y
    const tikz = circuitToTikz(circuit);
    expect(tikz).toContain("-|");

    // Parsing it back preserves wire connectivity
    const parsed = tikzToCircuit(tikz);
    expect(parsed.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(parsed.circuit.wires.length).toBeGreaterThanOrEqual(1);
  });

  it("renders SVG with wire highlight, data attributes, and interactive waypoint handles", () => {
    const circuit = makeTestCircuit();
    circuit.wires[0].waypoints = [{ x: 3, y: 0 }, { x: 3, y: 4 }];

    const svgInteractive = renderCircuitToSvg(circuit, {
      highlightWireId: "w1",
      showPorts: true,
      interactiveOverlay: true,
    });

    expect(svgInteractive).toContain('data-wire-id="w1"');
    expect(svgInteractive).toContain('class="goodobsidian-waypoint-handle"');
    expect(svgInteractive).toContain('data-waypoint-wire="w1"');
    expect(svgInteractive).toContain('data-component-id="r1"');
    expect(svgInteractive).toContain('data-port-comp="r1"');

    // Without interactiveOverlay (e.g. export), no edit handles or data attributes appear
    const svgExport = renderCircuitToSvg(circuit, {
      interactiveOverlay: false,
    });
    expect(svgExport).not.toContain("data-waypoint-wire");
    expect(svgExport).not.toContain("goodobsidian-waypoint-handle");
  });

  it("renders direct diagonal paths in SVG and TikZ when wire.direct is true", () => {
    const circuit = makeTestCircuit();
    circuit.wires[0].direct = true;
    circuit.wires[0].waypoints = [{ x: 99, y: 99 }]; // waypoints ignored when direct is true

    const svg = renderCircuitToSvg(circuit);
    expect(svg).toContain('d="M 30 0 L 90 80"');

    const tikz = circuitToTikz(circuit);
    expect(tikz).toContain("\\draw (1.5, 0) -- (4.5, -4);");
    expect(tikz).not.toContain("-|");
    expect(tikz).not.toContain("(99, -99)");
  });

  it("buildWirePathD computes precise SVG path strings for wires with and without waypoints", () => {
    const circuit = makeTestCircuit();
    const wire = circuit.wires[0];

    // Orthogonal Manhattan fallback (no waypoints, diagonal delta)
    const d1 = buildWirePathD(wire, circuit.nodes, 20);
    expect(d1).toBe("M 30 0 L 90 0 L 90 80");

    // With explicit waypoints
    wire.waypoints = [{ x: 3, y: 1 }, { x: 3, y: 3 }];
    const d2 = buildWirePathD(wire, circuit.nodes, 20);
    expect(d2).toBe("M 30 0 L 60 20 L 60 60 L 90 80");

    // Direct diagonal mode
    wire.direct = true;
    const d3 = buildWirePathD(wire, circuit.nodes, 20);
    expect(d3).toBe("M 30 0 L 90 80");

    // Returns empty string if node is missing
    const dEmpty = buildWirePathD({ id: "wX", fromNode: "missing1", toNode: "missing2" }, circuit.nodes, 20);
    expect(dEmpty).toBe("");
  });

  it("wire bends do not create junction dots automatically", () => {
    const circuit = createEmptyCircuit("Bend Dot Test");
    circuit.nodes["n_start"] = { id: "n_start", x: 0, y: 0 };
    circuit.nodes["n_bend"] = { id: "n_bend", x: 4, y: 0, junction: false };
    circuit.nodes["n_end"] = { id: "n_end", x: 4, y: 4 };

    circuit.wires.push(
      { id: "w1", fromNode: "n_start", toNode: "n_bend" },
      { id: "w2", fromNode: "n_bend", toNode: "n_end" },
    );

    const svg = renderCircuitToSvg(circuit);
    // There should be NO junction dot (<circle ... r="3.5" ...>) at the bend (4, 0) -> px (80, 0)
    expect(svg).not.toMatch(/<circle[^>]*cx="80"[^>]*cy="0"[^>]*r="3\.5"/);

    // Also check TikZ output does not emit \node[circ] at the bend
    const tikz = circuitToTikz(circuit);
    expect(tikz).not.toContain("\\node[circ]");
  });
});
