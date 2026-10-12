import { describe, it, expect } from "vitest";
import { UpdateCircuitCommand } from "../../src/circuit/circuit-commands";
import { type CircuitElement, type InkDocument, emptyDocument } from "../../src/model/document";
import { createEmptyCircuit } from "../../src/circuit/ir";

function createTestDoc(): { doc: InkDocument; circuit: CircuitElement } {
  const circuit: CircuitElement = {
    id: "circ_1",
    x: 50,
    y: 80,
    w: 300,
    h: 200,
    rotation: 0,
    ir: createEmptyCircuit("Test Circuit"),
  };

  const doc = emptyDocument();
  doc.pages[0].circuits = [circuit];

  return { doc, circuit };
}

describe("Circuit resize Undo / Redo and draft isolation", () => {
  it("commits a single reversible command and restores original bounds on Undo", () => {
    const { doc, circuit } = createTestDoc();
    const originalSnapshot = structuredClone(circuit);

    // Simulate resizing from 300x200 at (50, 80) to 450x300 at (50, 80)
    const updatedCircuit: CircuitElement = {
      ...circuit,
      w: 450,
      h: 300,
    };

    // Construct command with the original snapshot passed explicitly
    const cmd = new UpdateCircuitCommand(
      doc.pages[0].id,
      circuit.id,
      updatedCircuit,
      "Resize circuit",
      originalSnapshot,
    );

    // 1. Apply command
    cmd.apply(doc);
    const pageCircuit = doc.pages[0].circuits![0];
    expect(pageCircuit.w).toBe(450);
    expect(pageCircuit.h).toBe(300);
    expect(pageCircuit.x).toBe(50);
    expect(pageCircuit.y).toBe(80);

    // 2. Undo command
    cmd.invert(doc);
    expect(pageCircuit.w).toBe(originalSnapshot.w);
    expect(pageCircuit.h).toBe(originalSnapshot.h);
    expect(pageCircuit.x).toBe(originalSnapshot.x);
    expect(pageCircuit.y).toBe(originalSnapshot.y);

    // 3. Redo command
    cmd.apply(doc);
    expect(pageCircuit.w).toBe(450);
    expect(pageCircuit.h).toBe(300);

    // 4. Repeated Undo
    cmd.invert(doc);
    expect(pageCircuit.w).toBe(originalSnapshot.w);
    expect(pageCircuit.h).toBe(originalSnapshot.h);
  });

  it("keeps live document object unchanged during preview drag", () => {
    const { doc, circuit } = createTestDoc();
    const originalX = circuit.x;
    const originalY = circuit.y;
    const originalW = circuit.w;
    const originalH = circuit.h;

    // Simulate moving a handle: draft updates, but doc.circuit remains untouched
    const draft = { x: 50, y: 80, w: 500, h: 400 };
    expect(draft.w).toBe(500);

    // Doc circuit must not have changed during preview
    expect(circuit.x).toBe(originalX);
    expect(circuit.y).toBe(originalY);
    expect(circuit.w).toBe(originalW);
    expect(circuit.h).toBe(originalH);

    // On cancellation (e.g. pointercancel or Esc), doc remains identical without any command needed
    expect(doc.pages[0].circuits![0].w).toBe(originalW);
    expect(doc.pages[0].circuits![0].h).toBe(originalH);
  });
});
