/** Interactive tiles only; never imported by export or thumbnail painters. */
import type { Bounds, Page } from "../model/document";
import { guideColor, guidesEligible, type WritingGuideStyle } from "../model/writing-guides";

export function paintWritingGuides(ctx: CanvasRenderingContext2D, page: Page, region: Bounds, style: WritingGuideStyle | null, paper: string, screenScale: number, rasterScale: number): number {
  if (!style || !guidesEligible(page) || !(screenScale > 0) || !(rasterScale > 0)) return 0;
  const { width, height } = page.geometry;
  const left = Math.max(0, region.minX), top = Math.max(0, region.minY), right = Math.min(width, region.maxX), bottom = Math.min(height, region.maxY);
  if (!(right > left) || !(bottom > top)) return 0;
  // At tiny preview resolutions, omit intermediate guides rather than build
  // thousands of indistinguishable marks. Every retained mark stays at a
  // multiple of the original page-space pitch, across all tiles.
  const minPitch = style.style === "dots" ? 8 : 2;
  const stride = 2 ** Math.max(0, Math.ceil(Math.log2(minPitch / (style.spacing * rasterScale))));
  const pitch = style.spacing * stride;
  const weight = style.thickness / screenScale;
  const pad = weight / 2;
  const firstX = Math.max(0, Math.ceil((left - pad) / pitch) * pitch), firstY = Math.max(0, Math.ceil((top - pad) / pitch) * pitch);
  const nx = Math.max(0, Math.floor((Math.min(width, right + pad) - firstX) / pitch) + 1);
  const ny = Math.max(0, Math.floor((Math.min(height, bottom + pad) - firstY) / pitch) + 1);
  // Protect pathological imported page dimensions without changing normal pitch.
  if ((style.style === "dots" ? nx * ny : nx + ny) > 32768) return 0;
  ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
  ctx.globalAlpha = style.opacity; ctx.strokeStyle = ctx.fillStyle = guideColor(style, paper); ctx.lineWidth = weight; ctx.lineCap = "butt";
  ctx.beginPath();
  let count = 0;
  if (style.style === "dots") {
    for (let row = 0; row < ny; row++) for (let col = 0; col < nx; col++) {
      const x = firstX + col * pitch, y = firstY + row * pitch;
      ctx.moveTo(x + pad, y); ctx.arc(x, y, pad, 0, Math.PI * 2); count++;
    }
    ctx.fill();
  } else {
    for (let row = 0; row < ny; row++) { const y = firstY + row * pitch; ctx.moveTo(left, y); ctx.lineTo(right, y); count++; }
    if (style.style === "grid") for (let col = 0; col < nx; col++) { const x = firstX + col * pitch; ctx.moveTo(x, top); ctx.lineTo(x, bottom); count++; }
    // A single stroke avoids alpha accumulation at grid intersections.
    ctx.stroke();
  }
  ctx.restore(); return count;
}
