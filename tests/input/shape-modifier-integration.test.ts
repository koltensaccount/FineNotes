import { afterEach, describe, expect, it, vi } from "vitest";
import { PointerController, type PointerControllerCallbacks } from "../../src/input/pointer-controller";
import { StrokeBuilder } from "../../src/ink/stroke-builder";
import { presetGeometry } from "../../src/ink/shape-geometry";
import { History } from "../../src/model/history";
import { emptyDocument } from "../../src/model/document";
import { StrokeIndex } from "../../src/view/stroke-index";
vi.mock("obsidian", () => ({ Notice: class {}, Platform: {}, setIcon: () => {} }));
const { InkSurface } = await import("../../src/view/ink-surface");
class InputElement {
  captured = new Set<number>();
  contains() { return true; }
  ownerDocument?: InputElement;
  listeners = new Map<string, { callback: (event: any) => void; capture: boolean }[]>();
  addEventListener(type: string, callback: (event: any) => void, capture = false) { const list = this.listeners.get(type) ?? []; list.push({ callback, capture }); this.listeners.set(type, list); }
  removeEventListener(type: string, callback: (event: any) => void) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(x => x.callback !== callback)); }
  setPointerCapture(id: number) { this.captured.add(id); }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) { this.captured.delete(id); }
  fire(type: string, id: number, pointerType: string, x = 200, y = 200, size = 1) {
    let stopped = false;
    const event = { type, pointerId: id, pointerType, clientX: x, clientY: y, pressure: .5, tiltX: 0, tiltY: 0, width: size, height: size, timeStamp: performance.now(), target: { closest: () => null }, preventDefault: vi.fn(), stopPropagation: () => { stopped = true; } };
    const entries = [...(this.listeners.get(type) ?? [])].sort((a,b) => Number(b.capture) - Number(a.capture));
    for (const { callback, capture } of entries) { if (!capture && stopped) continue; callback(event); }
    return event;
  }
}
function rig(enabled: boolean, preset?: "rect" | "ellipse" | "line" | "arrow") {
  vi.useFakeTimers(); vi.stubGlobal("window", { setTimeout, clearTimeout, cancelAnimationFrame: vi.fn() });
  const doc = emptyDocument(); doc.pages[0].id = "p1";
  const box = { index: 0, id: "p1", x: 0, y: 0, width: 800, height: 1100 };
  const renderer = { clearWet: vi.fn(), renderWet: vi.fn(), renderWetRuns: vi.fn(), appendCommittedStroke: vi.fn() };
  const surface = Object.assign(Object.create(InkSurface.prototype), {
    doc, renderer, history: new History(), strokeIndex: new StrokeIndex(), toolState: { tool: preset ? "shape" : "pen", shapeMode: preset ?? "auto", shapeSnapEnabled: true, penGestures: { circleLasso: false, scribbleErase: false } },
    callbacks: {}, clock: () => 1000, debug: false, shapeConstrained: false, constraintAngle: undefined, pageLayout: { boxes: [box] },
    activePage: null, snap: null, shapeDrag: null, shapeTap: null, builder: null, lastLift: null, circlePress: null, circleDrag: false, holdAnchor: null, holdTimer: 0, wetFrame: 0, pendingReturn: null, userZoom: 1,
    atFitZoom: (v: number) => v, settlePendingReturn: vi.fn(), dismissUsedSelection: () => false, deselectImage: vi.fn(), clearSelection: vi.fn(), editingTextView: () => null,
    builderOpts: () => ({ minDistance: .1, pressureEnabled: false, smoothing: "off" }), restartHold: (p: any) => { surface.holdAnchor = { ...p, t: performance.now() }; }, trackHold: (p: any) => { surface.holdAnchor = { ...p, t: performance.now() }; }, watchCircleHold: vi.fn(), cancelCircleHold: vi.fn(),
    onPointerEvent: vi.fn(), hudVerdict: vi.fn(), recordDiagnostic: vi.fn(), currentStyle: () => ({ tool: "pen", size: 3, color: "#000000" }), strokeColor: () => "#000000", strokeSize: () => 3, strokeIds: { next: () => "s1" },
    renderDry: vi.fn(), changed: vi.fn(), inkChanged: vi.fn(), noteCircleLoop: vi.fn(), noteOffPage: vi.fn(), scribbleErase: () => false, deferToolUse: vi.fn(), finishTextDismiss: () => false,
  });
  Object.defineProperty(surface, "unitScale", { value: 1 });
  surface.inkGesture = { down: (b: any,p: any,s: any) => surface.inkDown(b,p,s), move: (b: any,s: any) => surface.inkMove(b,s), up: (b: any,s: any) => surface.inkUp(b,s), cancel: (b: any) => surface.inkCancel(b) };
  surface.scheduleWet = () => surface.drawWet();
  surface.setPenGestures({ constrainWithFinger: enabled, circleLasso: false, scribbleErase: false });
  const callbacks = surface.createPointerCallbacks() as PointerControllerCallbacks;
  const pan = vi.fn(), pinch = vi.fn(); callbacks.onPanStart = pan; callbacks.onPinchStart = pinch;
  const element = new InputElement(); element.ownerDocument = new InputElement();
  const input = new PointerController(element as unknown as HTMLElement, (x,y) => ({ x,y }), callbacks);
  surface.pointerInput = input; input.attach();
  surface.modifierDiagnostics = []; surface.hud = { mark: vi.fn() }; surface.scheduleHud = vi.fn();
  const fire = element.fire.bind(element);
  const start = () => { fire("pointerdown",1,"pen",100,100); fire("pointermove",1,"pen",300,150); };
  return { doc, surface, renderer, input, element, fire, pan, pinch, start };
}
const dimensions = (pts: number[]) => ({ w: Math.max(...pts.filter((_,i) => i%3===0)) - Math.min(...pts.filter((_,i) => i%3===0)), h: Math.max(...pts.filter((_,i) => i%3===1)) - Math.min(...pts.filter((_,i) => i%3===1)) });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("controller → real InkSurface modifier integration", () => {
  it.each(["rect", "ellipse"] as const)("setting on changes the visible %s and saves that geometry; off does not", preset => {
    const results: number[][] = [];
    for (const enabled of [false, true]) {
      const r = rig(enabled,preset); r.start(); const original = r.surface.shapeDragGeometry(r.surface.activePage);
      r.fire("pointerdown",2,"touch"); vi.advanceTimersByTime(140);
      const visible = r.renderer.renderWet.mock.calls.at(-1)![1] as number[];
      if (enabled) { expect(r.surface.shapeConstrained).toBe(true); const size = dimensions(visible); expect(size.w).toBeCloseTo(size.h,1); expect(visible).not.toEqual(original); }
      else expect(visible).toEqual(original);
      r.fire("pointerup",1,"pen",300,150); expect(r.doc.pages[0].strokes[0].pts).toEqual(visible); results.push(visible);
      expect(r.pan).not.toHaveBeenCalled(); expect(r.pinch).not.toHaveBeenCalled(); r.input.detach();
    }
    expect(results[0]).not.toEqual(results[1]);
  });
  it("recognizes held freehand, activates snapping, follows Pencil motion, then returns to free geometry on finger release", () => {
    const r = rig(true); r.start(); r.surface.snapHeldStroke(); expect(r.surface.snap.kind).toBe("line");
    r.fire("pointermove",1,"pen",300,170);
    r.fire("pointerdown",2,"touch"); vi.advanceTimersByTime(140); const constrained = r.surface.snap.pts.slice();
    const angle = Math.atan2(constrained[4]-constrained[1],constrained[3]-constrained[0])*180/Math.PI; expect(angle/15).toBeCloseTo(Math.round(angle/15),5);
    r.fire("pointermove",1,"pen",320,190); const changed = r.surface.snap.pts.slice(); expect(changed).not.toEqual(constrained);
    r.fire("pointerup",2,"touch"); expect(r.surface.shapeConstrained).toBe(false); expect(r.surface.snap.pts).not.toEqual(changed);
    expect(r.pan).not.toHaveBeenCalled(); expect(r.pinch).not.toHaveBeenCalled();
  });
  it("retargeted pen/finger capture must not silently disable or discard the modifier", () => {
    const r = rig(true,"rect"); r.start();
    r.fire("lostpointercapture",1,"pen"); // Old child target bubbles loss while the controller still owns capture.
    r.fire("pointerdown",2,"touch"); r.fire("lostpointercapture",2,"touch"); vi.advanceTimersByTime(140);
    expect(r.surface.shapeConstrained).toBe(true);
    const size = dimensions(r.renderer.renderWet.mock.calls.at(-1)![1]); expect(size.w).toBeCloseTo(size.h,1);
  });
  it.each([0, 45, 90])("Pencil-controlled free angles snap near %s° and finger release restores the free angle", degrees => {
    const r = rig(true); r.start(); r.surface.snapHeldStroke();
    const base = r.surface.snap.base, start = r.surface.snap.from;
    const angle = (degrees + 3) * Math.PI / 180;
    const x = base[0] + 200 * Math.cos(angle), y = base[1] + 200 * Math.sin(angle);
    r.fire("pointermove",1,"pen",start.x + x - base[3],start.y + y - base[4]);
    const free = r.surface.snap.pts.slice();
    r.fire("pointerdown",2,"touch"); vi.advanceTimersByTime(140);
    const constrained = r.surface.snap.pts;
    expect(Math.atan2(constrained[4]-constrained[1], constrained[3]-constrained[0])*180/Math.PI).toBeCloseTo(degrees,1);
    r.fire("pointerup",2,"touch"); expect(r.surface.snap.pts).toEqual(free);
  });
  it.each(["palm", "moving", "finger cancel", "Pencil cancel", "capture loss", "setting off", "page/tool change"])("clears or rejects %s without pan/pinch or timer resurrection", scenario => {
    const r = rig(true,"rect"); r.start();
    r.fire("pointerdown",2,"touch",200,200,scenario === "palm" ? 90 : 1);
    if (scenario === "moving") r.fire("pointermove",2,"touch",240,200);
    vi.advanceTimersByTime(140);
    if (scenario === "finger cancel") r.fire("pointercancel",2,"touch");
    if (scenario === "Pencil cancel") r.fire("pointercancel",1,"pen",300,150);
    if (scenario === "capture loss") { r.element.captured.delete(2); r.fire("lostpointercapture",2,"touch"); }
    if (scenario === "setting off") r.surface.setPenGestures({ constrainWithFinger: false });
    if (scenario === "page/tool change") r.surface.cancelShapeDraft();
    expect(r.surface.shapeConstrained).toBe(false); vi.advanceTimersByTime(300); expect(r.surface.shapeConstrained).toBe(false);
    expect(r.pan).not.toHaveBeenCalled(); expect(r.pinch).not.toHaveBeenCalled();
  });
  it("diagnostics distinguish native TouchEvents, controller arrival, setting rejection, activation and geometry application", () => {
    const r = rig(false,"rect"); r.surface.debug = true; r.surface.setPenGestures({ constrainWithFinger: false }); r.start();
    const doc = r.element.ownerDocument!;
    for (const { callback } of doc.listeners.get("touchstart") ?? []) callback({ type: "touchstart", target: {}, changedTouches: [{ identifier: 77, touchType: "direct" }] });
    r.fire("pointerdown",2,"touch");
    let states = r.surface.modifierDiagnostics.map((x: any) => x.state).join("\n");
    expect(states).toContain("document touchstart: direct#77"); expect(states).toContain("finger pointerdown received"); expect(states).toContain("rejected: setting disabled");
    r.surface.setPenGestures({ constrainWithFinger: true }); r.fire("pointerdown",3,"touch"); vi.advanceTimersByTime(140);
    states = r.surface.modifierDiagnostics.map((x: any) => x.state).join("\n");
    expect(states).toContain("setting applied: enabled"); expect(states).toContain("activated"); expect(states).toContain("surface onShapeConstraint(true)"); expect(states).toContain("constraint geometry applied: rect, changed=true");
  });

});
