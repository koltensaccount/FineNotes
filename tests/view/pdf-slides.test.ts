import {it,expect,vi} from "vitest";
const {loadPdfJs}=vi.hoisted(()=>({loadPdfJs:vi.fn()}));
vi.mock("obsidian",()=>({loadPdfJs}));
import {renderPdfSlides} from "../../src/view/pdf-slides";
it("renders selected pages in order and releases PDF/canvas resources on cancellation",async()=>{
  const cleanup=vi.fn(),destroy=vi.fn(),getPage=vi.fn(async()=>({
    getViewport:({scale}:{scale:number})=>({width:1600*scale,height:900*scale}),
    render:()=>({promise:Promise.resolve()}),cleanup,
  }));
  const getDocument=vi.fn((_options:{data:Uint8Array})=>({promise:Promise.resolve({getPage,destroy})}));
  loadPdfJs.mockResolvedValue({getDocument});
  const canvases:Array<{width:number;height:number}>=[];
  vi.stubGlobal("createEl",()=>{
    const canvas={width:0,height:0,getContext:()=>({fillStyle:"",fillRect:vi.fn()}),toBlob:(cb:(b:Blob)=>void)=>cb(new Blob(["png"]))};
    canvases.push(canvas);return canvas;
  });
  try {
    const bytes=new ArrayBuffer(8), generator=renderPdfSlides(bytes,[2,0]);
    const first=await generator.next();
    expect(first.value?.width).toBe(2400); expect(first.value?.height).toBe(1350);
    expect(getPage).toHaveBeenCalledWith(3);
    expect(getDocument.mock.calls[0]![0].data.buffer).not.toBe(bytes);
    await generator.return(undefined);
    expect(canvases[0].width).toBe(0); expect(canvases[0].height).toBe(0);
    expect(cleanup).toHaveBeenCalledOnce(); expect(destroy).toHaveBeenCalledOnce();
  } finally {vi.unstubAllGlobals();}
});
