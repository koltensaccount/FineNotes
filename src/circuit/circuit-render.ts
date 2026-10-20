/**
 * Canvas rendering and bitmap caching for CircuitElement instances.
 *
 * Provides high-performance vector-to-bitmap rasterization and caching,
 * ensuring zero-latency page rendering and tile generation on iPadOS.
 */

import type { Bounds, CircuitElement } from "../model/document";
import { renderCircuitToSvg } from "./svg-render";
import type { KirchhoffCircuit } from "./ir";
import { imageBounds, rotationOf } from "../canvas/image-geometry";

interface CachedCircuitBitmap {
  svg: string;
  image: HTMLImageElement | null;
  blobUrl?: string;
  ready: boolean;
  timestamp: number;
}

const BITMAP_CACHE = new Map<string, CachedCircuitBitmap>();
const MAX_CACHE_ENTRIES = 100;
const REGENERATED_SVGS = new WeakMap<KirchhoffCircuit, string>();

/** Old saved SVGs can contain beta 36's inflated strokes; refresh once outside the ink path. */
export function circuitSvgForDisplay(circuit: CircuitElement): string {
  if (circuit.svg?.includes('data-finenotes-renderer="2"')) return circuit.svg;
  const cached = REGENERATED_SVGS.get(circuit.ir);
  if (cached) return cached;
  const svg = renderCircuitToSvg(circuit.ir, { theme: "light", backgroundColor: "transparent" });
  REGENERATED_SVGS.set(circuit.ir, svg);
  return svg;
}

/** Sets explicit width and height on root `<svg>` element for crisp vector rasterization at target resolution */
export function setSvgDimensions(svg: string, width: number, height: number): string {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return svg.replace(/<svg\b([^>]*)>/, (_match, attrs) => {
    let updated = attrs;
    if (/\bwidth="[^"]*"/.test(updated)) {
      updated = updated.replace(/\bwidth="[^"]*"/, `width="${w}"`);
    } else {
      updated += ` width="${w}"`;
    }
    if (/\bheight="[^"]*"/.test(updated)) {
      updated = updated.replace(/\bheight="[^"]*"/, `height="${h}"`);
    } else {
      updated += ` height="${h}"`;
    }
    return `<svg${updated}>`;
  });
}

/** Extracts width and height from SVG viewBox attribute if present */
export function parseSvgViewBox(svg: string): { width: number; height: number } | null {
  const match = svg.match(/\bviewBox="([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)"/);
  if (!match) return null;
  const w = parseFloat(match[3]);
  const h = parseFloat(match[4]);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { width: w, height: h } : null;
}

/** Calculates target pixel dimensions and drawn page dimensions for a circuit element */
export function circuitTargetDimensions(
  circuit: CircuitElement,
  scale = 1,
): { targetW: number; targetH: number; drawW: number; drawH: number } {
  const svg = circuitSvgForDisplay(circuit);
  const vb = parseSvgViewBox(svg);
  const viewW = vb ? vb.width : circuit.w;
  const viewH = vb ? vb.height : circuit.h;
  const viewAspect = viewW / viewH;
  const boxAspect = circuit.w / circuit.h;
  let drawW = circuit.w;
  let drawH = circuit.h;
  if (viewAspect > boxAspect) {
    drawH = circuit.w / viewAspect;
  } else {
    drawW = circuit.h * viewAspect;
  }
  const effScale = Math.max(1, scale);
  const targetW = Math.max(1, Math.min(4096, Math.round(drawW * effScale)));
  const targetH = Math.max(1, Math.min(4096, Math.round(drawH * effScale)));
  return { targetW, targetH, drawW, drawH };
}

