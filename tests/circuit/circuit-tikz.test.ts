import { describe, expect, it } from "vitest";
import { createEmptyCircuit } from "../../src/circuit/ir";
import { circuitToTikz, tikzToCircuit } from "../../src/circuit/ir2tikz";

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
});
