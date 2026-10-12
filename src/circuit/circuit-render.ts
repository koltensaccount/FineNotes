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

/** Prepares or retrieves a cached HTMLImageElement for the given circuit */
export function getCircuitImage(
  circuit: CircuitElement,
  onReady?: () => void,
): HTMLImageElement | null {
  const svg = circuitSvgForDisplay(circuit);
  const cacheKey = `${circuit.id}:${hashContent(svg)}`;

  const cached = BITMAP_CACHE.get(cacheKey);
  if (cached && cached.image && cached.ready) {
    cached.timestamp = Date.now();
    return cached.image;
  }

  if (cached && !cached.ready) {
    return null;
  }

  // Create new image outside the pencil loop
  try {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const entry: CachedCircuitBitmap = {
      svg,
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
  } catch {
    return null;
  }

  return null;
}

/** Draws a CircuitElement onto the target canvas context in page space */
export function drawPlacedCircuit(
  ctx: CanvasRenderingContext2D,
  circuit: CircuitElement,
  onReady?: () => void,
): void {
  if (!(circuit.w > 0) || !(circuit.h > 0)) return;

  ctx.save();
  ctx.translate(circuit.x + circuit.w / 2, circuit.y + circuit.h / 2);
  const rotation = rotationOf(circuit);
  if (rotation !== 0) ctx.rotate(rotation);
  ctx.translate(-circuit.w / 2, -circuit.h / 2);

  const img = getCircuitImage(circuit, onReady);
  if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const boxAspect = circuit.w / circuit.h;
    let drawW = circuit.w;
    let drawH = circuit.h;
    let drawX = 0;
    let drawY = 0;
    if (imgAspect > boxAspect) {
      drawH = circuit.w / imgAspect;
      drawY = (circuit.h - drawH) / 2;
    } else {
      drawW = circuit.h * imgAspect;
      drawX = (circuit.w - drawW) / 2;
    }
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
