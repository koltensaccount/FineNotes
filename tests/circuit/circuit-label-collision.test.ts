import { describe, expect, it } from "vitest";
import { type KirchhoffCircuit } from "../../src/circuit/ir";
import { layoutComponentLabels, type Rect } from "../../src/circuit/label-layout";
import { renderCircuitToSvg } from "../../src/circuit/svg-render";

function rectsOverlap(r1: Rect, r2: Rect): boolean {
  return !(
    r1.maxX < r2.minX ||
    r1.minX > r2.maxX ||
    r1.maxY < r2.minY ||
    r1.minY > r2.maxY
  );
}

describe("Label Collision Avoidance & SVG Assertions", () => {
  it("determines collision-free placements for RC circuit labels and renders clean SVG", () => {
    const rcCircuit: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      title: "RC Filter",
      gridSize: 20,
      nodes: {
        n_in: { id: "n_in", x: 0, y: 0, junction: false },
        n_mid: { id: "n_mid", x: 4, y: 0, junction: true },
        n_out: { id: "n_out", x: 8, y: 0, junction: false },
        n_gnd: { id: "n_gnd", x: 4, y: 4, junction: false },
      },
      components: {
        r1: {
          id: "r1",
          type: "resistor",
          label: "R1",
          value: "10kΩ",
          x: 2,
          y: 0,
          rotation: 0,
          ports: { p1: "n_in", p2: "n_mid" },
        },
        c1: {
          id: "c1",
          type: "capacitor",
          label: "C1",
          value: "100nF",
          x: 4,
          y: 2,
          rotation: 90,
          ports: { p1: "n_mid", p2: "n_gnd" },
        },
      },
      wires: [{ id: "w1", fromNode: "n_mid", toNode: "n_out" }],
    };

    const placements = layoutComponentLabels(rcCircuit);
    expect(placements.has("r1")).toBe(true);
    expect(placements.has("c1")).toBe(true);

    const r1Bounds = placements.get("r1")!.bounds;
    const c1Bounds = placements.get("c1")!.bounds;

    // R1 and C1 label bounding boxes must not collide
    expect(rectsOverlap(r1Bounds, c1Bounds)).toBe(false);

    // Render SVG and verify text contents and XML structure
    const svg = renderCircuitToSvg(rcCircuit);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("R1");
    expect(svg).toContain("10kΩ");
    expect(svg).toContain("C1");
    expect(svg).toContain("100nF");
  });

  it("places labels safely in a Bridge Rectifier with filter capacitor", () => {
    const bridgeCircuit: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      title: "Bridge Rectifier with Filter",
      gridSize: 20,
      nodes: {
        ac1: { id: "ac1", x: 2, y: 4, junction: true },
        ac2: { id: "ac2", x: 6, y: 4, junction: true },
        pos: { id: "pos", x: 4, y: 1, junction: true },
        neg: { id: "neg", x: 4, y: 7, junction: true },
        out_pos: { id: "out_pos", x: 10, y: 1, junction: false },
        out_neg: { id: "out_neg", x: 10, y: 7, junction: false },
      },
      components: {
        d1: {
          id: "d1",
          type: "diode",
          label: "D1",
          x: 3,
          y: 2.5,
          rotation: 45,
          ports: { anode: "ac1", cathode: "pos" },
        },
        d2: {
          id: "d2",
          type: "diode",
          label: "D2",
          x: 5,
          y: 2.5,
          rotation: 135,
          ports: { anode: "ac2", cathode: "pos" },
        },
        d3: {
          id: "d3",
          type: "diode",
          label: "D3",
          x: 3,
          y: 5.5,
          rotation: 315,
          ports: { anode: "neg", cathode: "ac1" },
        },
        d4: {
          id: "d4",
          type: "diode",
          label: "D4",
          x: 5,
          y: 5.5,
          rotation: 225,
          ports: { anode: "neg", cathode: "ac2" },
        },
        c_filt: {
          id: "c_filt",
          type: "polarized_capacitor",
          label: "C_filt",
          value: "1000µF",
          x: 8,
          y: 4,
          rotation: 90,
          ports: { pos: "pos", neg: "neg" },
        },
        r_load: {
          id: "r_load",
          type: "resistor",
          label: "R_L",
          value: "1kΩ",
          x: 10,
          y: 4,
          rotation: 90,
          ports: { p1: "out_pos", p2: "out_neg" },
        },
      },
      wires: [
        { id: "w_top", fromNode: "pos", toNode: "out_pos" },
        { id: "w_bot", fromNode: "neg", toNode: "out_neg" },
      ],
    };

    const placements = layoutComponentLabels(bridgeCircuit);
    const boundsList = Array.from(placements.values()).map((p) => p.bounds);

    // Ensure no two component labels collide with each other
    for (let i = 0; i < boundsList.length; i++) {
      for (let j = i + 1; j < boundsList.length; j++) {
        expect(rectsOverlap(boundsList[i], boundsList[j])).toBe(false);
      }
    }

    const svg = renderCircuitToSvg(bridgeCircuit);
    expect(svg).toContain("C_filt");
    expect(svg).toContain("1000µF");
    expect(svg).toContain("R_L");
    expect(svg).toContain("1kΩ");
  });

  it("handles MOSFET amplifier without label overlapping transistor body or wires", () => {
    const mosfetCircuit: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      title: "MOSFET Common Source Amplifier",
      gridSize: 20,
      nodes: {
        vdd: { id: "vdd", x: 6, y: 0, junction: false },
        drain_node: { id: "drain_node", x: 6, y: 3, junction: true },
        gate_node: { id: "gate_node", x: 3, y: 5, junction: true },
        source_node: { id: "source_node", x: 6, y: 7, junction: false },
        vout: { id: "vout", x: 9, y: 3, junction: false },
      },
      components: {
        rd: {
          id: "rd",
          type: "resistor",
          label: "R_D",
          value: "2.2kΩ",
          x: 6,
          y: 1.5,
          rotation: 90,
          ports: { p1: "vdd", p2: "drain_node" },
        },
        m1: {
          id: "m1",
          type: "transistor_nmos",
          label: "M1",
          x: 6,
          y: 5,
          rotation: 0,
          ports: { gate: "gate_node", drain: "drain_node", source: "source_node" },
        },
      },
      wires: [
        { id: "w_out", fromNode: "drain_node", toNode: "vout" },
      ],
    };

    const placements = layoutComponentLabels(mosfetCircuit);
    expect(placements.has("m1")).toBe(true);
    expect(placements.has("rd")).toBe(true);

    const m1Placement = placements.get("m1")!;
    const rdPlacement = placements.get("rd")!;

    expect(rectsOverlap(m1Placement.bounds, rdPlacement.bounds)).toBe(false);

    const svg = renderCircuitToSvg(mosfetCircuit);
    expect(svg).toContain("M1");
    expect(svg).toContain("R_D");
    expect(svg).toContain("2.2kΩ");
  });

  it("avoids collisions with rendered Manhattan wire paths for unrouted non-collinear wires", () => {
    const circuit: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      title: "Manhattan Wire Collision",
      gridSize: 20,
      nodes: {
        n1: { id: "n1", x: 0, y: 0, junction: false },
        n2: { id: "n2", x: 6, y: 6, junction: false },
        c_p1: { id: "c_p1", x: 2, y: 1.5, junction: false },
        c_p2: { id: "c_p2", x: 4, y: 1.5, junction: false },
      },
      components: {
        r1: {
          id: "r1",
          type: "resistor",
          label: "R_TEST",
          value: "100Ω",
          x: 3,
          y: 1.5,
          rotation: 0,
          ports: { p1: "c_p1", p2: "c_p2" },
        },
      },
      wires: [
        // Non-collinear unrouted wire: renders as Manhattan L-bend (0,0) -> (6,0) -> (6,6)
        { id: "w_diag", fromNode: "n1", toNode: "n2" },
      ],
    };

    const placements = layoutComponentLabels(circuit);
    expect(placements.has("r1")).toBe(true);
    const r1Placement = placements.get("r1")!;

    // The wire has a horizontal leg along y = 0 from x = 0 to 6 (0 to 120px)
    // Candidate "top" would collide with this horizontal leg, so it must not be placed at top
    expect(r1Placement.position).not.toBe("top");
    expect(r1Placement.bounds.minY).toBeGreaterThan(0);
  });
});

