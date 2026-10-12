import { describe, expect, it } from "vitest";
import { type CircuitElement, type Stroke, emptyDocument } from "../../src/model/document";
import {
  AddCircuitCommand,
  ReplaceStrokesWithCircuitCommand,
  UpdateCircuitCommand,
} from "../../src/circuit/circuit-commands";
import { createEmptyCircuit } from "../../src/circuit/ir";

function sampleStroke(id: string): Stroke {
  return {
    id,
    color: "#000000",
    size: 2,
    tool: "pen",
    pts: [10, 10, 0.5, 20, 20, 0.5],
    t0: 1234,
  };
}

function sampleCircuit(id: string): CircuitElement {
  return {
    id,
    x: 10,
    y: 10,
    w: 100,
    h: 80,
    ir: createEmptyCircuit("Test"),
  };
}

describe("Circuit Commands", () => {
  it("ReplaceStrokesWithCircuitCommand replaces strokes and fully restores on invert (undo)", () => {
    const doc = emptyDocument();
    const page = doc.pages[0];
    const s1 = sampleStroke("s1");
    const s2 = sampleStroke("s2");
    const s3 = sampleStroke("s3");
    page.strokes = [s1, s2, s3];

    const circuit = sampleCircuit("c1");
    const cmd = new ReplaceStrokesWithCircuitCommand(page.id, [s1, s3], circuit);

    // Apply
    cmd.apply(doc);
    expect(page.strokes).toHaveLength(1);
    expect(page.strokes[0]).toBe(s2);
    expect(page.circuits).toHaveLength(1);
    expect(page.circuits![0]).toBe(circuit);

    // Invert (Undo)
    cmd.invert(doc);
    expect(page.strokes).toHaveLength(3);
    expect(page.strokes[0]).toBe(s1);
    expect(page.strokes[1]).toBe(s2);
    expect(page.strokes[2]).toBe(s3);
    // Identity, t0 and points strictly preserved
    expect(page.strokes[0].id).toBe("s1");
    expect(page.strokes[0].t0).toBe(1234);
    expect(page.strokes[2].id).toBe("s3");
    expect(page.circuits).toHaveLength(0);

    // Redo
    cmd.apply(doc);
    expect(page.strokes).toHaveLength(1);
    expect(page.circuits).toHaveLength(1);
  });

  it("UpdateCircuitCommand preserves previous snapshot on undo", () => {
    const doc = emptyDocument();
    const page = doc.pages[0];
    const initial = sampleCircuit("c1");
    page.circuits = [initial];

    const next: CircuitElement = {
      ...initial,
      w: 200,
      h: 150,
      tikz: "\\begin{circuitikz}...\\end{circuitikz}",
    };

    const cmd = new UpdateCircuitCommand(page.id, "c1", next);
    cmd.apply(doc);
    expect(page.circuits[0].w).toBe(200);
    expect(page.circuits[0].h).toBe(150);
    expect(page.circuits[0].tikz).toBe(next.tikz);

    // Undo
    cmd.invert(doc);
    expect(page.circuits[0].w).toBe(100);
    expect(page.circuits[0].h).toBe(80);
    expect(page.circuits[0].tikz).toBeUndefined();
  });

  it("AddCircuitCommand adds and removes cleanly", () => {
    const doc = emptyDocument();
    const page = doc.pages[0];
    const circuit = sampleCircuit("c1");

    const cmd = new AddCircuitCommand(page.id, circuit);
    cmd.apply(doc);
    expect(page.circuits).toHaveLength(1);
    expect(page.circuits![0].id).toBe("c1");

    cmd.invert(doc);
    expect(page.circuits).toHaveLength(0);
  });
});
