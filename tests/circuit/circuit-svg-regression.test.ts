import { describe, expect, it } from "vitest";
import { validateAndNormalizeCircuit, KIRCHHOFF_IR_VERSION, type KirchhoffCircuit } from "../../src/circuit/ir";
import { renderCircuitToSvg } from "../../src/circuit/svg-render";

describe("Circuit SVG rendering regressions", () => {
  it("renders a bridge rectifier circuit with correctly scaled symbol strokes and accurate junctions", () => {
    const rawBridgeCircuit: KirchhoffCircuit = {
      version: KIRCHHOFF_IR_VERSION,
      gridSize: 20,
      components: {
        vs: {
          id: "vs",
          type: "vsource",
          x: 2,
          y: 6,
          rotation: 0,
          ports: { p: "n_ac1", n: "n_ac2" },
          label: "12V AC",
        },
        d1: {
          id: "d1",
          type: "diode",
          x: 6,
          y: 4,
          rotation: 0,
          ports: { a: "n_ac1", k: "n_dc_pos" },
          label: "D1",
        },
        d2: {
          id: "d2",
          type: "diode",
          x: 6,
          y: 8,
          rotation: 0,
          ports: { a: "n_ac2", k: "n_dc_pos" },
          label: "D2",
        },
        d3: {
          id: "d3",
          type: "diode",
          x: 10,
          y: 4,
          rotation: 180,
          ports: { a: "n_dc_neg", k: "n_ac1" },
          label: "D3",
        },
        d4: {
          id: "d4",
          type: "diode",
          x: 10,
          y: 8,
          rotation: 180,
          ports: { a: "n_dc_neg", k: "n_ac2" },
          label: "D4",
        },
        c_filt: {
          id: "c_filt",
          type: "polarized_capacitor",
          x: 14,
          y: 6,
          rotation: 90,
          ports: { p: "n_dc_pos", n: "n_dc_neg" },
          label: "C1",
          value: "100uF",
        },
        r_load: {
          id: "r_load",
          type: "resistor",
          x: 18,
          y: 6,
          rotation: 90,
          ports: { a: "n_dc_pos", b: "n_dc_neg" },
          label: "RL",
          value: "1k",
        },
        gnd: {
          id: "gnd",
          type: "ground",
          x: 14,
          y: 10,
          rotation: 0,
          ports: { gnd: "n_dc_neg" },
          label: "GND",
        },
      },
      nodes: {
        n_ac1: { id: "n_ac1", x: 4, y: 4 },
        n_ac2: { id: "n_ac2", x: 4, y: 8 },
        n_dc_pos: { id: "n_dc_pos", x: 14, y: 2 },
        n_dc_neg: { id: "n_dc_neg", x: 14, y: 10 },
      },
      wires: [
        { id: "w1", fromNode: "n_ac1", toNode: "n_ac2" },
        { id: "w2", fromNode: "n_dc_pos", toNode: "n_dc_neg" },
      ],
    };

    const circuit = validateAndNormalizeCircuit(rawBridgeCircuit);
    expect(circuit).toBeDefined();

    // Verify junction classification:
    // n_dc_pos connects D1, D2, C_filt, R_load, plus wire -> degree >= 3
    expect(circuit.nodes.n_dc_pos.junction).toBe(true);
    // n_dc_neg connects D3, D4, C_filt, R_load, GND, plus wire -> degree >= 3
    expect(circuit.nodes.n_dc_neg.junction).toBe(true);

    const svg = renderCircuitToSvg(circuit, { theme: "light" });

    // Verify SVG structure
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");

    // Check stroke widths inside scaled component groups
    // Under scale(20), symbol strokes should be (1.8 / 20) = 0.09, NOT 1.8 (which would scale to 36px)
    expect(svg).toContain('stroke-width="0.09"');
    // Ensure symbols do NOT contain unscaled stroke-width="1.8" inside their scale(20) groups
    // The only unscaled strokes should be wires/frames in world space (stroke-width="2")
    const symbolGroupMatches = svg.match(/<g transform="[^"]*scale\(20\)[^"]*">[\s\S]*?<\/g>/g);
    expect(symbolGroupMatches).not.toBeNull();
    for (const group of symbolGroupMatches!) {
      expect(group).not.toContain('stroke-width="1.8"');
      expect(group).not.toContain('stroke-width="36"');
    }

    // Verify junction dots count:
    // Only nodes where junction === true should have junction dots (<circle ... r="3.5" ...>)
    const junctionCircles = svg.match(/<circle cx="[^"]+" cy="[^"]+" r="3\.5"/g) || [];
    const trueJunctionNodes = Object.values(circuit.nodes).filter((n) => n.junction === true);
    expect(junctionCircles.length).toBe(trueJunctionNodes.length);

    // Verify no obsolete diagonal port-lead lines are rendered
    expect(svg).not.toMatch(/<!-- lead wire -->/);
  });

  it("renders an RC circuit with orthogonal Manhattan wire routing and no stroke inflation", () => {
    const rcCircuit: KirchhoffCircuit = {
      version: KIRCHHOFF_IR_VERSION,
      gridSize: 20,
      components: {
        v1: {
          id: "v1",
          type: "vsource_dc",
          x: 2,
          y: 5,
          rotation: 0,
          ports: { p: "n1", n: "n0" },
          label: "Vin",
          value: "5V",
        },
        r1: {
          id: "r1",
          type: "resistor",
          x: 6,
          y: 2,
          rotation: 0,
          ports: { a: "n1", b: "n2" },
          label: "R1",
          value: "10k",
        },
        c1: {
          id: "c1",
          type: "capacitor",
          x: 10,
          y: 5,
          rotation: 90,
          ports: { a: "n2", b: "n0" },
          label: "C1",
          value: "1uF",
        },
        gnd: {
          id: "gnd",
          type: "ground",
          x: 6,
          y: 8,
          rotation: 0,
          ports: { gnd: "n0" },
          label: "GND",
        },
      },
      nodes: {
        n1: { id: "n1", x: 2, y: 2 },
        n2: { id: "n2", x: 10, y: 2 },
        n0: { id: "n0", x: 6, y: 8 },
      },
      wires: [
        // Wire between (2, 2) and (10, 8) with no waypoints — diagonal endpoints must be routed orthogonally
        { id: "w_diag", fromNode: "n1", toNode: "n0" },
      ],
    };

    const circuit = validateAndNormalizeCircuit(rcCircuit);
    expect(circuit).toBeDefined();

    const svg = renderCircuitToSvg(circuit);

    // Check Manhattan routing for diagonal wire between (40, 40) and (120, 160)
    // Should route M 40 40 L 120 40 L 120 160
    expect(svg).toContain("M 40 40 L 120 40 L 120 160");

    // Check capacitor plates stroke is scaled (0.11 instead of 2.2)
    expect(svg).toContain('stroke-width="0.11"');
    // Check resistor zigzag stroke is scaled (0.09 instead of 1.8)
    expect(svg).toContain('stroke-width="0.09"');
  });
});
