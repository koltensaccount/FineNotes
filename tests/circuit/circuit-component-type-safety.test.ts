import { describe, expect, it } from "vitest";
import { createEmptyCircuit } from "../../src/circuit/ir";
import { changeComponentType } from "../../src/circuit/component-edit";

describe("Component Type Change Safety & Disconnect", () => {
  it("preserves p1 and p2 terminals when converting 2-pin components (e.g. resistor to capacitor)", () => {
    const c = createEmptyCircuit("Type Safety");
    c.components["r1"] = {
      id: "r1",
      type: "resistor",
      label: "R1",
      value: "10k",
      x: 2,
      y: 2,
      rotation: 0,
      ports: { p1: "n1", p2: "n2" },
    };
    c.nodes["n1"] = { id: "n1", x: 0.5, y: 2 };
    c.nodes["n2"] = { id: "n2", x: 3.5, y: 2 };

    changeComponentType(c, "r1", "capacitor");

    const comp = c.components["r1"];
    expect(comp.type).toBe("capacitor");
    // Terminals p1 and p2 are preserved
    expect(comp.ports.p1).toBe("n1");
    expect(comp.ports.p2).toBe("n2");
  });

  it("safely remaps terminals when converting transistor_nmos to transistor_pmos", () => {
    const c = createEmptyCircuit("MOSFET Type Safety");
    c.components["m1"] = {
      id: "m1",
      type: "transistor_nmos",
      label: "M1",
      x: 4,
      y: 4,
      rotation: 0,
      ports: { gate: "ng", drain: "nd", source: "ns" },
    };
    c.nodes["ng"] = { id: "ng", x: 2.5, y: 4 };
    c.nodes["nd"] = { id: "nd", x: 4, y: 2.5 };
    c.nodes["ns"] = { id: "ns", x: 4, y: 5.5 };

    changeComponentType(c, "m1", "transistor_pmos");

    const comp = c.components["m1"];
    expect(comp.type).toBe("transistor_pmos");
    expect(comp.ports.gate).toBe("ng");
    expect(comp.ports.drain).toBe("nd");
    expect(comp.ports.source).toBe("ns");
  });

  it("preserves terminal port p1 and label when switching between node_filled and node_open", () => {
    const c = createEmptyCircuit("Node Type Conversion");
    c.components["node1"] = {
      id: "node1",
      type: "node_filled",
      label: "V_ref",
      x: 3,
      y: 3,
      rotation: 0,
      ports: { p1: "net_ref" },
    };
    c.nodes["net_ref"] = { id: "net_ref", x: 3, y: 3 };

    changeComponentType(c, "node1", "node_open");

    const comp = c.components["node1"];
    expect(comp.type).toBe("node_open");
    expect(comp.label).toBe("V_ref");
    expect(comp.ports.p1).toBe("net_ref");
  });
});
