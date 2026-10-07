import { writingPopoverFit } from "../../src/view/writing-popover-fit";
import { describe, expect, it, vi } from "vitest";
import {
  createStrokePreview,
  strokePreviewGeometry,
  effectivePreviewWidth,
  highlighterSwatch,
} from "../../src/view/stroke-preview";
import { renderThicknessEditor } from "../../src/view/thickness-editor";
import { DEFAULT_HIGHLIGHTER_ALPHA, HIGHLIGHTER_COLORS } from "../../src/constants";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { Toolbar, PEN_TYPES } = await import("../../src/view/toolbar");
class El {
  children: El[] = [];
  attrs: Record<string, string> = {};
  classes = new Set<string>();
  text = "";
  value = "";
  min = "";
  max = "";
  step = "";
  handlers = new Map<string, () => void>();
  style: Record<string, string> = {};
  ownerDocument = { createElementNS: (_ns: string, tag: string) => new El(tag) };
  constructor(readonly tag = "div") {}
  createEl(
    tag: string,
    o: { cls?: string; text?: string; attr?: Record<string, string>; type?: string } = {},
  ) {
    const e = new El(tag);
    e.text = o.text ?? "";
    e.attrs = { ...o.attr };
    e.classes = new Set(o.cls?.split(" ") ?? []);
    e.ownerDocument = this.ownerDocument;
    this.children.push(e);
    return e;
  }
  createDiv(o = {}) {
    return this.createEl("div", o);
  }
  createSpan(o = {}) {
    return this.createEl("span", o);
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  setText(s: string) {
    this.text = s;
  }
  setCssStyles(s: Record<string, string>) {
    Object.assign(this.style, s);
  }
  empty() {
    this.children = [];
  }
  append(...e: El[]) {
    this.children.push(...e);
  }
  replaceChildren(...e: El[]) {
    this.children = e;
  }
  addClass(...c: string[]) {
    c.forEach((v) => this.classes.add(v));
  }
  toggleClass(c: string, on: boolean) {
    if (on) this.classes.add(c);
    else this.classes.delete(c);
  }
  querySelector() {
    return null;
  }
  addEventListener(n: string, f: () => void) {
    this.handlers.set(n, f);
  }
  cloneNode() {
    const copy = new El(this.tag);
    copy.attrs = {...this.attrs};
    return copy;
  }
  click() {
    this.handlers.get("click")?.();
  }
  all(): El[] {
    return [this, ...this.children.flatMap((e) => e.all())];
  }
  find(label: string): El {
    const e = this.all().find((v) => v.attrs["aria-label"] === label);
    if (!e) throw new Error(label);
    return e;
  }
}
const doc = new El().ownerDocument as unknown as Document;
describe("reusable writing previews", () => {
  it("four silhouettes have distinct geometry without depending on their colors", () => {
    const samples = PEN_TYPES.map((p) =>
      strokePreviewGeometry({ type: p.id, width: 3, pressure: true }),
    );
    expect(new Set(samples.map((s) => (s.expressive ? s.ribbon : s.path))).size).toBe(3);
    expect(effectivePreviewWidth("highlighter", 3)).toBe(12);
    expect(effectivePreviewWidth("ball", 3)).toBe(3);
    expect(effectivePreviewWidth("brush", 3)).toBeCloseTo(5.4);
  });
  it("Ball is uniform, Fountain tapered and Brush has a distinct expressive ribbon", () => {
    const ball = strokePreviewGeometry({ type: "ball", width: 3 }),
      fountain = strokePreviewGeometry({ type: "fountain", width: 3 }),
      brush = strokePreviewGeometry({ type: "brush", width: 3 });
    expect(ball.expressive).toBe(false);
    expect(fountain.expressive).toBe(true);
    expect(brush.ribbon).not.toBe(fountain.ribbon);
    expect(strokePreviewGeometry({ type: "brush", width: 3, pressure: false }).expressive).toBe(
      false,
    );
  });
  it.each(["dashed", "dotted"] as const)(
    "%s uses one continuous round-capped SVG pattern",
    (lineStyle) => {
      const svg = createStrokePreview(
        { type: "ball", width: 3, color: "#123456", lineStyle },
        doc,
      ) as unknown as El;
      expect(svg.attrs["data-preview-style"]).toBe(lineStyle);
      expect(svg.children[0].attrs["stroke-dasharray"]).toBeDefined();
      expect(svg.children[0].attrs["stroke-linecap"]).toBe("round");
      expect(svg.children[0].attrs.stroke).toBe("#123456");
    },
  );
  it("highlighter preserves multiply/opacity appearance and ignores Pen line patterns", () => {
    const svg = createStrokePreview(
      {
        type: "highlighter",
        width: 8,
        color: HIGHLIGHTER_COLORS[0],
        highlighterAlpha: 0.4,
        lineStyle: "dotted",
        paper: "#ffffff",
      },
      doc,
    ) as unknown as El;
    expect(svg.attrs["data-preview-style"]).toBe("solid");
    expect(svg.attrs["data-highlighter-alpha"]).toBe("0.4");
    expect(svg.children.at(-1)!.attrs.stroke).toBe(highlighterSwatch(HIGHLIGHTER_COLORS[0], 0.4));
    expect(svg.children[0].attrs["stroke-dasharray"]).toBeUndefined();
  });
  it.each(["#ffffff", "#fbf8ed", "#fdf6d8", "#1c1d21"])(
    "samples every default highlighter on %s with the actual blend equation",
    (paper) => {
      for (const color of HIGHLIGHTER_COLORS) {
        const result = highlighterSwatch(color, DEFAULT_HIGHLIGHTER_ALPHA, paper);
        for (const i of [1, 3, 5]) {
          const p = parseInt(paper.slice(i, i + 2), 16),
            ink = parseInt(color.slice(i, i + 2), 16);
          expect(parseInt(result.slice(i, i + 2), 16)).toBe(
            Math.round(p * (0.6 + (0.4 * ink) / 255)),
          );
        }
      }
    },
  );
  it("previews are bounded at extreme widths and retain real mm labels", () => {
    for (const width of [0.98, 2, 12, 100]) {
      const g = strokePreviewGeometry({ type: "highlighter", width, compact: true });
      expect(g.width).toBeLessThanOrEqual(g.h - 12);
    }
    const svg = createStrokePreview({ type: "highlighter", width: 8 }, doc) as unknown as El;
    expect(svg.attrs["aria-label"]).toContain("6.6 mm");
  });
});
describe("pen choice state", () => {
  it.each(PEN_TYPES)(
    "${label} has a preview and selecting it updates type and pressure",
    (spec) => {
      const body = new El(),
        state = {
          tool: "pen",
          penType: "fountain",
          pressureEnabled: false,
          color: "#000",
          size: 3,
        };
      const chosen = vi.fn(),
        toolbar = Object.assign(Object.create(Toolbar.prototype) as object, {
          host: new El(),
          options: {},
          state,
          callbacks: {
            onToolChange: vi.fn(),
            onPressureToggle: vi.fn(),
            onPenTypeChange: chosen,
            pressureAllowed: () => true,
          },
          buildOptions: vi.fn(),
          syncActive: vi.fn(),
        }) as unknown as { renderPenTypes(body: HTMLElement, back: () => void): void };
      toolbar.renderPenTypes(body as unknown as HTMLElement, vi.fn());
      const option = body.find(spec.label);
      expect(option.children[0].attrs["data-preview-tool"]).toBe(spec.id);
      option.click();
      expect(state.penType).toBe(spec.id);
      expect(state.tool).toBe(spec.tool);
      expect(state.pressureEnabled).toBe(spec.pressure);
      expect(chosen).toHaveBeenCalledWith(spec);
    },
  );
});
describe("visual thickness editor", () => {
  it("slider/preset/color changes refresh the same live component without duplicate controls", () => {
    const body = new El();
    let current = { type: "ball" as const, width: 2, color: "#123456" };
    let widths = [2, 3, 5];
    const select = vi.fn((width: number) => {
      current = { ...current, width };
    });
    const refresh = renderThicknessEditor(body as unknown as HTMLElement, {
      current: () => current,
      presets: () => widths,
      stops: [2, 3, 5],
      select,
      reset: () => select(3),
      manage: {
        save: (width, replacing) => {
          widths = [...new Set([...widths.filter((w) => w !== replacing), width])].sort(
            (a, b) => a - b,
          );
        },
        remove: (width) => {
          widths = widths.filter((w) => w !== width);
        },
        restore: () => {
          widths = [2, 3, 5];
        },
      },
    });
    const range = body.find("Stroke thickness");
    range.value = "2";
    range.handlers.get("input")?.();
    expect(select).toHaveBeenCalledWith(5);
    expect(body.find("1.0 mm thickness").attrs["aria-pressed"]).toBe("true");
    body.find("0.62 mm thickness").click();
    expect(current.width).toBe(3);
    current = { ...current, color: "#ff0000" };
    refresh();
    const hero = body.children.find((e) => e.classes.has("goodobsidian-live-stroke"))!;
    expect(hero.children[0].children[0].attrs.stroke).toBe("#ff0000");
    for (let i = 0; i < 4; i++) refresh();
    expect(body.all().filter((e) => e.tag === "input")).toHaveLength(1);
    expect(body.all().filter((e) => e.classes.has("goodobsidian-live-stroke"))).toHaveLength(1);
    expect(range.attrs["aria-valuetext"]).toBe("0.62 mm thickness");
  });
});

describe("writing popover bounds", () => {
  it.each([1440, 1024, 820, 360])("bounds writing controls in a %s px pane", (width) => {
    const fit = writingPopoverFit({ top: 0, bottom: 800, width }, { top: 74, bottom: 118 });
    expect(fit.maxWidth).toBe(width - 16);
    expect(fit.top + fit.maxHeight).toBeLessThanOrEqual(800);
  });
  it("uses upper space near the bottom and stays inside a short split pane", () => {
    const fit = writingPopoverFit({ top: 20, bottom: 500, width: 360 }, { top: 360, bottom: 404 });
    expect(fit.above).toBe(true);
    expect(fit.top - fit.maxHeight).toBeGreaterThanOrEqual(0);
    expect(fit.maxWidth).toBe(344);
  });
});

describe("shape-following preview contrast", () => {
  it.each(["#000000", "#ffffff", "#111111", "#fefefe", "#ff0000", "#0000ff", "#ffff00"])("keeps %s unchanged without a backing rectangle", color => {
    for (const background of ["rgb(255, 255, 255)", "rgb(28, 29, 33)"]) {
      const localDoc = {...new El().ownerDocument, body: {}, defaultView: {getComputedStyle: () => ({backgroundColor: background})}} as unknown as Document;
      const svg = createStrokePreview({type: "ball", width: 3, color, paper: "#ffffff"}, localDoc) as unknown as El;
      expect(svg.children.some(el => el.tag === "rect")).toBe(false);
      expect(svg.children.at(-1)!.attrs.stroke).toBe(color);
    }
  });
  it.each(["solid", "dashed", "dotted"] as const)("low-contrast %s halo preserves geometry and dash intervals", lineStyle => {
    const svg = createStrokePreview({type: "ball", width: 3, color: "#ffffff", lineStyle}, doc) as unknown as El;
    expect(svg.children).toHaveLength(2);
    const [halo, ink] = svg.children;
    expect(halo.attrs.d).toBe(ink.attrs.d);
    expect(halo.attrs["stroke-dasharray"]).toBe(ink.attrs["stroke-dasharray"]);
    expect(Number(halo.attrs["stroke-width"])).toBeGreaterThan(Number(ink.attrs["stroke-width"]));
    expect(ink.attrs.stroke).toBe("#ffffff");
  });
  it("high-contrast ink renders only its normal stroke", () => {
    const svg = createStrokePreview({type: "ball", width: 3, color: "#000000"}, doc) as unknown as El;
    expect(svg.children).toHaveLength(1);
  });
});

it("selected width tap edits the exact stable slot; unselected tap selects and Save targets that slot", () => {
  const body = new El();
  let selected = "second",
    editing: string | undefined;
  const edit = vi.fn((id: string) => {
    editing = id;
  });
  const selectSlot = vi.fn((id: string) => {
    selected = id;
  });
  const save = vi.fn();
  renderThicknessEditor(body as unknown as HTMLElement, {
    current: () => ({ type: "ball", width: 3 }),
    presets: () => [2, 3, 5, 8, 12, 3],
    stops: [2, 3, 5],
    slotIds: () => ["first", "second", "third", "fourth", "fifth", "sixth"],
    selectedSlot: () => selected,
    editing: () => editing,
    edit,
    selectSlot,
    select: vi.fn(),
    reset: vi.fn(),
    manage: { save, remove: vi.fn(), restore: vi.fn() },
  });
  body.find("0.41 mm thickness").click();
  expect(selectSlot).toHaveBeenCalledWith("first");
  body.find("0.41 mm thickness").click();
  expect(edit).toHaveBeenCalledWith("first");
  body.find("Save current width").click();
  expect(save).toHaveBeenCalledWith(3, "first");
  expect(body.all().filter((el) => el.classes.has("goodobsidian-thickness-choice"))).toHaveLength(
    6,
  );
});
