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
    callbacks: {}, clock: () => 1000, debug: false, constraintAngle: undefined, pageLayout: { boxes: [box] },
    activePage: null, snap: null, shapeDrag: null, shapeTap: null, builder: null, lastLift: null, circlePress: null, circleDrag: false, holdAnchor: null, holdTimer: 0, wetFrame: 0, pendingReturn: null, userZoom: 1,
    atFitZoom: (v: number) => v, settlePendingReturn: vi.fn(), dismissUsedSelection: () => false, deselectImage: vi.fn(), clearSelection: vi.fn(), editingTextView: () => null,
    builderOpts: () => ({ minDistance: .1, pressureEnabled: false, smoothing: "off" }), restartHold: (p: any) => { surface.holdAnchor = { ...p, t: performance.now() }; }, trackHold: (p: any) => { surface.holdAnchor = { ...p, t: performance.now() }; }, watchCircleHold: vi.fn(), cancelCircleHold: vi.fn(),
    onPointerEvent: vi.fn(), hudVerdict: vi.fn(), recordDiagnostic: vi.fn(), currentStyle: () => ({ tool: "pen", size: 3, color: "#000000" }), strokeColor: () => "#000000", strokeSize: () => 3, strokeIds: { next: () => "s1" },
    renderDry: vi.fn(), changed: vi.fn(), inkChanged: vi.fn(), noteCircleLoop: vi.fn(), noteOffPage: vi.fn(), scribbleErase: () => false, deferToolUse: vi.fn(), finishTextDismiss: () => false,
  });
  Object.defineProperty(surface, "unitScale", { value: 1 });
  surface.inkGesture = { down: (b: any,p: any,s: any) => surface.inkDown(b,p,s), move: (b: any,s: any) => surface.inkMove(b,s), up: (b: any,s: any) => surface.inkUp(b,s), cancel: (b: any) => surface.inkCancel(b) };
  surface.scheduleWet = () => surface.drawWet();
  surface.setPenGestures({ circleLasso: false, scribbleErase: false });
  surface.setConstrainShapes(enabled);
  const callbacks = surface.createPointerCallbacks() as PointerControllerCallbacks;
  const pan = vi.fn(), pinch = vi.fn(); callbacks.onPanStart = pan; callbacks.onPinchStart = pinch;
  const element = new InputElement(); element.ownerDocument = new InputElement();
  const input = new PointerController(element as unknown as HTMLElement, (x,y) => ({ x,y }), callbacks);
  surface.pointerInput = input; input.attach();
  surface.hud = { mark: vi.fn() }; surface.scheduleHud = vi.fn();
  const fire = element.fire.bind(element);
  const start = () => { fire("pointerdown",1,"pen",100,100); fire("pointermove",1,"pen",300,150); };
  return { doc, surface, renderer, input, element, fire, pan, pinch, start };
}
const dimensions = (pts: number[]) => ({ w: Math.max(...pts.filter((_,i) => i%3===0)) - Math.min(...pts.filter((_,i) => i%3===0)), h: Math.max(...pts.filter((_,i) => i%3===1)) - Math.min(...pts.filter((_,i) => i%3===1)) });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("preselected shape constraints through real input and rendering", () => {
  it.each(["rect","ellipse","line","arrow"] as const)("Constrain toggle changes %s without a second touch, preserving preview/commit",preset=>{
    const results:number[][]=[];
    for(const enabled of [false,true]) {
      const r=rig(enabled,preset);r.start();
      const visible=r.renderer.renderWet.mock.calls.at(-1)![1] as number[];
      if(enabled && (preset === "rect" || preset === "ellipse")) { const size=dimensions(visible);expect(size.w).toBeCloseTo(size.h,1); }
      if(enabled && (preset === "line" || preset === "arrow")) {const angle=Math.atan2(visible[4]-visible[1],visible[3]-visible[0])*180/Math.PI;expect(angle/15).toBeCloseTo(Math.round(angle/15),4);}
      r.fire("pointerup",1,"pen",300,150);expect(r.doc.pages[0].strokes[0].pts).toEqual(visible);results.push(visible);r.input.detach();
    }
    expect(results[0]).not.toEqual(results[1]);
  });
  it("held freehand line uses preselected constraint and ordinary touches stay rejected",()=>{
    const r=rig(true);r.start();r.surface.snapHeldStroke();
    r.fire("pointermove",1,"pen",300,190);const pts=r.surface.snap.pts;
    expect(Math.atan2(pts[4]-pts[1],pts[3]-pts[0])*180/Math.PI/15).toBeCloseTo(Math.round(Math.atan2(pts[4]-pts[1],pts[3]-pts[0])*180/Math.PI/15),4);
    r.fire("pointerdown",2,"touch");expect(r.pan).not.toHaveBeenCalled();expect(r.pinch).not.toHaveBeenCalled();
  });
});
