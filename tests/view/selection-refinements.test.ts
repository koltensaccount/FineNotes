import { describe, expect, it, vi, afterEach } from "vitest";
import { History } from "../../src/model/history";
import { StrokeIndex } from "../../src/view/stroke-index";
import { blankPage } from "../../src/model/document";
import { polygonOf } from "../../src/canvas/lasso";
import { shapeFrame } from "../../src/ink/shape-edit";
import { presetGeometry } from "../../src/ink/shape-geometry";
import { PasteGate } from "../../src/view/clipboard-read";
vi.mock("obsidian", () => ({ Notice: class {}, Platform: {}, setIcon: vi.fn() }));
const { InkSurface } = await import("../../src/view/ink-surface");
type State = Record<string, unknown>;
function call<T = unknown>(s: State, name: string, ...args: unknown[]): T {
  return (s[name] as (...a: unknown[]) => T).apply(s, args);
}
function fixture() {
  const page = blankPage("p");
  page.geometry = { width: 800, height: 1000 };
  const doc = { pages: [page], schema: 3 },
    history = new History(),
    strokeIndex = new StrokeIndex();
  let seq = 0;
  const s: State = Object.assign(Object.create(InkSurface.prototype), {
    doc,
    history,
    strokeIndex,
    palette: ["#000"],
    selection: null,
    pdfRegion: null,
    pdfRegionCandidate: null,
    imageSel: null,
    toolState: { tool: "pen", lassoMode: "rect" },
    callbacks: {},
    renderer: null,
    groupDrag: null,
    selectedShapeFrame: null,
    imagesShown: true,
    clearSelection() {
      this.selection = null;
      this.pdfRegion = null;
      this.pdfRegionCandidate = null;
    },
    deselectImage() {
      this.imageSel = null;
    },
    cancelImageDrag: vi.fn(),
    endCrop: vi.fn(),
    editingTextView: () => null,
    syncSelectionOverlay: vi.fn(),
    syncImageOverlay: vi.fn(),
    syncActionBar: vi.fn(),
    renderDry: vi.fn(),
    syncTextBoxes: vi.fn(),
    changed: vi.fn(),
    boxForPage: () => ({ index: 0, width: 800, height: 1000 }),
    pageAt: () => page,
    textBoxFrameOf: (_id: string, box: unknown) => box,
    freshIds: () => ({
      stroke: () => `s${++seq}`,
      image: () => `i${++seq}`,
      textBox: () => `t${++seq}`,
    }),
    setTool(tool: string) {
      (this.toolState as { tool: string }).tool = tool;
    },
    cancelPendingReturn: vi.fn(),
  });
  return { s, page, doc, history, strokeIndex };
}
afterEach(() => vi.unstubAllGlobals());
describe("selection refinements integration", () => {
  it.each(["ink", "shape", "arrow", "text", "mixed"])(
    "selects only the duplicated %s with fresh identities in one undo step",
    (kind) => {
      const { s, page, doc, history } = fixture();
      const stroke = {
        id: "original",
        tool: "pen" as const,
        color: "#123",
        size: 2,
        pts: [50, 50, 0.5, 150, 100, 0.5],
        ...(kind === "shape"
          ? { shape: "rect" as const }
          : kind === "arrow"
            ? { shape: "arrow" as const }
            : {}),
      };
      const text = { id: "original-text", x: 50, y: 50, w: 100, h: 100, text: "abc", fontSize: 16 };
      if (kind !== "text") page.strokes.push(stroke);
      if (kind === "text" || kind === "mixed") page.textBoxes.push(text as never);
      const original = {
        pageId: page.id,
        strokes: [...page.strokes],
        images: [],
        textBoxes: [...page.textBoxes],
      };
      s.selection = original;
      s.groupBounds = () => ({ minX: 50, minY: 50, maxX: 150, maxY: 150 });
      call(s, "duplicateSelection");
      const selected = s.selection as typeof original;
      expect(selected).not.toBe(original);
      expect((s.toolState as { tool: string }).tool).toBe("select");
      for (const copy of selected.strokes) {
        expect(copy).not.toBe(stroke);
        expect(copy.id).not.toBe(stroke.id);
        expect(copy.color).toBe(stroke.color);
        expect(copy.pts[0]).toBeGreaterThan(stroke.pts[0]);
      }
      for (const copy of selected.textBoxes) expect(copy).not.toBe(text);
      expect(s.syncSelectionOverlay).toHaveBeenCalled();
      const n = page.strokes.length + page.textBoxes.length;
      history.undo(doc as never);
      expect(page.strokes.length + page.textBoxes.length).toBe(n / 2);
      history.redo(doc as never);
      expect(page.strokes.at(-1)).toBe(selected.strokes.at(-1));
      expect(page.textBoxes.at(-1)).toBe(selected.textBoxes.at(-1));
      expect(stroke.pts).toEqual([50, 50, 0.5, 150, 100, 0.5]);
    },
  );
  it("selects a duplicate image after the insertion command clears prior selection", () => {
    const { s, page, doc, history } = fixture();
    const image = { id: "i1", path: "picture.png", x: 50, y: 50, w: 100, h: 100 };
    page.images.push(image);
    s.imageSel = { pageId: page.id, image };
    s.applyCommand = (command: { apply: (doc: unknown) => void }) => {
      s.imageSel = null;
      history.push(doc as never, command as never);
    };
    expect(call(s, "duplicateSelectedImage")).toBe(true);
    const copy = (s.imageSel as { image: typeof image }).image;
    expect(copy).not.toBe(image);
    expect(copy).toBe(page.images[1]);
    expect(s.syncImageOverlay).toHaveBeenCalled();
    history.undo(doc as never);
    expect(page.images).toEqual([image]);
    history.redo(doc as never);
    expect(page.images[1]).toBe(copy);
  });
  it("applies overlap only to enabled types and preserves ordinary default selection", () => {
    const { s, page, strokeIndex } = fixture();
    const shape = {
      id: "s1",
      tool: "pen" as const,
      color: "#000",
      size: 1,
      shape: "rect" as const,
      pts: presetGeometry("rect", { x: 50, y: 50 }, { x: 150, y: 150 }, 0.5),
    };
    page.strokes.push(shape);
    strokeIndex.rebuild([page]);
    const poly = polygonOf([148, 48, 152, 48, 152, 52, 148, 52])!;
    call(s, "selectInside", { index: 0 }, poly);
    expect(s.selection).toBeNull();
    (s.toolState as Record<string, unknown>).lassoBehavior = "overlap";
    call(s, "selectInside", { index: 0 }, poly);
    expect((s.selection as { strokes: unknown[] }).strokes).toEqual([shape]);
    (s.toolState as Record<string, unknown>).lassoFilter = { shapes: false };
    call(s, "selectInside", { index: 0 }, poly);
    expect(s.selection).toBeNull();
  });
  it.each([true, false])(
    "retains PDF region and pastes once through the gate; marker available=%s",
    async (markerAvailable) => {
      const { s, page } = fixture();
      page.backdrop = { kind: "pdf", path: "source.pdf", page: 0 };
      const file = new File(["PNG"], "region.png", { type: "image/png" }),
        onPasteImage = vi.fn(),
        onCopyPdfClipboard = vi.fn();
      s.callbacks = {
        onCopyPdfRegion: vi.fn().mockResolvedValue(file),
        onCopyPdfClipboard,
        onPasteImage,
      };
      const poly = polygonOf([10, 20, 110, 20, 110, 70, 10, 70])!;
      call(s, "selectInside", { index: 0 }, poly);
      expect(s.pdfRegion).toEqual({ pageId: page.id, polygon: poly, rectangular: true });
      expect(call(s, "copySelection")).toBe(true);
      expect(onCopyPdfClipboard).toHaveBeenCalledOnce();
      const marker = onCopyPdfClipboard.mock.calls[0][1];
      const gate = new PasteGate();
      s.pasteGate = gate;
      const request = {
        ticket: gate.begin(),
        target: { pageId: page.id, at: { x: 200, y: 300 } },
        completed: 0,
      };
      call(s, "consumePaste", request, { file, text: markerAvailable ? marker : "" });
      call(s, "consumePaste", request, { file, text: marker });
      await Promise.resolve();
      expect(onPasteImage).toHaveBeenCalledExactlyOnceWith(file, request.target);
      expect(page.images).toHaveLength(0);
      expect(page.backdrop.path).toBe("source.pdf");
    },
  );
  it("numeric height commits measured geometry and stays stable after undo/redo", () => {
    const { s, page, doc, history, strokeIndex } = fixture();
    const stroke = {
      id: "s1",
      tool: "pen" as const,
      color: "#000",
      size: 3,
      shape: "ellipse" as const,
      pts: presetGeometry("ellipse", { x: 50, y: 50 }, { x: 150, y: 350 }, 0.5),
    };
    page.strokes.push(stroke);
    s.selection = { pageId: page.id, strokes: [stroke], images: [], textBoxes: [] };
    strokeIndex.rebuild([page]);
    s.imagesShown = false;
    s.pasteAction = () => ({ id: "paste", label: "Paste", icon: "paste", group: "edit" });
    const actions = call<{ id: string; fields?: { apply: (v: Record<string, number>) => void } }[]>(
      s,
      "groupActions",
      s.selection,
    );
    actions.find((a) => a.id === "shape-values")!.fields!.apply({ w: 100, h: 400, size: 3 });
    expect(shapeFrame("ellipse", stroke.pts)!.h).toBeCloseTo(400, 1);
    expect(shapeFrame("ellipse", stroke.pts)!.w).toBeCloseTo(100, 1);
    expect(stroke.size).toBe(3);
    expect(call(s, "frameForShape", stroke)).toEqual(call(s, "frameForShape", stroke));
    expect(s.syncSelectionOverlay).toHaveBeenCalled();
    history.undo(doc as never);
    expect(shapeFrame("ellipse", stroke.pts)!.h).toBeCloseTo(300, 1);
    history.redo(doc as never);
    expect(shapeFrame("ellipse", stroke.pts)!.h).toBeCloseTo(400, 1);
  });
  it("copies drawing selection with rendered PNG and marker, and internal paste restores native editable strokes", async () => {
    const { s, page } = fixture();
    const stroke = {
      id: "orig-stroke",
      tool: "pen" as const,
      color: "#ff0055",
      size: 3,
      pts: [100, 100, 0.5, 200, 200, 0.5],
    };
    page.strokes.push(stroke);
    const selection = {
      pageId: page.id,
      strokes: [stroke],
      images: [],
      textBoxes: [],
    };
    s.selection = selection;
    s.groupBounds = () => ({ minX: 100, minY: 100, maxX: 200, maxY: 200 });
    s.pageLayout = { boxes: [{ index: 0, id: page.id }] };
    s.visibleRegion = () => ({ minX: 0, minY: 0, maxX: 800, maxY: 1000 });
    s.dropSelection = vi.fn();
    s.select = vi.fn((pageId, elements) => {
      s.selection = { pageId, ...elements };
    });

    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(ctx),
      toBlob: vi.fn((cb: (blob: Blob) => void, mime: string) => {
        cb(new Blob(["png"], { type: mime }));
      }),
    };
    vi.stubGlobal("document", {
      createElement: (tag: string) => (tag === "canvas" ? canvas : {}),
    });
    class FakePath2D {
      moveTo() {}
      lineTo() {}
      closePath() {}
    }
    vi.stubGlobal("Path2D", FakePath2D);

    const onCopySelection = vi.fn();
    s.callbacks = { onCopySelection };

    expect(call(s, "copySelection")).toBe(true);
    expect(onCopySelection).toHaveBeenCalledOnce();
    const [pngPromise, marker] = onCopySelection.mock.calls[0];
    expect(marker).toMatch(/^FineNotes selection:/);
    expect(pngPromise).toBeInstanceOf(Promise);
    const pngBlob = await pngPromise;
    expect(pngBlob.type).toBe("image/png");

    const gate = new PasteGate();
    s.pasteGate = gate;
    const request = {
      ticket: gate.begin(),
      target: { pageId: page.id },
      completed: 0,
    };
    const pasted = call(s, "consumePaste", request, { file: null, text: marker });
    expect(pasted).toBe(true);
    expect(page.strokes).toHaveLength(2);
    const copy = page.strokes[1];
    expect(copy.id).not.toBe(stroke.id);
    expect(copy.color).toBe(stroke.color);
    expect(copy.size).toBe(stroke.size);
    expect(s.select).toHaveBeenCalledWith(page.id, expect.objectContaining({ strokes: [copy] }));
  });
});

