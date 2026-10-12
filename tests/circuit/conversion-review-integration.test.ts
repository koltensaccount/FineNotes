import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "../../src/model/commands";
import { emptyDocument, type Stroke } from "../../src/model/document";
import { cloneCircuit } from "../../src/circuit/ir";
import { RECOGNITION_EXAMPLE } from "../../src/circuit/recognition-contract";
import type { CircuitModalOptions } from "../../src/view/circuit-modal";

const state = vi.hoisted(() => ({ options: null as CircuitModalOptions | null, convert: vi.fn() }));
vi.mock("obsidian", () => ({ Modal: class {}, Notice: class {}, Platform: {}, setIcon: vi.fn() }));
vi.mock("../../src/circuit/ai-converter", () => ({ convertSelectionToCircuit: state.convert }));
vi.mock("../../src/view/circuit-modal", () => ({
  CircuitModal: class {
    constructor(_app: unknown, options: CircuitModalOptions) {
      state.options = options;
    }
    open(): void {
      /* Review stays open until the test explicitly commits it. */
    }
  },
}));
const { InkSurface } = await import("../../src/view/ink-surface");

function fixture() {
  const doc = emptyDocument();
  const page = doc.pages[0];
  const stroke: Stroke = {
    id: "ink",
    color: "#000000",
    size: 2,
    tool: "pen",
    pts: [10, 10, 0.5, 20, 20, 0.5],
    t0: 1,
  };
  page.strokes = [stroke];
  const commands: Command[] = [];
  const surface = Object.assign(Object.create(InkSurface.prototype) as object, {
    doc,
    app: {},
    callbacks: { isLocked: vi.fn(() => false), getKeyStore: () => ({ get: () => "test-key" }) },
    groupBounds: () => ({ minX: 10, minY: 10, maxX: 100, maxY: 100 }),
    clearSelection: vi.fn(),
    applyBackgroundCommand: (command: Command) => {
      commands.push(command);
      command.apply(doc);
    },
  });
  const selection = { pageId: page.id, strokes: [stroke], images: [], textBoxes: [], circuits: [] };
  const convert = (
    InkSurface.prototype as unknown as {
      convertSelectionToCircuit: (sel: typeof selection) => Promise<void>;
    }
  ).convertSelectionToCircuit;
  return { surface, doc, page, stroke, commands, start: () => convert.call(surface, selection) };
}

beforeEach(() => {
  state.options = null;
  state.convert.mockReset().mockResolvedValue(cloneCircuit(RECOGNITION_EXAMPLE));
});

describe("Notebook circuit review lifecycle", () => {
  it("keeps ink unchanged until review commits, then Undo restores it", async () => {
    const f = fixture();
    await f.start();
    expect(f.commands).toEqual([]);
    expect(f.page.strokes).toEqual([f.stroke]);
    state.options!.onSave(cloneCircuit(RECOGNITION_EXAMPLE), "tikz", "svg");
    expect(f.commands).toHaveLength(1);
    expect(f.page.strokes).toHaveLength(0);
    expect(f.page.circuits).toHaveLength(1);
    f.commands[0].invert(f.doc);
    expect(f.page.strokes[0]).toBe(f.stroke);
    expect(f.page.circuits).toHaveLength(0);
  });

  it("preserves strokes edited in place during review and adds the circuit alongside", async () => {
    const f = fixture();
    await f.start();
    f.stroke.pts[0] = 500;
    state.options!.onSave(cloneCircuit(RECOGNITION_EXAMPLE), "tikz", "svg");
    expect(f.page.strokes[0]).toBe(f.stroke);
    expect(f.page.strokes[0].pts[0]).toBe(500);
    expect(f.page.circuits).toHaveLength(1);
  });

  it("recognizes a snapshot rather than live ink references", async () => {
    const f = fixture();
    await f.start();
    const input = state.convert.mock.calls[0][0] as { elements: { strokes: Stroke[] } };
    f.stroke.pts[0] = 500;
    expect(input.elements.strokes[0].pts[0]).toBe(10);
  });

  it("does not commit after the notebook changes or becomes locked", async () => {
    const f = fixture();
    await f.start();
    f.surface.callbacks.isLocked.mockReturnValue(true);
    state.options!.onSave(cloneCircuit(RECOGNITION_EXAMPLE), "tikz", "svg");
    expect(f.commands).toEqual([]);
    f.surface.callbacks.isLocked.mockReturnValue(false);
    f.surface.doc = emptyDocument();
    state.options!.onSave(cloneCircuit(RECOGNITION_EXAMPLE), "tikz", "svg");
    expect(f.commands).toEqual([]);
    expect(f.page.strokes[0]).toBe(f.stroke);
  });

  it("does not change ink when recognition fails", async () => {
    const f = fixture();
    state.convert.mockRejectedValue(new Error("Recognition failed"));
    await f.start();
    expect(state.options).toBeNull();
    expect(f.commands).toEqual([]);
    expect(f.page.strokes[0]).toBe(f.stroke);
  });
});