function hashContent(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c64e6d;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Computes the axis-aligned bounding box of a placed circuit */
export function circuitBounds(circuit: CircuitElement): Bounds {
  return imageBounds(circuit);
}

/** Prepares or retrieves a cached HTMLImageElement for the given circuit at target device scale */
export function getCircuitImage(
  circuit: CircuitElement,
  onReady?: () => void,
  scale = 1,
): HTMLImageElement | null {
  const svg = circuitSvgForDisplay(circuit);
  const { targetW, targetH } = circuitTargetDimensions(circuit, scale);
  const cacheKey = `${circuit.id}:${hashContent(svg)}:${targetW}x${targetH}`;

  const cached = BITMAP_CACHE.get(cacheKey);
  if (cached && cached.image && cached.ready) {
    cached.timestamp = Date.now();
    return cached.image;
  }

  if (cached && !cached.ready) {
    // If exact target resolution is decoding, return any ready resolution of this circuit as fallback
    for (const [k, v] of BITMAP_CACHE.entries()) {
      if (k.startsWith(`${circuit.id}:`) && v.ready && v.image) {
        return v.image;
      }
    }
    return null;
  }

  // Create new image outside the pencil loop at target scale
  try {
    const sizedSvg = setSvgDimensions(svg, targetW, targetH);
    const blob = new Blob([sizedSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const entry: CachedCircuitBitmap = {
      svg: sizedSvg,
      image: img,
      blobUrl: url,
      ready: false,
      timestamp: Date.now(),
    };
    BITMAP_CACHE.set(cacheKey, entry);

    img.onload = () => {
      entry.ready = true;
      if (onReady) onReady();
    };
    img.onerror = () => {
      if (entry.blobUrl) {
        URL.revokeObjectURL(entry.blobUrl);
      }
      BITMAP_CACHE.delete(cacheKey);
    };

    img.src = url;

    // Prune cache if exceeded
    if (BITMAP_CACHE.size > MAX_CACHE_ENTRIES) {
      let oldestKey = "";
      let oldestTime = Infinity;
      for (const [k, v] of BITMAP_CACHE.entries()) {
        if (v.timestamp < oldestTime) {
          oldestTime = v.timestamp;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        const evicted = BITMAP_CACHE.get(oldestKey);
        if (evicted?.blobUrl) {
          URL.revokeObjectURL(evicted.blobUrl);
        }
        BITMAP_CACHE.delete(oldestKey);
      }
    }

    // While decoding target resolution, check if an existing scale is available
    for (const [k, v] of BITMAP_CACHE.entries()) {
      if (k !== cacheKey && k.startsWith(`${circuit.id}:`) && v.ready && v.image) {
        return v.image;
      }
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Resolves once all circuits in `circuits` are rasterized at `scale` without placeholders.
 * Safe for one-shot PDF export. Never throws or rejects.
 */
export async function prepareCircuits(
  circuits: readonly CircuitElement[],
  scale = 1,
): Promise<void> {
  const tasks: Promise<void>[] = [];
  for (const circuit of circuits) {
    if (!(circuit.w > 0) || !(circuit.h > 0)) continue;
    const svg = circuitSvgForDisplay(circuit);
    const { targetW, targetH } = circuitTargetDimensions(circuit, scale);
    const cacheKey = `${circuit.id}:${hashContent(svg)}:${targetW}x${targetH}`;
    const cached = BITMAP_CACHE.get(cacheKey);
    if (cached && cached.ready) continue;

    tasks.push(
      new Promise<void>((resolve) => {
        let finished = false;
        const done = () => {
          if (!finished) {
            finished = true;
            resolve();
          }
        };
        const img = getCircuitImage(circuit, done, scale);
        if (img && img.complete && img.naturalWidth > 0) {
          done();
        } else {
          setTimeout(done, 1500);
        }
      }),
    );
  }
  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
}

/** Draws a CircuitElement onto the target canvas context in page space */
export function drawPlacedCircuit(
  ctx: CanvasRenderingContext2D,
  circuit: CircuitElement,
  onReady?: () => void,
  deviceScale?: number,
): void {
  if (!(circuit.w > 0) || !(circuit.h > 0)) return;

  ctx.save();
  ctx.translate(circuit.x + circuit.w / 2, circuit.y + circuit.h / 2);
  const rotation = rotationOf(circuit);
  if (rotation !== 0) ctx.rotate(rotation);
  ctx.translate(-circuit.w / 2, -circuit.h / 2);

  let scale = deviceScale;
  if (!scale || scale <= 0) {
    try {
      const t = ctx.getTransform();
      scale = Math.max(1, Math.hypot(t.a, t.b));
    } catch {
      scale = 1;
    }
  }

  const { drawW, drawH } = circuitTargetDimensions(circuit, scale);
  const drawX = (circuit.w - drawW) / 2;
  const drawY = (circuit.h - drawH) / 2;

  const img = getCircuitImage(circuit, onReady, scale);
  if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
  } else {
    // Subtle placeholder box while decoding
    ctx.save();
    ctx.strokeStyle = "rgba(100, 116, 139, 0.4)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(0, 0, circuit.w, circuit.h);
    ctx.fillStyle = "rgba(148, 163, 184, 0.6)";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Circuit...", circuit.w / 2, circuit.h / 2);
    ctx.restore();
  }

  ctx.restore();
}
