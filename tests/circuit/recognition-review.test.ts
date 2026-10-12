import { describe, expect, it } from "vitest";
import { changeComponentType } from "../../src/circuit/component-edit";
import { circuitSvgForDisplay } from "../../src/circuit/circuit-render";
import {
  cloneCircuit,
  type KirchhoffCircuit,
  validateAndNormalizeCircuit,
  validateCircuitConnectivity,
} from "../../src/circuit/ir";
import { circuitToTikz, tikzToCircuit } from "../../src/circuit/ir2tikz";
import { autoLayoutCircuit } from "../../src/circuit/layout";
import {
  circuitTopologySignature,
  CIRCUIT_SYSTEM_PROMPT,
  RECOGNITION_EXAMPLE,
} from "../../src/circuit/recognition-contract";
import { renderCircuitToSvg } from "../../src/circuit/svg-render";

function bridge(): KirchhoffCircuit {
  return {
    version: "kirchhoff-ir/1.0",
    title: "Bridge rectifier",
    gridSize: 20,
    nodes: {
      ac1: { id: "ac1", x: 4, y: 2 },
      ac2: { id: "ac2", x: 4, y: 10 },
      plus: { id: "plus", x: 12, y: 2 },
      minus: { id: "minus", x: 12, y: 10 },
    },
    components: {
      v1: {
        id: "v1",
        type: "vsource",
        label: "V1",
        value: "12V",
        x: 0,
        y: 6,
        rotation: 0,
        ports: { pos: "ac1", neg: "ac2" },
      },
      d1: {
        id: "d1",
        type: "diode",
        label: "D1",
        x: 8,
        y: 2,
        rotation: 0,
        ports: { anode: "ac1", cathode: "plus" },
      },
      d2: {
        id: "d2",
        type: "diode",
        label: "D2",
        x: 8,
        y: 10,
        rotation: 0,
        ports: { anode: "ac2", cathode: "plus" },
      },
      d3: {
        id: "d3",
        type: "diode",
        label: "D3",
        x: 4,
        y: 6,
        rotation: 270,
        ports: { anode: "minus", cathode: "ac1" },
      },
      d4: {
        id: "d4",
        type: "diode",
        label: "D4",
        x: 12,
        y: 6,
        rotation: 90,
        ports: { anode: "minus", cathode: "ac2" },
      },
      c1: {
        id: "c1",
        type: "polarized_capacitor",
        label: "C1",
        value: "100μF",
        x: 16,
        y: 6,
        rotation: 90,
        ports: { pos: "plus", neg: "minus" },
      },
      r1: {
        id: "r1",
        type: "resistor",
        label: "RL",
        value: "1kΩ",
        x: 20,
        y: 6,
        rotation: 90,
        ports: { p1: "plus", p2: "minus" },
      },
    },
    wires: [],
  };
}

