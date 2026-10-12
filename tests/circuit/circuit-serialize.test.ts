import { describe, expect, it } from "vitest";
import { emptyDocument } from "../../src/model/document";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import { createEmptyCircuit } from "../../src/circuit/ir";
import { annotationLayers } from "../../src/export/annotation-layers";
import { companionContent } from "../../src/model/companion-pdf";

describe("Circuit Serialization & Integration", () => {
  it("encodes and decodes documents containing circuits without data loss", () => {
    const doc = emptyDocument();
    const page = doc.pages[0];

    const ir = createEmptyCircuit("RC Filter");
    ir.nodes["n1"] = { id: "n1", x: 0, y: 0 };
    ir.components["r1"] = {
      id: "r1",
      type: "resistor",
      label: "R1",
      value: "4.7k",
      x: 2,
      y: 0,
      rotation: 0,
      ports: { p1: "n1" },
    };

    page.circuits = [
      {
        id: "c1",
        x: 50,
        y: 100,
        w: 300,
        h: 200,
        rotation: 0,
        ir,
        tikz: "\\begin{circuitikz}\\end{circuitikz}",
      },
    ];

    const encoded = encodeDocument(doc);
    expect(encoded).toMatch(/^v\d+:/);

    const decoded = decodeDocument(encoded);
    expect(decoded.pages[0].circuits).toHaveLength(1);
    const decodedCircuit = decoded.pages[0].circuits![0];
    expect(decodedCircuit.id).toBe("c1");
    expect(decodedCircuit.x).toBe(50);
    expect(decodedCircuit.y).toBe(100);
    expect(decodedCircuit.w).toBe(300);
    expect(decodedCircuit.h).toBe(200);
    expect(decodedCircuit.ir.title).toBe("RC Filter");
    expect(decodedCircuit.ir.components["r1"].value).toBe("4.7k");
    expect(decodedCircuit.tikz).toBe("\\begin{circuitikz}\\end{circuitikz}");
  });

  it("clears circuits from stroke layers in annotationLayers to avoid duplication", () => {
    const doc = emptyDocument();
    const page = doc.pages[0];
    page.circuits = [
      {
        id: "c1",
        x: 10,
        y: 10,
        w: 100,
        h: 100,
        ir: createEmptyCircuit(),
      },
    ];
    page.strokes = [
      { id: "s1", color: "#000", size: 2, tool: "pen", pts: [0, 0, 0.5] },
      { id: "s2", color: "#ff0", size: 10, tool: "highlighter", pts: [10, 10, 0.5] },
    ];

    const layers = Array.from(annotationLayers(page));
    // First layer: non-stroke elements (images/textBoxes/circuits)
    expect(layers[0].multiply).toBe(false);
    expect(layers[0].page.circuits).toHaveLength(1);
    expect(layers[0].page.strokes).toHaveLength(0);

    // Subsequent stroke layers: circuits must be cleared!
    for (let i = 1; i < layers.length; i++) {
      expect(layers[i].page.circuits).toHaveLength(0);
      expect(layers[i].page.strokes.length).toBeGreaterThan(0);
    }
  });

  it("includes circuits in companionContent so companion PDF sync is triggered", () => {
    const doc = emptyDocument();
    const page = doc.pages[0];
    page.circuits = [
      {
        id: "c1",
        x: 10,
        y: 10,
        w: 100,
        h: 100,
        ir: createEmptyCircuit("Sync Test"),
      },
    ];

    const content = companionContent(doc, { highlighterAlpha: 0.5, usePressure: true }, null);
    expect(content).toContain('"Sync Test"');
    expect(content).toContain('"circuits"');
  });
});
