import { describe, expect, it } from "vitest";
import { createEmptyCircuit } from "../../src/circuit/ir";
import { circuitToTikz, tikzToCircuit } from "../../src/circuit/ir2tikz";
import { renderCircuitToSvg } from "../../src/circuit/svg-render";

describe("CircuitikZ Serializer & Parser", () => {
  it("serializes components and wires to standard CircuitikZ LaTeX", () => {
    const circuit = createEmptyCircuit("RC Lowpass");
    circuit.nodes["n1"] = { id: "n1", x: 0, y: 0 };
    circuit.nodes["n2"] = { id: "n2", x: 3, y: 0, junction: true };
    circuit.nodes["n3"] = { id: "n3", x: 3, y: 3 };

    circuit.components["r1"] = {
      id: "r1",
      type: "resistor",
      label: "R1",
      value: "10kΩ",
      x: 1.5,
      y: 0,
      rotation: 0,
      ports: { p1: "n1", p2: "n2" },
    };

    circuit.components["c1"] = {
      id: "c1",
      type: "capacitor",
      label: "C1",
      value: "100nF",
      x: 3,
      y: 1.5,
      rotation: 90,
      ports: { p1: "n2", p2: "n3" },
    };

    circuit.wires.push({ id: "w1", fromNode: "n2", toNode: "n3" });

    const tikz = circuitToTikz(circuit);
    expect(tikz).toContain("\\begin{circuitikz}[american]");
    expect(tikz).toContain("\\end{circuitikz}");
    expect(tikz).toContain("to[R, l=$R1$, v=$10kΩ$]");
    expect(tikz).toContain("to[C, l=$C1$, v=$100nF$]");
    expect(tikz).toContain("\\node[circ] at (3, 0)");
    expect(tikz).toContain("\\draw (3, 0) -- (3, -3);");
  });

  it("handles battery and DC voltage source polarity conventions", () => {
    const circuit = createEmptyCircuit();
    circuit.nodes["pos"] = { id: "pos", x: 0, y: 2 };
    circuit.nodes["neg"] = { id: "neg", x: 0, y: 0 };

    circuit.components["v1"] = {
      id: "v1",
      type: "vsource_dc",
      label: "V_in",
      value: "5V",
      x: 0,
      y: 1,
      rotation: 90,
      ports: { pos: "pos", neg: "neg" },
    };

    const tikz = circuitToTikz(circuit);
    expect(tikz).toContain("to[V, l=$V_in$, v=$5V$]");
    // Positive node emitted first
    expect(tikz).toContain("\\draw (0, -2) to[V");
  });

  it("parses CircuitikZ LaTeX back into Kirchhoff IR (round trip)", () => {
    const tikzCode = `
\\begin{circuitikz}[american]
  \\draw (0, 0) to[R, l=$R_1$, v=$1k$] (3, 0);
  \\draw (3, 0) to[C, l=$C_1$] (3, -3);
  \\node[circ] at (3, 0) {};
  \\draw (3, 0) -- (5, 0);
\\end{circuitikz}
`;

    const { circuit, diagnostics } = tikzToCircuit(tikzCode);
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);

    const comps = Object.values(circuit.components);
    expect(comps).toHaveLength(2);

    const r = comps.find((c) => c.type === "resistor");
    expect(r).toBeDefined();
    expect(r?.label).toBe("R_1");
    expect(r?.value).toBe("1k");

    const c = comps.find((c) => c.type === "capacitor");
    expect(c).toBeDefined();
    expect(c?.label).toBe("C_1");

    // Junction recognized
    const junctionNode = Object.values(circuit.nodes).find((n) => n.junction);
    expect(junctionNode).toBeDefined();
    expect(junctionNode?.x).toBe(3);
    expect(junctionNode?.y).toBe(0);

    // Wire recognized
    expect(circuit.wires.length).toBeGreaterThanOrEqual(1);
  });

  it("generates diagnostics for unsupported syntax without throwing", () => {
    const unsupportedTikz = `
\\begin{circuitikz}
  \\draw (0,0) to[R] (2,0);
  \\someUnknownTikzCommand [weird=123];
\\end{circuitikz}
`;
    const { circuit, diagnostics } = tikzToCircuit(unsupportedTikz);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain("Unsupported");
    expect(Object.keys(circuit.components).length).toBe(1);
  });

  it("parses routed multi-segment wires with waypoints preserving connectivity and round-trips", () => {
    const circuit = createEmptyCircuit("Routed Circuit");
    circuit.nodes["n1"] = { id: "n1", x: 0, y: 0 };
    circuit.nodes["n2"] = { id: "n2", x: 6, y: 0 };
    circuit.wires.push({
      id: "w_routed",
      fromNode: "n1",
      toNode: "n2",
      waypoints: [
        { x: 0, y: 3 },
        { x: 6, y: 3 },
      ],
    });

    // 1. Serialize to TikZ: should produce multi-segment \draw
    const tikz = circuitToTikz(circuit);
    expect(tikz).toContain("\\draw (0, 0) -- (0, -3) -- (6, -3) -- (6, 0);");

    // 2. Parse back to Kirchhoff IR: should parse waypoints and wire endpoints without error
    const { circuit: parsed, diagnostics } = tikzToCircuit(tikz);
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(parsed.wires).toHaveLength(1);

    const wire = parsed.wires[0];
    const fromNode = parsed.nodes[wire.fromNode];
    const toNode = parsed.nodes[wire.toNode];
    expect(fromNode.x).toBe(0);
    expect(fromNode.y).toBe(0);
    expect(toNode.x).toBe(6);
    expect(toNode.y).toBe(0);

    expect(wire.waypoints).toBeDefined();
    expect(wire.waypoints).toHaveLength(2);
    expect(wire.waypoints![0]).toEqual({ x: 0, y: 3 });
    expect(wire.waypoints![1]).toEqual({ x: 6, y: 3 });
  });

  it("splits multi-segment wires at intermediate nodes referenced by connecting components", () => {
    const tikz = `
\\begin{circuitikz}
  \\draw (0, 0) -- (2, 0) -- (4, 0);
  \\draw (2, 0) to[R] (2, -3);
\\end{circuitikz}
`;
    const { circuit, diagnostics } = tikzToCircuit(tikz);
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);

    // The wire from (0,0) to (4,0) passing through (2,0) should be split at (2,0)
    // where the resistor connects, so that all 3 branches meet at a single junction node!
    const midNode = Object.values(circuit.nodes).find((n) => Math.abs(n.x - 2) < 0.05 && Math.abs(n.y) < 0.05);
    expect(midNode).toBeDefined();
    expect(midNode?.junction).toBe(true);

    const rComp = Object.values(circuit.components).find((c) => c.type === "resistor");
    expect(rComp).toBeDefined();
    expect(Object.values(rComp!.ports)).toContain(midNode!.id);

    // Both wire segments connect to midNode
    const connectedWires = circuit.wires.filter(
      (w) => w.fromNode === midNode!.id || w.toNode === midNode!.id,
    );
    expect(connectedWires).toHaveLength(2);

    // The midNode connecting all 3 branches is an electrical junction and not a dangling wire
    const danglingAtMid = (circuit.diagnostics || []).filter(
      (d) => d.code === "DANGLING_WIRE" && d.nodeId === midNode!.id,
    );
    expect(danglingAtMid).toHaveLength(0);
  });

  it("splits routed wires at branch nodes along segment interiors", () => {
    const tikz = `
\\begin{circuitikz}
  \\draw (0, 0) -- (4, 0) -- (4, -4);
  \\draw (2, 0) to[R] (2, -2);
\\end{circuitikz}
`;
    const { circuit, diagnostics } = tikzToCircuit(tikz);
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);

    // Node at (2,0) lies along the (0,0) -> (4,0) segment interior
    const branch = Object.values(circuit.nodes).find(
      (n) => Math.abs(n.x - 2) < 0.05 && Math.abs(n.y) < 0.05,
    );
    expect(branch).toBeDefined();
    expect(branch?.junction).toBe(true);

    const rComp = Object.values(circuit.components).find((c) => c.type === "resistor");
    expect(rComp).toBeDefined();
    expect(Object.values(rComp!.ports)).toContain(branch!.id);

    // Two wire segments meet at branch: (0,0) -> branch and branch -> (4,-4) (via waypoint (4,0))
    const connectedWires = circuit.wires.filter(
      (w) => w.fromNode === branch!.id || w.toNode === branch!.id,
    );
    expect(connectedWires).toHaveLength(2);

    const danglingAtBranch = (circuit.diagnostics || []).filter(
      (d) => d.code === "DANGLING_WIRE" && d.nodeId === branch!.id,
    );
    expect(danglingAtBranch).toHaveLength(0);
  });

  it("does not split wire for nodes positioned slightly off the segment line", () => {
    // Segment from (0, 0) to (10, 0) and resistor at (5, 0.1)
    const tikz = `
\\begin{circuitikz}
  \\draw (0, 0) -- (10, 0);
  \\draw (5, -0.1) to[R] (5, -2);
\\end{circuitikz}
`;
    const { circuit } = tikzToCircuit(tikz);
    // Wire from (0,0) to (10,0) should NOT be split because (5, 0.1) is off the wire
    expect(circuit.wires).toHaveLength(1);
    expect(circuit.wires[0].waypoints).toBeUndefined();
  });

  it("preserves closed polyline loops without dropping wires", () => {
    const tikz = `
\\begin{circuitikz}
  \\draw (0, 0) -- (4, 0) -- (4, 4) -- (0, 4) -- (0, 0);
  \\draw (0, 0) to[R] (-3, 0);
\\end{circuitikz}
`;
    const { circuit, diagnostics } = tikzToCircuit(tikz);
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);

    // The closed rectangular loop must be preserved (not discarded as a self-loop)
    expect(circuit.wires.length).toBeGreaterThanOrEqual(2);

    const rComp = Object.values(circuit.components).find((c) => c.type === "resistor");
    expect(rComp).toBeDefined();

    // The node at (0, 0) should be connected to the loop wires and resistor
    const originNode = Object.values(circuit.nodes).find((n) => Math.abs(n.x) < 0.05 && Math.abs(n.y) < 0.05);
    expect(originNode).toBeDefined();
    expect(originNode?.junction).toBe(true);

    const connectedWires = circuit.wires.filter(
      (w) => w.fromNode === originNode!.id || w.toNode === originNode!.id,
    );
    expect(connectedWires.length).toBeGreaterThanOrEqual(2);
  });

  it("preserves separate subpaths in a single draw command without creating false wire connections", () => {
    const tikz = `
\\begin{circuitikz}
  \\draw (0, 0) -- (1, 0) (3, 0) -- (4, 0);
\\end{circuitikz}
`;
    const { circuit, diagnostics } = tikzToCircuit(tikz);
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);

    // Must create exactly two wires for the two distinct subpaths
    expect(circuit.wires).toHaveLength(2);

    // Node coordinates must be (0,0), (1,0), (3,0), (4,0)
    const nCoords = Object.values(circuit.nodes).map((n) => ({ x: n.x, y: n.y }));
    expect(nCoords).toContainEqual({ x: 0, y: 0 });
    expect(nCoords).toContainEqual({ x: 1, y: 0 });
    expect(nCoords).toContainEqual({ x: 3, y: 0 });
    expect(nCoords).toContainEqual({ x: 4, y: 0 });

    // There must NOT be any wire connecting (1,0) to (3,0)
    const wireBetween1and3 = circuit.wires.find((w) => {
      const fn = circuit.nodes[w.fromNode];
      const tn = circuit.nodes[w.toNode];
      return (
        (Math.abs(fn.x - 1) < 0.05 && Math.abs(tn.x - 3) < 0.05) ||
        (Math.abs(fn.x - 3) < 0.05 && Math.abs(tn.x - 1) < 0.05)
      );
    });
    expect(wireBetween1and3).toBeUndefined();
  });

  it("serializes terminal leads for parallel components sharing nodes without collapsing coordinates", () => {
    const circuit = createEmptyCircuit("Parallel Resistors");
    circuit.nodes["na"] = { id: "na", x: 0, y: 0 };
    circuit.nodes["nb"] = { id: "nb", x: 5, y: 0 };

    circuit.components["r1"] = {
      id: "r1",
      type: "resistor",
      label: "R1",
      x: 2.5,
      y: 0,
      rotation: 0,
      ports: { p1: "na", p2: "nb" },
    };

    circuit.components["r2"] = {
      id: "r2",
      type: "resistor",
      label: "R2",
      x: 2.5,
      y: 2,
      rotation: 0,
      ports: { p1: "na", p2: "nb" },
    };

    const tikz = circuitToTikz(circuit);

    // R1 and R2 must NOT collapse onto the exact same coordinates
    expect(tikz).toContain("to[R, l=$R1$]");
    expect(tikz).toContain("to[R, l=$R2$]");

    // R2 is at y=2 (TikZ y=-2), so its bipole path must be near y=-2, not y=0
    expect(tikz).toContain("(1, -2) to[R, l=$R2$] (4, -2)");

    // Terminal leads connecting R2 to na (0,0) and nb (5,0) must be serialized
    expect(tikz).toContain("\\draw (1, -2)");
    expect(tikz).toContain("\\draw (4, -2)");

    // Round-trip parse back to Kirchhoff circuit
    const parsed = tikzToCircuit(tikz);
    expect(parsed.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);

    const parsedComps = Object.values(parsed.circuit.components);
    expect(parsedComps).toHaveLength(2);

    const parsedR1 = parsedComps.find((c) => c.label === "R1");
    const parsedR2 = parsedComps.find((c) => c.label === "R2");
    expect(parsedR1).toBeDefined();
    expect(parsedR2).toBeDefined();

    // The two resistors must be at distinct Y coordinates
    expect(Math.abs(parsedR1!.y - parsedR2!.y)).toBeGreaterThan(1);
  });

  it("anchors exported ground symbols at their electrical terminals so wires connect seamlessly", () => {
    const circuit = createEmptyCircuit("Ground Connection");
    // Catalog ground port is at (comp.x, comp.y - 0.8)
    circuit.nodes["g"] = { id: "g", x: 0, y: -0.8 };
    circuit.components["gnd"] = {
      id: "gnd",
      type: "ground",
      label: "GND",
      x: 0,
      y: 0,
      rotation: 0,
      ports: { gnd: "g" },
    };
    circuit.nodes["top"] = { id: "top", x: 0, y: -3 };
    circuit.wires.push({ id: "w1", fromNode: "top", toNode: "g" });

    const tikz = circuitToTikz(circuit);

    // Ground symbol must be anchored at (0, 0.8) (in Cartesian TikZ coordinates) where wire connects
    expect(tikz).toContain("\\draw (0, 0.8) node[ground] {};");
    expect(tikz).toContain("\\draw (0, 3) -- (0, 0.8);");
  });

  it("preserves diagonal edges when splitting closed wire paths into SVG and TikZ", () => {
    const tikz = `
\\begin{circuitikz}
  \\draw (0, 0) -- (2, 2) -- (4, 0) -- cycle;
\\end{circuitikz}
`;
    const { circuit, diagnostics } = tikzToCircuit(tikz);
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(circuit.wires).toHaveLength(3);

    // Diagonal segments must have direct: true
    const diagonalWires = circuit.wires.filter((w) => w.direct);
    expect(diagonalWires).toHaveLength(2);

    // SVG must render diagonal lines directly without inserting horizontal Manhattan bends
    const svg = renderCircuitToSvg(circuit);
    expect(svg).toContain("<svg");
    expect(svg).toContain("M 0 0 L 40 -40");
  });

  it("preserves diagonal geometry when a branch splits an imported polyline", () => {
    const tikz = `
\\begin{circuitikz}
  \\draw (0, 0) -- (2, 2) -- (4, 2);
  \\draw (1, 1) -- (1, 0);
\\end{circuitikz}
`;
    const { circuit, diagnostics } = tikzToCircuit(tikz);
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);

    // The segment (0,0) -> (1,1) (page y: 0 -> -1) has no waypoints and must be marked direct
    const splitDiagonal = circuit.wires.find((w) => {
      const fn = circuit.nodes[w.fromNode];
      const tn = circuit.nodes[w.toNode];
      return (
        (Math.abs(fn.x - 0) < 0.05 && Math.abs(tn.x - 1) < 0.05 && Math.abs(fn.y - 0) < 0.05 && Math.abs(tn.y - -1) < 0.05) ||
        (Math.abs(fn.x - 1) < 0.05 && Math.abs(tn.x - 0) < 0.05 && Math.abs(fn.y - -1) < 0.05 && Math.abs(tn.y - 0) < 0.05)
      );
    });
    expect(splitDiagonal).toBeDefined();
    expect(splitDiagonal?.direct).toBe(true);

    // SVG must render (0,0) to (1,1) directly without inserting a Manhattan L-bend
    const svg = renderCircuitToSvg(circuit);
    expect(svg).toContain("M 0 0 L 20 -20");
  });

  it("serializes and parses multi-terminal opamp and transistor with named symbol anchors", () => {
    const circuit = createEmptyCircuit("OpAmp & Transistor Test");
    circuit.components["oa1"] = {
      id: "oa1",
      type: "opamp",
      label: "U1",
      x: 5,
      y: 5,
      rotation: 0,
      ports: {
        in_inv: "n_inv",
        in_noninv: "n_noninv",
        out: "n_out",
      },
    };
    // Position nodes separated from op-amp ports so leads are routed
    circuit.nodes["n_inv"] = { id: "n_inv", x: 1, y: 4 };
    circuit.nodes["n_noninv"] = { id: "n_noninv", x: 1, y: 6 };
    circuit.nodes["n_out"] = { id: "n_out", x: 9, y: 5 };

    const tikz = circuitToTikz(circuit);
    expect(tikz).toContain("\\draw (5, -5) node[op amp, l=$U1$] (oa1) {};");
    expect(tikz).toContain("\\draw (oa1.-)");
    expect(tikz).toContain("\\draw (oa1.+)");
    expect(tikz).toContain("\\draw (oa1.out)");

    // Test transistor serialization with anchors
    const qCircuit = createEmptyCircuit("BJT Test");
    qCircuit.components["q1"] = {
      id: "q1",
      type: "transistor_npn",
      label: "Q1",
      x: 4,
      y: 4,
      rotation: 0,
      ports: {
        base: "n_b",
        collector: "n_c",
        emitter: "n_e",
      },
    };
    qCircuit.nodes["n_b"] = { id: "n_b", x: 1, y: 4 };
    qCircuit.nodes["n_c"] = { id: "n_c", x: 5, y: 1 };
    qCircuit.nodes["n_e"] = { id: "n_e", x: 5, y: 7 };

    const qTikz = circuitToTikz(qCircuit);
    expect(qTikz).toContain("\\draw (4, -4) node[npn, l=$Q1$] (q1) {};");
    expect(qTikz).toContain("\\draw (q1.B)");
    expect(qTikz).toContain("\\draw (q1.C)");
    expect(qTikz).toContain("\\draw (q1.E)");

    // Test parsing named anchors back into circuit
    const tikzSnippet = `
\\begin{circuitikz}[american]
  \\draw (5, -5) node[op amp, l=$U1$] (oa1) {};
  \\draw (oa1.-) -- (1, -4);
  \\draw (oa1.+) -- (1, -6);
  \\draw (oa1.out) -- (9, -5);
\\end{circuitikz}
`;
    const { circuit: parsed, diagnostics } = tikzToCircuit(tikzSnippet);
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);

    const parsedOpamp = parsed.components["oa1"];
    expect(parsedOpamp).toBeDefined();
    expect(parsedOpamp.type).toBe("opamp");
    expect(parsedOpamp.label).toBe("U1");

    // The wire connected to (oa1.-) must terminate at the opamp's in_inv port node
    const invNodeId = parsedOpamp.ports["in_inv"];
    expect(invNodeId).toBeDefined();
    const invWire = parsed.wires.find((w) => w.fromNode === invNodeId || w.toNode === invNodeId);
    expect(invWire).toBeDefined();
  });

  it("prevents ID collision when explicit component IDs coincide with generated counters", () => {
    const tikzCode = `
\\begin{circuitikz}[american]
  \\draw (0, 0) node[op amp] (c1) {};
  \\draw (4, 0) to[R] (7, 0);
\\end{circuitikz}
`;
    const { circuit, diagnostics } = tikzToCircuit(tikzCode);
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);

    const compList = Object.values(circuit.components);
    expect(compList).toHaveLength(2);

    const opamp = compList.find((c) => c.type === "opamp");
    const resistor = compList.find((c) => c.type === "resistor");
    expect(opamp).toBeDefined();
    expect(resistor).toBeDefined();
    expect(opamp!.id).toBe("c1");
    expect(resistor!.id).not.toBe("c1");
  });

  it("correctly converts rotations between downward-positive IR and upward-positive TikZ", () => {
    const circuit = createEmptyCircuit();
    circuit.components["u1"] = {
      id: "u1",
      type: "opamp",
      label: "U1",
      x: 0,
      y: 0,
      rotation: 90,
      ports: {},
    };
    const tikz = circuitToTikz(circuit);
    expect(tikz).toContain("rotate=270");

    const parsed = tikzToCircuit(tikz);
    expect(parsed.circuit.components["u1"]?.rotation).toBe(90);
  });

  it("preserves named anchor connections when an unnamed bipole precedes a named transistor", () => {
    const tikzCode = `
\\begin{circuitikz}[american]
  \\draw (-5, 0) to[R] (-2, 0);
  \\draw (0, 0) node[npn] (c1) {};
  \\draw (c1.B) -- (-2, 0);
\\end{circuitikz}
`;
    const { circuit, diagnostics } = tikzToCircuit(tikzCode);
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);

    const transistor = circuit.components["c1"];
    expect(transistor).toBeDefined();
    expect(transistor.type).toBe("transistor_npn");

    const resistor = Object.values(circuit.components).find((c) => c.type === "resistor");
    expect(resistor).toBeDefined();
    expect(resistor!.id).not.toBe("c1");

    // The wire connecting (c1.B) to (-2, 0) must be present and connect to base node
    const baseNodeId = transistor.ports["base"];
    expect(baseNodeId).toBeDefined();
    const baseWire = circuit.wires.find((w) => w.fromNode === baseNodeId || w.toNode === baseNodeId);
    expect(baseWire).toBeDefined();
  });

  it("preserves ground symbol terminal coordinates without drift across round trips", () => {
    const tikzCode = `
\\begin{circuitikz}[american]
  \\draw (0, 0) node[ground] {};
  \\draw (0, 0) -- (0, 2);
\\end{circuitikz}
`;
    const { circuit: parsed1 } = tikzToCircuit(tikzCode);
    const groundComp = Object.values(parsed1.components).find((c) => c.type === "ground");
    expect(groundComp).toBeDefined();
    // In IR, terminal is at y = 0, so center is at y = 0.8
    expect(groundComp!.x).toBe(0);
    expect(groundComp!.y).toBe(0.8);

    // Re-exporting must produce identical ground anchor at (0, 0)
    const tikzReexported = circuitToTikz(parsed1);
    expect(tikzReexported).toContain("\\draw (0, 0) node[ground] {};");

    // Re-parsing again must retain exact coordinates without drift
    const { circuit: parsed2 } = tikzToCircuit(tikzReexported);
    const groundComp2 = Object.values(parsed2.components).find((c) => c.type === "ground");
    expect(groundComp2!.x).toBe(0);
    expect(groundComp2!.y).toBe(0.8);
  });

  it("rejects unresolved component anchors and reports an error diagnostic without creating phantom wires", () => {
    const tikzCode = `
\\begin{circuitikz}[american]
  \\draw (0, 0) -- (missing.out) -- (4, 0);
\\end{circuitikz}
`;
    const { circuit, diagnostics } = tikzToCircuit(tikzCode);
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("Unresolved component anchor: (missing.out)");

    // Must NOT create a false direct wire between (0, 0) and (4, 0)
    expect(circuit.wires).toHaveLength(0);
  });

  it("reports diagnostic warning for unsupported compound bipole paths instead of silently skipping", () => {
    const tikzCode = `
\\begin{circuitikz}[american]
  \\draw (0, 0) to[R] (2, 0) to[C] (2, -2);
\\end{circuitikz}
`;
    const { diagnostics } = tikzToCircuit(tikzCode);
    const warnings = diagnostics.filter((d) => d.severity === "warning");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].message).toContain("Unsupported or unparseable TikZ command");
  });

  it("keeps unreferenced multi-terminal anchors open without creating phantom nodes or spurious connections", () => {
    // Op-amp with only inv, noninv, and out connected (vcc and vee omitted)
    const tikzCode = `
\\begin{circuitikz}[american]
  \\draw (0, 0) node[op amp] (oa1) {};
  \\draw (oa1.-) -- (-3, 0.5);
  \\draw (oa1.+) -- (-3, -0.5);
  \\draw (oa1.out) -- (3, 0);
  \\draw (-2, 2) -- (2, 2);
\\end{circuitikz}
`;
    const { circuit, diagnostics } = tikzToCircuit(tikzCode);
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);

    const oa = circuit.components["oa1"];
    expect(oa).toBeDefined();
    // Only in_inv, in_noninv, and out should be populated
    expect(oa.ports["in_inv"]).toBeDefined();
    expect(oa.ports["in_noninv"]).toBeDefined();
    expect(oa.ports["out"]).toBeDefined();
    expect(oa.ports["vcc"]).toBeUndefined();
    expect(oa.ports["vee"]).toBeUndefined();

    // The wire (-2, 2) -- (2, 2) passes at y = 2 (where vcc or vee might geometrically sit)
    // but must NOT be split or connected to the op amp!
    expect(circuit.wires.some((w) => Object.values(oa.ports).includes(w.fromNode) && (w.toNode === oa.ports["vcc"] || w.fromNode === oa.ports["vcc"]))).toBe(false);
  });
});





