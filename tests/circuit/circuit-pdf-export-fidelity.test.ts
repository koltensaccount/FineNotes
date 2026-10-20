import { describe, expect, it, vi } from "vitest";
import {
  circuitSvgForDisplay,
  circuitTargetDimensions,
  drawPlacedCircuit,
  parseSvgViewBox,
  prepareCircuits,
  setSvgDimensions,
} from "../../src/circuit/circuit-render";
import {
  KIRCHHOFF_IR_VERSION,
  type KirchhoffCircuit,
  validateAndNormalizeCircuit,
} from "../../src/circuit/ir";
import { renderCircuitToSvg } from "../../src/circuit/svg-render";
import type { CircuitElement } from "../../src/model/document";

describe("Circuit PDF Export Line Fidelity and Dimension Scaling", () => {
  function makeSchematic(): KirchhoffCircuit {
    const raw: KirchhoffCircuit = {
      version: KIRCHHOFF_IR_VERSION,
      gridSize: 20,
      components: {
        r1: {
          id: "r1",
          type: "resistor",
          x: 4,
          y: 2,
          rotation: 0,
          ports: { p1: "n1", p2: "n2" },
          label: "R_1",
          value: "10kΩ",
        },
        r2: {
          id: "r2",
          type: "resistor",
          x: 10,
          y: 4,
          rotation: 90,
          ports: { p1: "n2", p2: "n_gnd" },
          label: "R_L",
          value: "2.2kΩ",
        },
        dep_v: {
          id: "dep_v",
          type: "dependent_vsource",
          x: 4,
          y: 6,
          rotation: 0,
          ports: { pos: "n2", neg: "n_gnd" },
          label: "\\mu V_{in}",
        },
        term_in: {
          id: "term_in",
          type: "node_open",
          x: 1,
          y: 2,
          rotation: 0,
          ports: { p1: "n1" },
          label: "V_{in}",
        },
        gnd: {
          id: "gnd",
          type: "ground",
          x: 4,
          y: 8,
          rotation: 0,
          ports: { gnd: "n_gnd" },
          label: "GND",
        },
      },
      nodes: {
        n1: { id: "n1", x: 1, y: 2 },
        n2: { id: "n2", x: 7, y: 2 },
        n_gnd: { id: "n_gnd", x: 4, y: 8 },
      },
      wires: [
        { id: "w1", fromNode: "n1", toNode: "n2" },
        { id: "w2", fromNode: "n2", toNode: "n_gnd" },
      ],
    };
    return validateAndNormalizeCircuit(raw);
  }

  function makeCircuitElement(w = 400, h = 250): CircuitElement {
    const ir = makeSchematic();
    const svg = renderCircuitToSvg(ir, { theme: "light" });
    return {
      id: "elem_circ_1",
      x: 100,
      y: 150,
      w,
      h,
      rotation: 0,
      ir,
      svg,
    };
  }

  it("extracts viewBox dimensions correctly from circuit SVG", () => {
    const circuit = makeCircuitElement();
    const svg = circuitSvgForDisplay(circuit);
    const vb = parseSvgViewBox(svg);
    expect(vb).not.toBeNull();
    expect(vb!.width).toBeGreaterThan(100);
    expect(vb!.height).toBeGreaterThan(100);
  });

  it("injects explicit target pixel dimensions into root SVG without altering vector viewBox", () => {
    const circuit = makeCircuitElement();
    const svg = circuitSvgForDisplay(circuit);
    const sized = setSvgDimensions(svg, 1200, 800);

    expect(sized).toContain('width="1200"');
    expect(sized).toContain('height="800"');
    expect(sized).toContain('data-finenotes-renderer="2"');

    // ViewBox remains intact for proportionate scaling
    const vb = parseSvgViewBox(sized);
    expect(vb).toEqual(parseSvgViewBox(svg));
  });

  it("calculates accurate high-DPI rasterization dimensions across PDF quality settings", () => {
    const circuit = makeCircuitElement(400, 250);

    // Standard quality (factor = 1.0, scale = 2)
    const stdDims = circuitTargetDimensions(circuit, 2.0);
    expect(stdDims.targetW).toBe(682);
    expect(stdDims.targetH).toBe(500);

    // High quality (factor = 1.25, scale = 2.5)
    const highDims = circuitTargetDimensions(circuit, 2.5);
    expect(highDims.targetW).toBe(853);
    expect(highDims.targetH).toBe(625);

    // Very-high quality (factor = 1.5, scale = 3.0)
    const vhighDims = circuitTargetDimensions(circuit, 3.0);
    expect(vhighDims.targetW).toBe(1023);
    expect(vhighDims.targetH).toBe(750);
  });

  it("calculates proportionate dimensions for portrait and landscape orientations", () => {
    // Landscape page element: wide aspect
    const landscapeCirc = makeCircuitElement(600, 200);
    const lDims = circuitTargetDimensions(landscapeCirc, 2.0);
    expect(lDims.targetW).toBeGreaterThan(lDims.targetH);
    expect(lDims.targetW).toBeLessThanOrEqual(4096);

    // Portrait page element: tall aspect
    const portraitCirc = makeCircuitElement(200, 500);
    const pDims = circuitTargetDimensions(portraitCirc, 2.0);
    expect(pDims.targetW).toBeLessThanOrEqual(4096);
    expect(pDims.targetH).toBeLessThanOrEqual(4096);
  });

  it("resistor zigzag paths have round linecaps matching wire terminal leads", () => {
    const ir = makeSchematic();
    const svg = renderCircuitToSvg(ir, { theme: "light" });

    // Resistors should have stroke-linecap="round" to prevent thinning at endpoints
    const resistorPaths = svg.match(/<path d="[^"]*M -1\.5 0[^"]*"[^>]*>/g);
    expect(resistorPaths).not.toBeNull();
    expect(resistorPaths!.length).toBeGreaterThanOrEqual(2);
    for (const p of resistorPaths!) {
      expect(p).toContain('stroke-linecap="round"');
      expect(p).toContain('stroke-linejoin="round"');
    }
  });

  it("drawPlacedCircuit detects device scale and draws high-DPI image onto canvas context", () => {
    const circuit = makeCircuitElement(400, 250);
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      drawImage: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      setLineDash: vi.fn(),
      getTransform: vi.fn(() => ({ a: 2.5, b: 0, c: 0, d: 2.5, e: 0, f: 0 })),
    } as unknown as CanvasRenderingContext2D;

    // Draw with scale 2.5
    drawPlacedCircuit(ctx, circuit, undefined, 2.5);
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });

  it("prepareCircuits resolves all placed circuits on the page for PDF export", async () => {
    const circuit1 = makeCircuitElement(300, 200);
    const circuit2 = makeCircuitElement(400, 300);
    circuit2.id = "elem_circ_2";

    // Should complete cleanly without throwing
    await expect(prepareCircuits([circuit1, circuit2], 2.0)).resolves.toBeUndefined();
  });

  it("preserves circuit element integrity through serialization and reopen", () => {
    const circuit = makeCircuitElement();
    const serialized = JSON.stringify(circuit);
    const reopened: CircuitElement = JSON.parse(serialized);

    expect(reopened.id).toBe(circuit.id);
    expect(reopened.w).toBe(circuit.w);
    expect(reopened.h).toBe(circuit.h);
    expect(reopened.ir.components.r1.type).toBe("resistor");
    expect(reopened.ir.components.dep_v.type).toBe("dependent_vsource");
    expect(circuitSvgForDisplay(reopened)).toContain('data-finenotes-renderer="2"');
  });
});
