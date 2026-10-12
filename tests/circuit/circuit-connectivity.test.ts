import { describe, expect, it } from "vitest";
import {
  type KirchhoffCircuit,
  validateCircuitConnectivity,
  validateAndNormalizeCircuit,
} from "../../src/circuit/ir";

describe("Circuit Connectivity Validation", () => {
  it("validates a healthy RC circuit without any error diagnostics", () => {
    const rcCircuit: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      title: "RC Low-Pass Filter",
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
      wires: [
        { id: "w1", fromNode: "n_mid", toNode: "n_out" },
      ],
    };

    const diagnostics = validateCircuitConnectivity(rcCircuit);
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("validates a full bridge rectifier with filter capacitor", () => {
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

    const diagnostics = validateCircuitConnectivity(bridgeCircuit);
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("validates a MOSFET amplifier circuit", () => {
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
        gnd: {
          id: "gnd",
          type: "ground",
          label: "GND",
          x: 6,
          y: 8,
          rotation: 0,
          ports: { gnd: "source_node" },
        },
      },
      wires: [
        { id: "w_out", fromNode: "drain_node", toNode: "vout" },
      ],
    };

    const diagnostics = validateCircuitConnectivity(mosfetCircuit);
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("detects dangling wires with invalid or missing node endpoints", () => {
    const brokenCircuit: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      title: "Broken Dangling Wire",
      gridSize: 20,
      nodes: {
        n1: { id: "n1", x: 0, y: 0, junction: false },
      },
      components: {},
      wires: [
        { id: "w1", fromNode: "n1", toNode: "n_missing" },
      ],
    };

    const diagnostics = validateCircuitConnectivity(brokenCircuit);
    expect(diagnostics.some((d) => d.code === "MISSING_NODE" && d.wireId === "w1")).toBe(true);
  });

  it("detects dangling unrouted wires", () => {
    const unroutedCircuit: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      title: "Isolated Wire",
      gridSize: 20,
      nodes: {
        n1: { id: "n1", x: 0, y: 0, junction: false },
        n2: { id: "n2", x: 4, y: 0, junction: false },
      },
      components: {},
      wires: [
        { id: "w1", fromNode: "n1", toNode: "n2" },
      ],
    };

    const diagnostics = validateCircuitConnectivity(unroutedCircuit);
    expect(diagnostics.some((d) => d.code === "DANGLING_WIRE")).toBe(true);
  });

  it("detects disconnected components and missing port references", () => {
    const disconnectedCircuit: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      title: "Disconnected Component",
      gridSize: 20,
      nodes: {
        n1: { id: "n1", x: 0, y: 0, junction: false },
      },
      components: {
        r1: {
          id: "r1",
          type: "resistor",
          label: "R1",
          x: 2,
          y: 0,
          rotation: 0,
          ports: { p1: "n1", p2: "nonexistent_node" },
        },
      },
      wires: [],
    };

    const diagnostics = validateCircuitConnectivity(disconnectedCircuit);
    expect(diagnostics.some((d) => d.code === "MISSING_NODE" && d.componentId === "r1")).toBe(true);
  });

  it("distinguishes intentionally open ports (e.g. opamp power pins when unrouted)", () => {
    const opampCircuit: KirchhoffCircuit = {
      version: "kirchhoff-ir/1.0",
      title: "OpAmp with unrouted power pins",
      gridSize: 20,
      nodes: {
        in_p: { id: "in_p", x: 0, y: 1, junction: false },
        in_m: { id: "in_m", x: 0, y: 3, junction: false },
        out: { id: "out", x: 6, y: 2, junction: false },
      },
      components: {
        u1: {
          id: "u1",
          type: "opamp",
          label: "U1",
          x: 3,
          y: 2,
          rotation: 0,
          // vcc and vee are omitted intentionally
          ports: { in_noninv: "in_p", in_inv: "in_m", out: "out" },
        },
      },
      wires: [],
    };

    const diagnostics = validateCircuitConnectivity(opampCircuit);
    const infoDiagnostics = diagnostics.filter(
      (d) => d.code === "INTENTIONALLY_OPEN_PORT" && (d.portId === "vcc" || d.portId === "vee"),
    );
    expect(infoDiagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it("attaches diagnostics and uncertainties during validateAndNormalizeCircuit", () => {
    const raw = {
      version: "kirchhoff-ir/1.0",
      uncertainties: ["Unclear whether diode D1 is Schottky or standard silicon"],
      nodes: {
        n1: { x: 0, y: 0 },
        n2: { x: 2, y: 0 },
      },
      components: {
        r1: {
          type: "resistor",
          label: "R1",
          value: "1k",
          x: 1,
          y: 0,
          ports: { p1: "n1", p2: "n2" },
        },
      },
      wires: [],
    };

    const normalized = validateAndNormalizeCircuit(raw);
    expect(normalized.uncertainties).toContain(
      "Unclear whether diode D1 is Schottky or standard silicon",
    );
    expect(normalized.diagnostics).toBeDefined();
  });
});
