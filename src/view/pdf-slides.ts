import { loadPdfJs } from "obsidian";
import type { EncodedScan } from "./scan-io";

interface PdfPage {
  getViewport(options: {scale: number}): {width: number; height: number};
  render(options: {canvasContext: CanvasRenderingContext2D; viewport: {width:number;height:number}}): {promise: Promise<void>};
  cleanup(): void;
}
interface PdfDocument {
  getPage(index: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}
interface PdfLibrary { getDocument(options: {data: Uint8Array}): {promise: Promise<PdfDocument>}; }

/** Render sequentially, release each canvas, and never transfer the caller's PDF bytes. */
export async function* renderPdfSlides(bytes: ArrayBuffer, indices: number[], longSide=2400): AsyncGenerator<EncodedScan> {
  const lib = await loadPdfJs() as PdfLibrary;
  const doc = await lib.getDocument({data: new Uint8Array(bytes.slice(0))}).promise;
  try {
    for (const index of indices) {
      const page = await doc.getPage(index+1);
      const canvas = createEl("canvas");
      try {
        const natural = page.getViewport({scale:1});
        const viewport = page.getViewport({scale: longSide / Math.max(natural.width,natural.height)});
        canvas.width=Math.ceil(viewport.width); canvas.height=Math.ceil(viewport.height);
        const context=canvas.getContext("2d");
        if(!context) throw new Error("Canvas unavailable");
        context.fillStyle="#fff"; context.fillRect(0,0,canvas.width,canvas.height);
        await page.render({canvasContext:context,viewport}).promise;
        const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value ? resolve(value) : reject(new Error("Could not render slide")),"image/png"));
        yield {kind:"image",bytes:await blob.arrayBuffer(),mime:"image/png",ext:"png",width:canvas.width,height:canvas.height};
      } finally { canvas.width=0; canvas.height=0; page.cleanup(); }
    }
  } finally { await doc.destroy(); }
}