describe("cross-page selection drag integration", () => {
  function dragFixture() {
    const f=fixture(),target=blankPage("target");target.geometry={width:800,height:1000};f.doc.pages.push(target);
    const boxes=[{id:f.page.id,index:0,x:0,y:0,width:800,height:1000},{id:target.id,index:1,x:0,y:1036,width:800,height:1000}];
    const stroke={id:"s",tool:"pen" as const,color:"#123",size:3,pts:[50,50,.5,100,100,.5]};f.page.strokes.push(stroke);
    const text={id:"t",x:50,y:50,w:100,h:50,text:"editable",fontSize:16,color:"#000"};f.page.textBoxes.push(text);
    const selection={pageId:f.page.id,strokes:[stroke],images:[],textBoxes:[text]};f.s.selection=selection;
    const root={setCssStyles:vi.fn()};
    Object.assign(f.s,{pageLayout:{boxes},boxForPage:(id:string)=>boxes.find(b=>b.id===id),baseScale:1,userZoom:1,textBoxInputs:new Map([[`${f.page.id}:${text.id}`,{root}]]),
      selectionFrameEl:{removeEventListener:vi.fn(),hasPointerCapture:()=>false},
      renderer:{setHiddenStrokes:vi.fn(),setHiddenImages:vi.fn(),invalidateRegion:vi.fn(),clearWet:vi.fn(),renderSelectionDraft:vi.fn(),renderImageDraft:vi.fn()},
    });
    const drag={pointerId:7,selection,bounds:{minX:50,minY:50,maxX:150,maxY:150},from:{x:50,y:50},clientX:50,clientY:50,dx:0,dy:0,lifted:false,targetPageId:undefined as string|undefined};f.s.groupDrag=drag;
    return {...f,target,boxes,stroke,text,drag,root};
  }
  it.each([true,false])("previews on the destination without mutation, commits/cancels once; commit=%s", commit=>{
    const f=dragFixture(),initial=JSON.stringify(f.doc);
    call(f.s,"moveGroupDrag",f.drag,f.boxes[0],{x:125,y:1150});
    expect(f.drag.targetPageId).toBe(f.target.id);expect(JSON.stringify(f.doc)).toBe(initial);
    const renderer=f.s.renderer as {renderSelectionDraft:ReturnType<typeof vi.fn>};
    expect(renderer.renderSelectionDraft).toHaveBeenLastCalledWith(1,[f.stroke],[],75,64,undefined);
    expect(f.root.setCssStyles).toHaveBeenLastCalledWith({left:"125px",top:"1150px"});
    expect(call(f.s,"dragShift",f.page.id,f.text)).toEqual({x:75,y:1100});
    call(f.s,"endGroupDrag",commit);
    if(commit) {
      expect(f.page.strokes).toHaveLength(0);expect(f.target.strokes[0]).toBe(f.stroke);
      expect((f.s.selection as {pageId:string}).pageId).toBe(f.target.id);
      expect(f.stroke.pts).toEqual([125,114,.5,175,164,.5]);
      const moved=JSON.stringify(f.doc);f.history.undo(f.doc as never);expect(JSON.stringify(f.doc)).toBe(initial);f.history.redo(f.doc as never);expect(JSON.stringify(f.doc)).toBe(moved);
    } else expect(JSON.stringify(f.doc)).toBe(initial);
  });
  it("keeps the last destination through a gutter and permits returning to the source",()=>{
    const f=dragFixture();call(f.s,"moveGroupDrag",f.drag,f.boxes[0],{x:125,y:1150});
    expect(call(f.s,"dragTargetBox",f.boxes[0],{x:125,y:1020},f.target.id)).toBe(f.boxes[1]);
    call(f.s,"moveGroupDrag",f.drag,f.boxes[0],{x:125,y:150});expect(f.drag.targetPageId).toBe(f.page.id);
  });
  it("moves a lone placed image between pages with editable identity and one-step undo",()=>{
    const f=dragFixture();f.s.groupDrag=null;
    const image={id:"i",path:"picture.png",x:50,y:50,w:100,h:100,rotation:.2};f.page.images.push(image);f.s.imageSel={pageId:f.page.id,image};
    const drag={pointerId:9,part:"body",pageId:f.page.id,image,start:{x:50,y:50,w:100,h:100,rotation:.2},draft:{x:50,y:50,w:100,h:100,rotation:.2},from:{x:75,y:75},grab:{x:0,y:0},clientX:75,clientY:75,lifted:true};
    f.s.imageDrag=drag;f.s.imageFrameEl={removeEventListener:vi.fn(),hasPointerCapture:()=>false};f.s.imageUiEl={removeClass:vi.fn()};
    const initial=JSON.stringify(f.doc);call(f.s,"moveImageBody",drag,f.boxes[0],{x:125,y:1150});call(f.s,"renderImageDraft");
    expect((f.s.renderer as {renderImageDraft:ReturnType<typeof vi.fn>}).renderImageDraft.mock.calls[0][0]).toBe(1);
    call(f.s,"endImageDrag",true);expect(f.target.images[0]).toBe(image);expect(f.page.images).toHaveLength(0);expect((f.s.imageSel as {pageId:string}).pageId).toBe(f.target.id);expect(image.rotation).toBe(.2);
    f.history.undo(f.doc as never);expect(JSON.stringify(f.doc)).toBe(initial);f.history.redo(f.doc as never);expect(f.target.images[0]).toBe(image);
  });
  it("edge scrolling runs only during body movement and stops at the content boundary",()=>{
    const f=dragFixture();let x=0,y=0;
    f.s.scrollEl={getBoundingClientRect:()=>({left:0,right:800,top:0,bottom:600})};f.s.direction="vertical";
    f.s.scroller={get position(){return {x,y}},scrollBy:(_dx:number,dy:number)=>{y=Math.min(100,y+dy)}};
    f.s.selectionDragPointer={x:100,y:590};f.drag.lifted=true;
    expect(call(f.s,"stepSelectionDragScroll",100)).toBe(true);expect(y).toBeGreaterThan(0);
    f.s.selectionDragPointer={x:100,y:300};expect(call(f.s,"stepSelectionDragScroll",116)).toBe(false);
    y=100;f.s.selectionDragPointer={x:100,y:590};expect(call(f.s,"stepSelectionDragScroll",132)).toBe(false);
    f.drag.lifted=false;expect(call(f.s,"stepSelectionDragScroll",148)).toBe(false);
  });
});
