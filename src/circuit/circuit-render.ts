/**
 * Canvas rendering and bitmap caching for CircuitElement instances.
 *
 * Provides high-performance vector-to-bitmap rasterization and caching,
 * ensuring zero-latency page rendering and tile generation on iPadOS.
 */

import type { Bounds, CircuitElement } from "../model/document";
import { renderCircuitToSvg } from "./svg-render";
import { imageBounds, rotationOf } from "../canvas/image-geometry";

interface CachedCircuitBitmap {
  svg: string;
  image: HTMLImageElement | null;
  ready: boolean;
  timestamp: number;
}

const BITMAP_CACHE = new Map<string, CachedCircuitBitmap>();
const MAX_CACHE_ENTRIES = 100;

/** Computes the axis-aligned bounding box of a placed circuit */
export function circuitBounds(circuit: CircuitElement): Bounds {
  return imageBounds(circuit);
}

/** Prepares or retrieves a cached HTMLImageElement for the given circuit */
export function getCircuitImage(
  circuit: CircuitElement,
  onReady?: () => void,
): HTMLImageElement | null {
  const svg = circuit.svg || renderCircuitToSvg(circuit.ir);
  const cacheKey = `${circuit.id}:${svg.length}:${circuit.ir.wires.length}:${Object.keys(circuit.ir.components).length}`;

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
    const img = new Image();
    const entry: CachedCircuitBitmap = {
      svg,
      image: img,
      ready: false,
      timestamp: Date.now(),
    };
    BITMAP_CACHE.set(cacheKey, entry);

    img.onload = () => {
      entry.ready = true;
      if (onReady) onReady();
    };
    img.onerror = () => {
      BITMAP_CACHE.delete(cacheKey);
    };

    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
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
      if (oldestKey) BITMAP_CACHE.delete(oldestKey);
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
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, 0, 0, circuit.w, circuit.h);
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
