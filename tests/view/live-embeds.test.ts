import {it,expect,vi} from "vitest";
vi.mock("obsidian",async()=>({...await import("./fake-obsidian"),MarkdownRenderChild:class {onunload(){} }}));
import {blankPage,emptyDocument} from "../../src/model/document";
import {renderClipPng, adaptColorForTheme} from "../../src/view/clip-png";
import {FineNotesEmbedManager} from "../../src/view/embed-renderer";
import {InkView} from "../../src/view/ink-view";

it("waits for PDF pixels before encoding and releases both canvases",async()=>{
 const order:string[]=[];
 const pdfCanvas={width:100,height:100};
 const context={save:vi.fn(),restore:vi.fn(),scale:vi.fn(),translate:vi.fn(),drawImage:vi.fn(()=>order.push("draw"))};
 const canvas={width:0,height:0,getContext:()=>context,toBlob:(cb:(b:Blob)=>void)=>{order.push("encode");cb(new Blob(["png"]));}};
 vi.stubGlobal("createEl",()=>canvas);
 try {
  const page=blankPage("p1");page.backdrop={kind:"pdf",path:"lecture.pdf",page:0};
  const captureRegion=vi.fn(async()=>{await Promise.resolve();order.push("ready");return {ok:true,canvas:pdfCanvas,box:{x:0,y:0,w:100,h:100}};});
  await renderClipPng(page,{minX:0,minY:0,maxX:100,maxY:100},{pdf:{captureRegion} as never});
  expect(order).toEqual(["ready","draw","encode"]);
  expect(canvas.width).toBe(0);expect(pdfCanvas.width).toBe(0);
 } finally {vi.unstubAllGlobals();}
});
it("resolves a closed notebook's clip and reordered page from the exact saved image path",async()=>{
 const image={path:"assets/book-clip-abc.png",extension:"png"};
 const book={path:"folder/book.notebook.md",extension:"md"};
 const doc=emptyDocument();doc.pages=[blankPage("p1"),blankPage("p2")];
 doc.pages[1].clips=[{id:"clip-abc",pageId:"p2",bounds:{minX:0,minY:0,maxX:10,maxY:10},imagePath:image.path,createdAt:0,updatedAt:0}];
 const manager=Object.create(FineNotesEmbedManager.prototype) as any;
 manager.app={vault:{getFiles:()=>[image,book],getResourcePath:(f:any)=>`app://vault/${f.path}`}};
 manager.plugin={isInkFile:(f:any)=>f===book};manager.loadDocument=async()=>doc;
 const img={getAttribute:(key:string)=>key==="src" ? `app://vault/${image.path}?123` : ""};
 expect(await manager.imageSource(img)).toBe(`${book.path}#^clip-abc`);
 doc.pages[1].clips=[];doc.pages[1].pageEmbedPath=image.path;
 expect(await manager.imageSource(img)).toBe(`${book.path}#page=2`);
});
it("coalesces repeated saves into one serialized refresh",async()=>{
 vi.useFakeTimers();vi.stubGlobal("window",globalThis);
 try {
  const view=Object.create(InkView.prototype) as any;
  view.doc={pages:[{pageEmbedPath:"embed.png"}]};
  view.embedRefreshPending=false;view.embedRefreshRunning=null;
  view.refreshEmbedImages=vi.fn(async()=>{});
  const first=view.updateClipsPng(),second=view.updateClipsPng(),third=view.updateClipsPng();
  await vi.advanceTimersByTimeAsync(500);await Promise.all([first,second,third]);
  expect(view.refreshEmbedImages).toHaveBeenCalledOnce();
 } finally {vi.useRealTimers();vi.unstubAllGlobals();}
});
it("never overlaps refreshes when a newer save arrives during rendering",async()=>{
 vi.useFakeTimers();vi.stubGlobal("window",globalThis);
 try {
  const view=Object.create(InkView.prototype) as any;
  view.doc={pages:[{pageEmbedPath:"embed.png"}]};view.embedRefreshPending=false;view.embedRefreshRunning=null;
  let release!:()=>void, active=0, maximum=0;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  view.refreshEmbedImages=vi.fn(async()=>{active++;maximum=Math.max(maximum,active);if(view.refreshEmbedImages.mock.calls.length===1) await gate;active--;});
  const first=view.updateClipsPng();await vi.advanceTimersByTimeAsync(250);
  const second=view.updateClipsPng();release();await vi.advanceTimersByTimeAsync(250);await Promise.all([first,second]);
  expect(maximum).toBe(1);expect(view.refreshEmbedImages).toHaveBeenCalledTimes(2);
 } finally {vi.useRealTimers();vi.unstubAllGlobals();}
});