describe("Circuit recognition and correction acceptance", () => {
  it("uses a complete RC prompt example without a wire bypassing a component", () => {
    const circuit = validateAndNormalizeCircuit(RECOGNITION_EXAMPLE);
    expect(circuit.diagnostics).toEqual([]);
    expect(circuit.components.r1.ports).toEqual({ p1: "input", p2: "output" });
    expect(circuit.components.c1.ports).toEqual({ p1: "output", p2: "return" });
    expect(CIRCUIT_SYSTEM_PROMPT).toContain("cathode bar");
    expect(CIRCUIT_SYSTEM_PROMPT).toContain("vsource: pos at (0,-1.5)");
  });

  for (const [name, fixture] of [
    ["RC", () => cloneCircuit(RECOGNITION_EXAMPLE)],
    ["bridge", bridge],
  ] as const) {
    it(`preserves ${name} connectivity and terminal polarity through layout and CircuitikZ round trip`, () => {
      const original = validateAndNormalizeCircuit(fixture());
      const laidOut = autoLayoutCircuit(original);
      expect(circuitTopologySignature(laidOut)).toBe(circuitTopologySignature(original));
      const parsed = tikzToCircuit(circuitToTikz(laidOut));
      expect(parsed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(
        parsed.circuit.diagnostics?.filter(
          (d) => d.code === "INVALID_PORT" || d.code === "SHORTED_COMPONENT",
        ),
      ).toEqual([]);
      expect(circuitTopologySignature(parsed.circuit)).toBe(circuitTopologySignature(original));
    });
  }

  it("has the two correct bridge conduction pairs and separate AC/DC nets", () => {
    const c = bridge();
    expect(c.components.d1.ports).toEqual({ anode: "ac1", cathode: "plus" });
    expect(c.components.d4.ports).toEqual({ anode: "minus", cathode: "ac2" });
    expect(c.components.d2.ports).toEqual({ anode: "ac2", cathode: "plus" });
    expect(c.components.d3.ports).toEqual({ anode: "minus", cathode: "ac1" });
    expect(validateCircuitConnectivity(c)).toEqual([]);
    c.wires.push({ id: "bad", fromNode: "plus", toNode: "minus" });
    expect(
      validateCircuitConnectivity(c)
        .filter((d) => d.code === "SHORTED_COMPONENT")
        .map((d) => d.componentId)
        .sort(),
    ).toEqual(["c1", "r1"]);
  });

  it("reports repair of AI nodes, positions, unknown symbols and dropped wires", () => {
    const c = validateAndNormalizeCircuit({
      components: { c1: { type: "unknown", x: "bad", y: 1, ports: { p1: "missing" } } },
      wires: [{ id: "bad", fromNode: "missing", toNode: "absent" }],
    });
    expect(c.diagnostics?.filter((d) => d.code === "NORMALIZATION_REPAIR")).toHaveLength(4);
  });

  it("maps resistor → diode → polarized capacitor ports without changing their nets", () => {
    const c = cloneCircuit(RECOGNITION_EXAMPLE);
    changeComponentType(c, "r1", "diode");
    expect(c.components.r1.ports).toEqual({ anode: "input", cathode: "output" });
    changeComponentType(c, "r1", "polarized_capacitor");
    expect(c.components.r1.ports).toEqual({ pos: "input", neg: "output" });
    expect(validateCircuitConnectivity(c).filter((d) => d.code === "INVALID_PORT")).toEqual([]);
  });

  it("does not invent transistor pin mappings when changing terminal count", () => {
    const c = cloneCircuit(RECOGNITION_EXAMPLE);
    changeComponentType(c, "r1", "transistor_npn");
    expect(Object.keys(c.components.r1.ports).sort()).toEqual(["base", "collector", "emitter"]);
    expect(Object.values(c.components.r1.ports)).not.toContain("input");
    expect(Object.values(c.components.r1.ports)).not.toContain("output");
  });

  it("imports diode/source terminals and source rotation using the catalog axis", () => {
    const c = tikzToCircuit(
      "\\draw (0, 0) to[V, l=$V1$] (0, -3);\n\\draw (2, 0) to[D, l=$D1$] (4.4, 0);",
    ).circuit;
    const source = Object.values(c.components).find((v) => v.type === "vsource_dc")!;
    expect(source.rotation).toBe(0);
    expect(Object.keys(source.ports)).toEqual(["pos", "neg"]);
    expect(Object.keys(Object.values(c.components).find((v) => v.type === "diode")!.ports)).toEqual(
      ["anode", "cathode"],
    );
  });

  it("rejects unknown CircuitikZ component types instead of silently turning them into resistors", () => {
    expect(
      tikzToCircuit("\\draw (0, 0) to[mystery] (3, 0);").diagnostics.some(
        (d) => d.severity === "error",
      ),
    ).toBe(true);
  });

  it("keeps unmarked crossing wires separate and splits explicitly marked junctions", () => {
    const crossing = "\\draw (-2, 0) -- (2, 0);\n\\draw (0, -2) -- (0, 2);";
    const plain = tikzToCircuit(crossing).circuit;
    expect(plain.wires).toHaveLength(2);
    expect(Object.values(plain.nodes).some((n) => n.x === 0 && n.y === 0)).toBe(false);
    const joined = tikzToCircuit(`${crossing}\n\\node[circ] at (0, 0) {};`).circuit;
    expect(joined.wires).toHaveLength(4);
    expect(Object.values(joined.nodes).find((n) => n.x === 0 && n.y === 0)?.junction).toBe(true);
  });

  it("refreshes old saved SVG once and reuses the cache without changing the notebook", () => {
    const element = {
      id: "old",
      x: 0,
      y: 0,
      w: 200,
      h: 100,
      ir: cloneCircuit(RECOGNITION_EXAMPLE),
      svg: '<svg><circle stroke-width="36" /></svg>',
    };
    const refreshed = circuitSvgForDisplay(element);
    expect(refreshed).toContain('data-finenotes-renderer="2"');
    expect(refreshed).not.toContain('stroke-width="36"');
    expect(circuitSvgForDisplay(element)).toBe(refreshed);
    expect(element.svg).toContain('stroke-width="36"');
  });

  for (const grid of [10, 20, 40]) {
    it(`keeps source and capacitor strokes distinct at grid size ${grid}`, () => {
      const c = cloneCircuit(RECOGNITION_EXAMPLE);
      c.gridSize = grid;
      const svg = renderCircuitToSvg(c);
      expect(svg).toContain('r="0.8" fill="none"');
      expect(svg).toContain(`stroke-width="${1.8 / grid}"`);
      expect(svg).not.toContain('stroke-width="36"');
    });
  }
});
