import { describe, expect, it } from "vitest";
import { createEmptyCircuit } from "../../src/circuit/ir";
import { isMovableJunction } from "../../src/circuit/wire-geometry";

describe("Movable Junctions", () => {
  it("identifies explicit junctions as movable", () => {
    const c = createEmptyCircuit("Junction Test");
    c.nodes["n_junc"] = { id: "n_junc", x: 4, y: 4, junction: true };
    expect(isMovableJunction(c, "n_junc")).toBe(true);
  });

  it("identifies nodes with 3 or more wire connections as movable junctions", () => {
    const c = createEmptyCircuit("T-Junction Test");
    c.nodes["n_t"] = { id: "n_t", x: 2, y: 2 };
    c.nodes["na"] = { id: "na", x: 0, y: 2 };
    c.nodes["nb"] = { id: "nb", x: 4, y: 2 };
    c.nodes["nc"] = { id: "nc", x: 2, y: 0 };

    c.wires.push(
      { id: "w1", fromNode: "na", toNode: "n_t" },
      { id: "w2", fromNode: "n_t", toNode: "nb" },
      { id: "w3", fromNode: "n_t", toNode: "nc" },
    );

    expect(isMovableJunction(c, "n_t")).toBe(true);
  });

  it("does not treat dedicated 2-pin component terminal nodes as movable junctions", () => {
    const c = createEmptyCircuit("Component Terminal Test");
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
    c.nodes["n_other"] = { id: "n_other", x: 5, y: 0 };

    // 1 wire connects to n2
    c.wires.push({ id: "w1", fromNode: "n2", toNode: "n_other" });

    // n2 is a component terminal with 1 wire, NOT a free movable junction
    expect(isMovableJunction(c, "n2")).toBe(false);
  });
});
