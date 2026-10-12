import { describe, expect, it } from "vitest";
import { validateAndNormalizeCircuit, KIRCHHOFF_IR_VERSION, type KirchhoffCircuit } from "../../src/circuit/ir";
import { renderCircuitToSvg, computeCircuitBounds } from "../../src/circuit/svg-render";
import { routeAllTerminalLeads } from "../../src/circuit/layout";

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

  it("routes terminal leads of separated components sharing a node around intervening components", () => {
    // Horizontal resistors centered at x=0 and x=12 sharing the first resistor's right port (at x=1, y=0)
    // and the second's left port (at x=11, y=0). An intervening resistor is centered at x=5, y=0.
    const separatedLeadCircuit: KirchhoffCircuit = {
      version: KIRCHHOFF_IR_VERSION,
      gridSize: 20,
      components: {
        r1: {
          id: "r1",
          type: "resistor",
          x: 0,
          y: 0,
          rotation: 0,
          ports: { p1: "n_in", p2: "n_shared" },
          label: "R1",
        },
        r_mid: {
          id: "r_mid",
          type: "resistor",
          x: 5,
          y: 0,
          rotation: 0,
          ports: { p1: "n_mid1", p2: "n_mid2" },
          label: "R_mid",
        },
        r2: {
          id: "r2",
          type: "resistor",
          x: 12,
          y: 0,
          rotation: 0,
          ports: { p1: "n_shared", p2: "n_out" },
          label: "R2",
        },
      },
      nodes: {
        n_in: { id: "n_in", x: -1.5, y: 0 },
        // n_shared is located at R1's right port (x=1.5, y=0)
        n_shared: { id: "n_shared", x: 1.5, y: 0 },
        n_mid1: { id: "n_mid1", x: 3.5, y: 0 },
        n_mid2: { id: "n_mid2", x: 6.5, y: 0 },
        n_out: { id: "n_out", x: 13.5, y: 0 },
      },
      wires: [],
    };

    const circuit = validateAndNormalizeCircuit(separatedLeadCircuit);
    const svg = renderCircuitToSvg(circuit);

    // R2's left port is at x=10.5*20=210, y=0. n_shared is at x=1.5*20=30, y=0.
    // The straight segment from (210, 0) to (30, 0) penetrates R_mid (centered at x=100, y=0).
    // The rendered lead must NOT contain a straight line directly across y=0 through R_mid!
    expect(svg).not.toContain("M 210 0 L 30 0");
    // It should have routed with an orthogonal detour away from y = 0 around R_mid
    expect(svg).toMatch(/M 210 0 L 210 -?[1-9]\d* L 30 -?[1-9]\d* L 30 0/);
  });

  it("includes routed terminal lead detours in SVG bounds to prevent clipping with zero padding", () => {
    // Unlabeled resistor at (0,0), nodes at (-4,0)/(4,0), wire between them.
    // Leads from component ports to nodes detour around the resistor body.
    const c: KirchhoffCircuit = {
      version: KIRCHHOFF_IR_VERSION,
      gridSize: 20,
      nodes: {
        a: { id: "a", x: -4, y: 0 },
        b: { id: "b", x: 4, y: 0 },
      },
      components: {
        r: {
          id: "r",
          type: "resistor",
          label: "R",
          x: 0,
          y: 0,
          rotation: 0,
          ports: { p1: "a", p2: "b" },
        },
      },
      wires: [{ id: "w", fromNode: "a", toNode: "b" }],
    };

    const bounds = computeCircuitBounds(c);
    // maxY must be at least 1.5 to accommodate the terminal lead detour
    expect(bounds.maxY).toBeGreaterThanOrEqual(1.5);

    const svg = renderCircuitToSvg(c, { padding: 0 });
    // viewBox must fully encompass y=30 (1.5 * 20) with zero padding
    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
    expect(viewBoxMatch).not.toBeNull();
    const [, minYStr, , heightStr] = viewBoxMatch![1].split(" ").map(Number);
    expect(minYStr + heightStr).toBeGreaterThanOrEqual(30);
  });

  it("does not mutate circuit diagnostics during SVG rendering or bounds computation", () => {
    const circuit: KirchhoffCircuit = {
      version: KIRCHHOFF_IR_VERSION,
      gridSize: 20,
      diagnostics: [],
      nodes: {
        a: { id: "a", x: 0, y: 0 },
        b: { id: "b", x: 10, y: 0 },
      },
      components: {
        r: {
          id: "r",
          type: "resistor",
          label: "R",
          x: 5,
          y: 0,
          rotation: 0,
          ports: { p1: "a", p2: "b" },
        },
      },
      wires: [],
    };

    // Render multiple times (as would happen on canvas paint or preview refreshes)
    computeCircuitBounds(circuit);
    renderCircuitToSvg(circuit);
    computeCircuitBounds(circuit);
    renderCircuitToSvg(circuit);

    // Diagnostics array must NOT have been mutated or accumulated warnings
    expect(circuit.diagnostics).toEqual([]);
  });

  it("routes terminal leads for different nets through non-overlapping channels when detouring around obstacles", () => {
    const circuit: KirchhoffCircuit = {
      version: KIRCHHOFF_IR_VERSION,
      gridSize: 20,
      nodes: {
        na: { id: "na", x: -1.5, y: 0 },
        nb: { id: "nb", x: 1.5, y: 0 },
      },
      components: {
        r1: {
          id: "r1",
          type: "resistor",
          label: "R1",
          x: 0,
          y: 0,
          rotation: 0,
          ports: { p1: "na", p2: "nb" },
        },
        r2: {
          id: "r2",
          type: "resistor",
          label: "R2",
          x: 6,
          y: 0,
          rotation: 0,
          ports: { p1: "na", p2: "nb" },
        },
      },
      wires: [],
    };

    const leads = routeAllTerminalLeads(circuit);
    expect(leads.length).toBeGreaterThan(0);

    // Verify in SVG that distinct net leads do not share overlapping paths
    const svg = renderCircuitToSvg(circuit);
    expect(svg).toContain("<svg");

    // Check that lead paths for na and nb do not have overlapping horizontal segments
    const leadSegments: Array<{ netId: string; x1: number; y1: number; x2: number; y2: number }> = [];
    for (const lead of leads) {
      for (let i = 0; i < lead.points.length - 1; i++) {
        const p1 = lead.points[i];
        const p2 = lead.points[i + 1];
        leadSegments.push({
          netId: lead.nodeId,
          x1: Math.min(p1.x, p2.x),
          y1: Math.min(p1.y, p2.y),
          x2: Math.max(p1.x, p2.x),
          y2: Math.max(p1.y, p2.y),
        });
      }
    }

    // Between distinct nets na and nb, horizontal segments with the same Y must not overlap in X range
    for (const s1 of leadSegments) {
      for (const s2 of leadSegments) {
        if (s1.netId !== s2.netId) {
          if (Math.abs(s1.y1 - s1.y2) < 0.001 && Math.abs(s2.y1 - s2.y2) < 0.001 && Math.abs(s1.y1 - s2.y1) < 0.001) {
            const overlap = Math.max(0, Math.min(s1.x2, s2.x2) - Math.max(s1.x1, s2.x1));
            expect(overlap).toBeLessThan(0.01);
          }
        }
      }
    }
  });
});