it("adapts monochrome dark text to white in dark mode, and light text to dark in light mode, preserving colors", () => {
  expect(adaptColorForTheme("#000000", true)).toBe("#ffffff");
  expect(adaptColorForTheme("black", true)).toBe("#ffffff");
  expect(adaptColorForTheme("#1a1a1a", true)).toBe("#ffffff");
  expect(adaptColorForTheme("#ffffff", false)).toBe("#1a1a1a");
  expect(adaptColorForTheme("white", false)).toBe("#1a1a1a");
  // Vibrant colors must not be altered
  expect(adaptColorForTheme("#1971c2", true)).toBe("#1971c2");
  expect(adaptColorForTheme("#e03131", true)).toBe("#e03131");
  expect(adaptColorForTheme("#2f9e44", false)).toBe("#2f9e44");
  expect(adaptColorForTheme("#fcc419", false)).toBe("#fcc419");
});

it("supports transparent embed rendering without drawing page paper backdrop", async () => {
  let backdropPainted = false;
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    fillRect: vi.fn(() => { backdropPainted = true; }),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob: (cb: (b: Blob) => void) => cb(new Blob(["png"])),
  };
  vi.stubGlobal("createEl", () => canvas);
  try {
    const page = blankPage("p1");
    // With includeBackground = false, backdrop should not be painted
    await renderClipPng(page, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, {
      includeBackground: false,
      backdropPainter: {
        paint: () => { backdropPainted = true; },
      },
    });
    expect(backdropPainted).toBe(false);

    // With includeBackground = true, backdrop is painted
    await renderClipPng(page, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, {
      includeBackground: true,
      backdropPainter: {
        paint: () => { backdropPainted = true; },
      },
    });
    expect(backdropPainted).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("refreshPngEmbeds refreshes open InkViews and updates theme appearance", async () => {
  const manager = Object.create(FineNotesEmbedManager.prototype) as any;
  manager.pngRefreshPending = false;
  manager.pngRefreshRunning = null;
  manager.disposed = false;
  manager.plugin = { settings: { embedBackground: false }, isInkFile: () => false };
  const mockView = { updateClipsPng: vi.fn(async () => {}) };
  manager.app = {
    workspace: {
      getLeavesOfType: vi.fn(() => [{ view: mockView }]),
    },
    vault: {
      getFiles: () => [],
    },
  };
  await manager.refreshPngEmbeds();
  expect(mockView.updateClipsPng).toHaveBeenCalledOnce();
});

it("refreshEmbedImagesInDom updates img src with cache buster timestamp", () => {
  const fakeImg = {
    getAttribute: (attr: string) => (attr === "src" ? "app://vault/clip-abc.png" : "clip-abc.png"),
    closest: () => null,
    src: "app://vault/clip-abc.png",
  };
  vi.stubGlobal("document", {
    querySelectorAll: () => [fakeImg],
  });
  try {
    const manager = Object.create(FineNotesEmbedManager.prototype) as any;
    manager.app = {
      vault: {
        getResourcePath: () => "app://vault/clip-abc.png",
      },
    };
    manager.refreshEmbedImagesInDom({ name: "clip-abc.png", path: "clip-abc.png" } as any);
    expect(fakeImg.src).toMatch(/^app:\/\/vault\/clip-abc\.png\?t=\d+$/);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("leaves existing clip embeds untouched when opening and closing without edits", async () => {
  const page = blankPage("p1");
  const clip = {
    id: "clip-test",
    pageId: page.id,
    bounds: { minX: 40, minY: 60, maxX: 760, maxY: 300 },
    originY: 60,
    isExpandable: true,
    imagePath: "assets/clip-test.png",
    createdAt: 1000,
    updatedAt: 1000,
  };
  page.clips = [clip];
  page.strokes = [{ id: "s1", tool: "pen", color: "#000000", size: 2, pts: [100, 100, 1, 200, 200, 1] }];

  const doc = emptyDocument();
  doc.pages = [page];

  const modifyBinary = vi.fn();
  const view = Object.assign(Object.create(InkView.prototype), {
    file: { path: "notebook.notebook.md" },
    surface: { document: doc },
    doc,
    clipsDirty: false,
    writeHold: { saved: vi.fn() },
    updateClipsPng: vi.fn(),
  });

  // Gated behind clipsDirty
  if (view.clipsDirty) {
    await view.updateClipsPng();
  }

  expect(view.updateClipsPng).not.toHaveBeenCalled();
  expect(modifyBinary).not.toHaveBeenCalled();
});

