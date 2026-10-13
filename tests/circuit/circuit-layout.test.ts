import { describe, expect, it } from "vitest";
import {
  type KirchhoffCircuit,
  getComponentPortPosition,
} from "../../src/circuit/ir";
import {
  autoLayoutCircuit,
  getComponentBoundingBox,
  isSegmentObstructed,
  routeWireBetweenPoints,
} from "../../src/circuit/layout";

describe("Automatic Circuit Layout Engine", () => {
  it("quantizes and aligns a series RC circuit without altering connectivity", () => {
    const rawRC: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      title: "RC Circuit",
      gridSize: 20,
      nodes: {
        n_in: { id: "n_in", x: 0.12, y: 0.05, junction: false },
        n_mid: { id: "n_mid", x: 3.88, y: 0.1, junction: true },
        n_gnd: { id: "n_gnd", x: 3.95, y: 4.12, junction: false },
      },
      components: {
        r1: {
          id: "r1",
          type: "resistor",
          label: "R1",
          value: "10k",
          x: 2.05,
          y: 0.08,
          rotation: 0,
          ports: { p1: "n_in", p2: "n_mid" },
        },
        c1: {
          id: "c1",
          type: "capacitor",
          label: "C1",
          value: "100n",
          x: 3.92,
          y: 2.1,
          rotation: 90,
          ports: { p1: "n_mid", p2: "n_gnd" },
        },
      },
      wires: [],
    };

    const laidOut = autoLayoutCircuit(rawRC);

    // Resistor y should snap to integer grid
    expect(laidOut.components.r1.y % 1).toBe(0);
    // Capacitor x should snap to integer grid
    expect(laidOut.components.c1.x % 1).toBe(0);

    // Connected nodes should snap to matching integer coordinates
    expect(laidOut.nodes.n_mid.x % 1).toBe(0);
    expect(laidOut.nodes.n_mid.y % 1).toBe(0);

    // Check terminal-to-node snapping: R1's p2 terminal should align with n_mid
    const r1P2 = getComponentPortPosition(laidOut.components.r1, "p2");
    expect(r1P2).toBeDefined();
    if (r1P2) {
      expect(Math.abs(r1P2.y - laidOut.nodes.n_mid.y)).toBeLessThan(0.01);
    }

    // Connectivity must be 100% preserved
    expect(laidOut.components.r1.ports.p1).toBe("n_in");
    expect(laidOut.components.r1.ports.p2).toBe("n_mid");
    expect(laidOut.components.c1.ports.p1).toBe("n_mid");
    expect(laidOut.components.c1.ports.p2).toBe("n_gnd");
  });

  it("organizes a bridge rectifier and filter capacitor cleanly with zero component overlap", () => {
    const bridgeCircuit: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      title: "Bridge Rectifier",
      gridSize: 20,
      nodes: {
        ac1: { id: "ac1", x: 2, y: 4, junction: true },
        ac2: { id: "ac2", x: 6, y: 4, junction: true },
        pos: { id: "pos", x: 4, y: 1, junction: true },
        neg: { id: "neg", x: 4, y: 7, junction: true },
        c_pos: { id: "c_pos", x: 8, y: 1, junction: false },
        c_neg: { id: "c_neg", x: 8, y: 7, junction: false },
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
          ports: { pos: "c_pos", neg: "c_neg" },
        },
      },
      wires: [
        { id: "w1", fromNode: "pos", toNode: "c_pos" },
        { id: "w2", fromNode: "neg", toNode: "c_neg" },
      ],
    };

    const laidOut = autoLayoutCircuit(bridgeCircuit);

    // Verify all components have separation
    const comps = Object.values(laidOut.components);
    for (let i = 0; i < comps.length; i++) {
      for (let j = i + 1; j < comps.length; j++) {
        const b1 = getComponentBoundingBox(comps[i], 0);
        const b2 = getComponentBoundingBox(comps[j], 0);
        const overlaps = !(
          b1.maxX < b2.minX ||
          b1.minX > b2.maxX ||
          b1.maxY < b2.minY ||
          b1.minY > b2.maxY
        );
        expect(overlaps).toBe(false);
      }
    }
  });

  it("routes wires orthogonally with Manhattan L-bends avoiding component collision", () => {
    const rawCircuit: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      title: "Manhattan Routing Test",
      gridSize: 20,
      nodes: {
        n_start: { id: "n_start", x: 0, y: 0, junction: false },
        n_obstacle: { id: "n_obstacle", x: 5, y: 2, junction: false },
        n_end: { id: "n_end", x: 10, y: 6, junction: false },
      },
      components: {
        r_mid: {
          id: "r_mid",
          type: "resistor",
          label: "R_mid",
          x: 10,
          y: 2,
          rotation: 0,
          ports: { p1: "n_obstacle", p2: "n_end" },
        },
      },
      wires: [
        { id: "w_diagonal", fromNode: "n_start", toNode: "n_obstacle" },
      ],
    };

    const laidOut = autoLayoutCircuit(rawCircuit);
    const wire = laidOut.wires.find((w) => w.id === "w_diagonal");
    expect(wire).toBeDefined();
    // Non-collinear endpoints must be routed with an orthogonal waypoint
    expect(wire?.waypoints).toBeDefined();
    expect(wire?.waypoints?.length).toBeGreaterThanOrEqual(1);

    const corner = wire!.waypoints![0];
    const nStart = laidOut.nodes.n_start;
    const nObstacle = laidOut.nodes.n_obstacle;

    // Corner must form 90-degree orthogonal bend with start and obstacle
    const isOrthogonal =
      (Math.abs(corner.x - nStart.x) < 0.01 || Math.abs(corner.y - nStart.y) < 0.01) &&
      (Math.abs(corner.x - nObstacle.x) < 0.01 || Math.abs(corner.y - nObstacle.y) < 0.01);
    expect(isOrthogonal).toBe(true);
  });

  it("preserves or routes bypass wire detours around component bodies without shorting through the symbol", () => {
    const bypassCircuit: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      title: "Bypass Wire Test",
      gridSize: 20,
      nodes: {
        n_in: { id: "n_in", x: 0, y: 0, junction: true },
        n_out: { id: "n_out", x: 6, y: 0, junction: true },
      },
      components: {
        r_bypassed: {
          id: "r_bypassed",
          type: "resistor",
          label: "R_bypassed",
          x: 3,
          y: 0,
          rotation: 0,
          ports: { p1: "n_in", p2: "n_out" },
        },
      },
      wires: [
        {
          id: "w_bypass",
          fromNode: "n_in",
          toNode: "n_out",
          waypoints: [{ x: 0, y: 2 }, { x: 6, y: 2 }],
        },
      ],
    };

    const laidOut = autoLayoutCircuit(bypassCircuit);
    const wire = laidOut.wires.find((w) => w.id === "w_bypass");
    expect(wire).toBeDefined();
    expect(wire?.waypoints).toBeDefined();
    expect(wire!.waypoints!.length).toBeGreaterThanOrEqual(1);
    // Waypoints must detour away from y = 0 where the resistor body is located
    expect(wire!.waypoints!.some((pt) => Math.abs(pt.y) > 0.5)).toBe(true);
  });

  it("preserves existing wire detours around an unrelated electrical net junction", () => {
    const detourCircuit: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      title: "Junction Detour Preservation",
      gridSize: 20,
      nodes: {
        n_start: { id: "n_start", x: 0, y: 0, junction: false },
        n_end: { id: "n_end", x: 10, y: 0, junction: false },
        n_unrelated_junc: { id: "n_unrelated_junc", x: 5, y: 0, junction: true },
        n_other1: { id: "n_other1", x: 5, y: 3, junction: false },
        n_other2: { id: "n_other2", x: 5, y: -3, junction: false },
      },
      components: {
        r_other1: {
          id: "r_other1",
          type: "resistor",
          label: "R_other1",
          x: 5,
          y: 1.5,
          rotation: 90,
          ports: { p1: "n_unrelated_junc", p2: "n_other1" },
        },
        r_other2: {
          id: "r_other2",
          type: "resistor",
          label: "R_other2",
          x: 5,
          y: -1.5,
          rotation: 90,
          ports: { p1: "n_unrelated_junc", p2: "n_other2" },
        },
      },
      wires: [
        {
          id: "w_detoured",
          fromNode: "n_start",
          toNode: "n_end",
          // Existing detour via y=2 around the junction at (5, 0)
          waypoints: [
            { x: 0, y: 2 },
            { x: 10, y: 2 },
          ],
        },
      ],
    };

    const laidOut = autoLayoutCircuit(detourCircuit);
    const wire = laidOut.wires.find((w) => w.id === "w_detoured");
    expect(wire).toBeDefined();
    expect(wire?.waypoints).toBeDefined();
    // Detour must NOT be flattened to straight line across the unrelated junction at (5, 0)
    expect(wire!.waypoints!.length).toBeGreaterThanOrEqual(1);
    expect(wire!.waypoints!.every((pt) => Math.abs(pt.y) > 0.5)).toBe(true);
  });

  it("routes collinear wire around an unrelated junction when no waypoints were initially set", () => {
    const collinearCircuit: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      title: "Collinear Junction Avoidance",
      gridSize: 20,
      nodes: {
        n_start: { id: "n_start", x: 0, y: 0, junction: false },
        n_end: { id: "n_end", x: 10, y: 0, junction: false },
        n_unrelated_junc: { id: "n_unrelated_junc", x: 5, y: 0, junction: true },
      },
      components: {},
      wires: [
        {
          id: "w_straight",
          fromNode: "n_start",
          toNode: "n_end",
          // No initial waypoints
        },
      ],
    };

    const laidOut = autoLayoutCircuit(collinearCircuit);
    const wire = laidOut.wires.find((w) => w.id === "w_straight");
    expect(wire).toBeDefined();
    // Must NOT be a straight line through the unrelated junction at (5, 0)
    expect(wire?.waypoints).toBeDefined();
    expect(wire!.waypoints!.length).toBeGreaterThanOrEqual(2);
    // Waypoints detour away from y = 0
    expect(wire!.waypoints!.every((pt) => Math.abs(pt.y) > 0.5)).toBe(true);
  });

  it("expands detour search beyond small offsets when intermediate channels are obstructed", () => {
    // Unrelated junctions at x=5 covering previously hardcoded offsets: 0, 1.5, -1.5, 2, -2 ... 5, -5
    const blockedOffsets = [1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
    const nodes: Record<string, { id: string; x: number; y: number; junction: boolean }> = {
      n_start: { id: "n_start", x: 0, y: 0, junction: false },
      n_end: { id: "n_end", x: 10, y: 0, junction: false },
      n_junc_0: { id: "n_junc_0", x: 5, y: 0, junction: true },
    };
    for (const offset of blockedOffsets) {
      nodes[`n_pos_${offset}`] = { id: `n_pos_${offset}`, x: 5, y: offset, junction: true };
      nodes[`n_neg_${offset}`] = { id: `n_neg_${offset}`, x: 5, y: -offset, junction: true };
    }

    const circuit: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      gridSize: 20,
      nodes,
      components: {},
      wires: [],
    };

    // Route wire between (0, 0) and (10, 0)
    const waypoints = routeWireBetweenPoints(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      circuit,
      {
        ignoreNodeIds: new Set(["n_start", "n_end"]),
      },
    );

    expect(waypoints.length).toBeGreaterThanOrEqual(2);
    // It must not have fallen back to a line through the junction at (5, 0).
    // Instead, it expanded the search and found an obstacle-free route at |y| >= 5.5
    expect(waypoints.every((pt) => Math.abs(pt.y) >= 5.5)).toBe(true);
  });

  it("routes wires from shared component nodes without false obstacle rejection", () => {
    // Two components sharing n_shared at (5, 0)
    const circuit: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      gridSize: 20,
      nodes: {
        n_shared: { id: "n_shared", x: 5, y: 0, junction: true },
        n_left: { id: "n_left", x: 2, y: 0, junction: false },
        n_top: { id: "n_top", x: 5, y: -3, junction: false },
        n_target: { id: "n_target", x: 10, y: 0, junction: false },
      },
      components: {
        r_horiz: {
          id: "r_horiz",
          type: "resistor",
          label: "R1",
          x: 3.5,
          y: 0,
          rotation: 0,
          ports: { p1: "n_left", p2: "n_shared" },
        },
        r_vert: {
          id: "r_vert",
          type: "resistor",
          label: "R2",
          x: 5,
          y: -1.5,
          rotation: 90,
          ports: { p1: "n_top", p2: "n_shared" },
        },
      },
      wires: [
        // Wire leaving n_shared towards n_target (to the right, away from both resistor bodies)
        { id: "w_out", fromNode: "n_shared", toNode: "n_target" },
      ],
    };

    const laidOut = autoLayoutCircuit(circuit);
    const wire = laidOut.wires.find((w) => w.id === "w_out");
    expect(wire).toBeDefined();

    // The wire from (5,0) to (10,0) points directly away from R1 (at x=3.5) and R2 (at y=-1.5).
    // Both components share n_shared. With endpointCompIds, neither falsely rejects this route.
    // It should be a direct collinear segment with no unnecessary detour waypoints.
    expect(wire?.waypoints).toBeUndefined();
    // Diagnostics should have no UNROUTABLE_OBSTRUCTION
    const unroutable = laidOut.diagnostics?.filter((d) => d.code === "UNROUTABLE_OBSTRUCTION") || [];
    expect(unroutable.length).toBe(0);
  });

  it("routes around obstacles using outward steps when perpendicular departures are blocked", () => {
    // Endpoints at (0, 0) and (10, 0)
    // Horizontal resistors at (0, 1) and (0, -1) block direct vertical departures at x=0
    // Unrelated junction at (5, 0) blocks the straight horizontal line at y=0
    const circuit: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      gridSize: 20,
      nodes: {
        n_start: { id: "n_start", x: 0, y: 0, junction: false },
        n_end: { id: "n_end", x: 10, y: 0, junction: false },
        n_junc: { id: "n_junc", x: 5, y: 0, junction: true },
        // Ports for top resistor
        rt_p1: { id: "rt_p1", x: -1.5, y: 1, junction: false },
        rt_p2: { id: "rt_p2", x: 1.5, y: 1, junction: false },
        // Ports for bottom resistor
        rb_p1: { id: "rb_p1", x: -1.5, y: -1, junction: false },
        rb_p2: { id: "rb_p2", x: 1.5, y: -1, junction: false },
      },
      components: {
        r_top: {
          id: "r_top",
          type: "resistor",
          label: "R_top",
          x: 0,
          y: 1,
          rotation: 0,
          ports: { p1: "rt_p1", p2: "rt_p2" },
        },
        r_bot: {
          id: "r_bot",
          type: "resistor",
          label: "R_bot",
          x: 0,
          y: -1,
          rotation: 0,
          ports: { p1: "rb_p1", p2: "rb_p2" },
        },
      },
      wires: [
        { id: "w_test", fromNode: "n_start", toNode: "n_end" },
      ],
    };

    const laidOut = autoLayoutCircuit(circuit);
    const wire = laidOut.wires.find((w) => w.id === "w_test");
    expect(wire).toBeDefined();
    expect(wire?.waypoints).toBeDefined();
    expect(wire!.waypoints!.length).toBeGreaterThanOrEqual(2);

    // It must NOT route directly across (5, 0)
    // The waypoints must detour away from the obstacles
    expect(wire!.waypoints!.some((pt) => pt.x < 0)).toBe(true);
    expect(wire!.waypoints!.some((pt) => Math.abs(pt.y) >= 2)).toBe(true);

    const unroutable = laidOut.diagnostics?.filter((d) => d.code === "UNROUTABLE_OBSTRUCTION") || [];
    expect(unroutable.length).toBe(0);
  });

  it("preserves coincident terminals of adjacent components without shifting into component bodies", () => {
    // Two series resistors: R1 at x=0 (ports at -1.5 and 1.5) and R2 at x=3 (ports at 1.5 and 4.5)
    // Both connect to node 'b' at x=1.5
    const circuit: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      nodes: {
        a: { id: "a", x: -1.5, y: 0 },
        b: { id: "b", x: 1.5, y: 0 },
        c: { id: "c", x: 4.5, y: 0 },
      },
      components: {
        r1: {
          id: "r1",
          type: "resistor",
          label: "R1",
          x: 0,
          y: 0,
          rotation: 0,
          ports: { p1: "a", p2: "b" },
        },
        r2: {
          id: "r2",
          type: "resistor",
          label: "R2",
          x: 3,
          y: 0,
          rotation: 0,
          ports: { p1: "b", p2: "c" },
        },
      },
      wires: [],
    };

    const laidOut = autoLayoutCircuit(circuit);
    // Node 'b' must remain exactly at x=1.5, y=0 (not rounded to 2 inside R2 body!)
    expect(laidOut.nodes.b.x).toBe(1.5);
    expect(laidOut.nodes.b.y).toBe(0);

    // Diagnostics should be clean
    const unroutable = laidOut.diagnostics?.filter((d) => d.code === "UNROUTABLE_OBSTRUCTION") || [];
    expect(unroutable.length).toBe(0);
  });

  it("prevents distinct electrical nodes in the same rounding cell from snapping together", () => {
    // Two disconnected wires: wire 1 at (0.1, 0) -> (0.1, 5), wire 2 at (0.4, 0) -> (0.4, 5)
    // Rounding each independently would place both start nodes at (0, 0) and both end nodes at (0, 5)
    const circuit: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      nodes: {
        w1_a: { id: "w1_a", x: 0.1, y: 0 },
        w1_b: { id: "w1_b", x: 0.1, y: 5 },
        w2_a: { id: "w2_a", x: 0.4, y: 0 },
        w2_b: { id: "w2_b", x: 0.4, y: 5 },
      },
      components: {},
      wires: [
        { id: "w1", fromNode: "w1_a", toNode: "w1_b" },
        { id: "w2", fromNode: "w2_a", toNode: "w2_b" },
      ],
    };

    const laidOut = autoLayoutCircuit(circuit);
    // w1_a and w2_a must NOT occupy the exact same coordinate
    const distA = Math.hypot(laidOut.nodes.w1_a.x - laidOut.nodes.w2_a.x, laidOut.nodes.w1_a.y - laidOut.nodes.w2_a.y);
    expect(distA).toBeGreaterThanOrEqual(0.5);

    // w1_b and w2_b must NOT occupy the exact same coordinate
    const distB = Math.hypot(laidOut.nodes.w1_b.x - laidOut.nodes.w2_b.x, laidOut.nodes.w1_b.y - laidOut.nodes.w2_b.y);
    expect(distB).toBeGreaterThanOrEqual(0.5);
  });

  it("detects implicit Manhattan wire L-bends as obstacles during wire routing", () => {
    const circuit: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      gridSize: 20,
      nodes: {
        w_from: { id: "w_from", x: 0, y: 0 },
        w_to: { id: "w_to", x: 6, y: 4 },
      },
      components: {},
      // Wire w1 has no explicit waypoints; rendered as (0,0) -> (6,0) -> (6,4)
      wires: [{ id: "w1", fromNode: "w_from", toNode: "w_to" }],
    };

    // Candidate segment overlapping horizontal leg (0,0)-(6,0)
    expect(isSegmentObstructed(1, 0, 5, 0, circuit)).toBe(true);

    // Candidate segment overlapping vertical leg (6,0)-(6,4)
    expect(isSegmentObstructed(6, 1, 6, 3, circuit)).toBe(true);
  });

  it("enforces clearance between components when touching terminals belong to distinct nets", () => {
    // R1 centered at (0, 0): p1 at (-1.5, 0) (net a), p2 at (1.5, 0) (net b)
    // R2 centered at (3, 0): p1 at (1.5, 0) (net a), p2 at (4.5, 0) (net c)
    // Both share node a, but at (1.5, 0) R1 is on net b while R2 is on net a.
    const circuit: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      gridSize: 20,
      nodes: {
        a: { id: "a", x: -1.5, y: 0 },
        b: { id: "b", x: 1.5, y: 0 },
        c: { id: "c", x: 4.5, y: 0 },
      },
      components: {
        r1: {
          id: "r1",
          type: "resistor",
          label: "R1",
          x: 0,
          y: 0,
          rotation: 0,
          ports: { p1: "a", p2: "b" },
        },
        r2: {
          id: "r2",
          type: "resistor",
          label: "R2",
          x: 3,
          y: 0,
          rotation: 0,
          ports: { p1: "a", p2: "c" },
        },
      },
      wires: [],
    };

    const laidOut = autoLayoutCircuit(circuit);

    // R1 and R2 must have been separated so their terminals at x=1.5 do NOT touch
    const p2_r1 = getComponentPortPosition(laidOut.components.r1, "p2")!;
    const p1_r2 = getComponentPortPosition(laidOut.components.r2, "p1")!;
    const dist = Math.hypot(p2_r1.x - p1_r2.x, p2_r1.y - p1_r2.y);
    expect(dist).toBeGreaterThanOrEqual(0.4);
  });
});





describe("Imported wire cleanup", () => {
  const circuit: KirchhoffCircuit = {
    version: "kirchhoff-ir/1.0", gridSize: 20, components: {}, wires: [], nodes: {},
  };
  it("replaces a clear bottom zigzag with a straight wire", () => {
    const options = { simplifyImported: true, existingWaypoints: [{x:0,y:2},{x:8,y:2}] };
    expect(routeWireBetweenPoints({x:0,y:0},{x:8,y:0},circuit,options)).toEqual([]);
    expect(routeWireBetweenPoints({x:0,y:0},{x:8,y:0},circuit,{...options,simplifyImported:false})).toEqual(options.existingWaypoints);
  });
  it("replaces a clear wrapping route with one bend", () => {
    expect(routeWireBetweenPoints({x:0,y:0},{x:8,y:4},circuit,{
      simplifyImported:true, existingWaypoints:[{x:-2,y:0},{x:-2,y:6},{x:8,y:6}],
    })).toEqual([{x:8,y:0}]);
  });
});
