/**
 * Deterministic Component Label Placement & Collision Avoidance.
 *
 * Places component labels and values to avoid overlapping with:
 * 1. Component symbols and terminals.
 * 2. Schematic wires and waypoints.
 * 3. Adjacent component labels.
 * 4. Electrical junction dots.
 *
 * Automatically tests multiple candidate placement quadrants (Top, Bottom, Right, Left)
 * and expands clearance distance when tight layouts require it.
 */

import {
  COMPONENT_CATALOG,
  type KirchhoffCircuit,
} from "./ir";
import {
  type RoutedTerminalLead,
  routeAllTerminalLeads,
} from "./layout";

export interface PlacedComponentLabels {
  componentId: string;
  position: "top" | "bottom" | "left" | "right";
  labelText?: string;
  valueText?: string;
  labelX: number;
  labelY: number;
  valueX?: number;
  valueY?: number;
  anchor: "middle" | "start" | "end";
  bounds: Rect;
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function rectsOverlap(r1: Rect, r2: Rect): boolean {
  return !(
    r1.maxX < r2.minX ||
    r1.minX > r2.maxX ||
    r1.maxY < r2.minY ||
    r1.minY > r2.maxY
  );
}

function linesIntersect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number,
): boolean {
  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (denom === 0) return false;
  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}

function segmentIntersectsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rect: Rect,
): boolean {
  if (
    Math.max(x1, x2) < rect.minX ||
    Math.min(x1, x2) > rect.maxX ||
    Math.max(y1, y2) < rect.minY ||
    Math.min(y1, y2) > rect.maxY
  ) {
    return false;
  }

  // Check if either endpoint lies inside rectangle
  if (
    (x1 >= rect.minX && x1 <= rect.maxX && y1 >= rect.minY && y1 <= rect.maxY) ||
    (x2 >= rect.minX && x2 <= rect.maxX && y2 >= rect.minY && y2 <= rect.maxY)
  ) {
    return true;
  }

  // Check intersection with all 4 boundary edges of the rectangle
  return (
    linesIntersect(x1, y1, x2, y2, rect.minX, rect.minY, rect.maxX, rect.minY) ||
    linesIntersect(x1, y1, x2, y2, rect.minX, rect.maxY, rect.maxX, rect.maxY) ||
    linesIntersect(x1, y1, x2, y2, rect.minX, rect.minY, rect.minX, rect.maxY) ||
    linesIntersect(x1, y1, x2, y2, rect.maxX, rect.minY, rect.maxX, rect.maxY)
  );
}

/**
 * Places labels for all components in the circuit without collisions.
 */
export function layoutComponentLabels(
  circuit: KirchhoffCircuit,
  routedTerminalLeads?: RoutedTerminalLead[],
): Map<string, PlacedComponentLabels> {
  const gridSize = circuit.gridSize || 20;
  const placed = new Map<string, PlacedComponentLabels>();
  const placedRects: Rect[] = [];

  // Gather symbol bounding boxes in world pixel coordinates
  const symbolBoxes: Rect[] = [];
  for (const comp of Object.values(circuit.components)) {
    const def = COMPONENT_CATALOG[comp.type];
    const w = ((def ? def.width : 2) * gridSize);
    const h = ((def ? def.height : 2) * gridSize);
    const rad = (comp.rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const effW = w * cos + h * sin;
    const effH = w * sin + h * cos;
    const cx = comp.x * gridSize;
    const cy = comp.y * gridSize;

    symbolBoxes.push({
      minX: cx - effW / 2 - 4,
      minY: cy - effH / 2 - 4,
      maxX: cx + effW / 2 + 4,
      maxY: cy + effH / 2 + 4,
    });
  }

  // Gather wire segments in world pixel coordinates
  const wireSegments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (const wire of circuit.wires) {
    const from = circuit.nodes[wire.fromNode];
    const to = circuit.nodes[wire.toNode];
    if (!from || !to) continue;

    const x1 = from.x * gridSize;
    const y1 = from.y * gridSize;
    const x2 = to.x * gridSize;
    const y2 = to.y * gridSize;

    let points: Array<{ x: number; y: number }> = [];
    if (wire.waypoints && wire.waypoints.length > 0) {
      points = [
        { x: x1, y: y1 },
        ...wire.waypoints.map((pt) => ({ x: pt.x * gridSize, y: pt.y * gridSize })),
        { x: x2, y: y2 },
      ];
    } else if (!wire.direct && Math.abs(x1 - x2) > 0.01 && Math.abs(y1 - y2) > 0.01) {
      // Matches the exact Manhattan L-bend rendered in renderCircuitToSvg
      points = [
        { x: x1, y: y1 },
        { x: x2, y: y1 },
        { x: x2, y: y2 },
      ];
    } else {
      points = [
        { x: x1, y: y1 },
        { x: x2, y: y2 },
      ];
    }

    for (let i = 0; i < points.length - 1; i++) {
      wireSegments.push({
        x1: points[i].x,
        y1: points[i].y,
        x2: points[i + 1].x,
        y2: points[i + 1].y,
      });
    }
  }

  // Gather terminal lead segments in world pixel coordinates
  const leads = routedTerminalLeads ?? routeAllTerminalLeads(circuit);
  for (const lead of leads) {
    for (let i = 0; i < lead.points.length - 1; i++) {
      wireSegments.push({
        x1: lead.points[i].x * gridSize,
        y1: lead.points[i].y * gridSize,
        x2: lead.points[i + 1].x * gridSize,
        y2: lead.points[i + 1].y * gridSize,
      });
    }
  }
  for (const comp of Object.values(circuit.components)) {
    const labelText = comp.label;
    const valueText = comp.value;
    if (!labelText && !valueText) continue;

    const cx = comp.x * gridSize;
    const cy = comp.y * gridSize;
    const def = COMPONENT_CATALOG[comp.type];
    const compW = ((def ? def.width : 2) * gridSize);
    const compH = ((def ? def.height : 2) * gridSize);
    const rad = (comp.rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const effW = compW * cos + compH * sin;
    const effH = compW * sin + compH * cos;

    // Estimate text bounding box in pixels
    const maxChars = Math.max(labelText?.length || 0, valueText?.length || 0);
    const textW = Math.max(24, maxChars * 7.5 + 8);
    const lines = (labelText ? 1 : 0) + (valueText ? 1 : 0);
    const textH = lines === 2 ? 26 : 14;

    const isHorizontal = comp.rotation % 180 === 0;

    // Honor manual label placement if user moved labels on schematic (offsets stored in grid units)
    if (comp.labelOffset?.manual || comp.valueOffset?.manual) {
      const labelX = comp.labelOffset ? cx + comp.labelOffset.x * gridSize : cx;
      const labelY = comp.labelOffset ? cy + comp.labelOffset.y * gridSize : cy - effH / 2 - 10;
      const valueX = comp.valueOffset ? cx + comp.valueOffset.x * gridSize : (valueText ? labelX : undefined);
      const valueY = comp.valueOffset ? cy + comp.valueOffset.y * gridSize : (valueText ? labelY + 14 : undefined);
      const rect: Rect = {
        minX: Math.min(labelX, valueX ?? labelX) - textW / 2,
        maxX: Math.max(labelX, valueX ?? labelX) + textW / 2,
        minY: Math.min(labelY, valueY ?? labelY) - 10,
        maxY: Math.max(labelY, valueY ?? labelY) + 10,
      };
      const manualPlacement: PlacedComponentLabels = {
        componentId: comp.id,
        position: "top",
        labelText,
        valueText,
        labelX,
        labelY,
        valueX,
        valueY,
        anchor: "middle",
        bounds: rect,
      };
      placed.set(comp.id, manualPlacement);
      placedRects.push(rect);
      continue;
    }

    if (comp.type === "current_arrow") {
      const vertical=comp.rotation % 180 === 0;
      const labelX=vertical ? cx + gridSize*.7 : cx, labelY=vertical ? cy+4 : cy-12;
      const anchor=vertical ? "start" : "middle";
      const rect={minX:labelX-(vertical ? 0 : textW/2),maxX:labelX+(vertical ? textW : textW/2),minY:labelY-12,maxY:labelY+4};
      placed.set(comp.id,{componentId:comp.id,position:"right",labelText,valueText,labelX,labelY,anchor,bounds:rect});
      placedRects.push(rect); continue;
    }

    if (comp.type === "text_label" || comp.type === "voltage_label") {
      const labelX = comp.labelOffset ? cx + comp.labelOffset.x * gridSize : cx;
      const labelY = comp.labelOffset ? cy + comp.labelOffset.y * gridSize : cy + 4;
      const rect: Rect = {
        minX: labelX - textW / 2,
        maxX: labelX + textW / 2,
        minY: labelY - 10,
        maxY: labelY + 10,
      };
      const textPlacement: PlacedComponentLabels = {
        componentId: comp.id,
        position: "top",
        labelText,
        valueText,
        labelX,
        labelY,
        anchor: "middle",
        bounds: rect,
      };
      placed.set(comp.id, textPlacement);
      placedRects.push(rect);
      continue;
    }

    const candidates: Array<"top" | "bottom" | "right" | "left"> = isHorizontal
      ? ["top", "bottom", "right", "left"]
      : ["right", "left", "top", "bottom"];

    let bestPlacement: PlacedComponentLabels | null = null;
    let minPenalty = Infinity;

    for (const pos of candidates) {
      // Test standard offset and expanding offsets if needed
      for (const extraOffset of [0, 8, 16]) {
        let labelX = cx;
        let labelY = cy;
        let valueX: number | undefined;
        let valueY: number | undefined;
        let anchor: "middle" | "start" | "end" = "middle";
        let rect: Rect;

        if (pos === "top") {
          const topMargin = effH / 2 + 10 + extraOffset;
          labelY = cy - topMargin;
          if (valueText && labelText) {
            valueY = labelY - 13;
            labelY = cy - topMargin + 2;
            valueX = labelX;
          } else if (valueText && !labelText) {
            valueX = labelX;
            valueY = labelY;
          }
          rect = {
            minX: cx - textW / 2,
            minY: (valueY !== undefined ? valueY : labelY) - 10,
            maxX: cx + textW / 2,
            maxY: labelY + 4,
          };
        } else if (pos === "bottom") {
          const bottomMargin = effH / 2 + 14 + extraOffset;
          labelY = cy + bottomMargin;
          if (valueText && labelText) {
            valueY = labelY + 13;
            valueX = labelX;
          } else if (valueText && !labelText) {
            valueX = labelX;
            valueY = labelY;
          }
          rect = {
            minX: cx - textW / 2,
            minY: labelY - 10,
            maxX: cx + textW / 2,
            maxY: (valueY !== undefined ? valueY : labelY) + 4,
          };
        } else if (pos === "right") {
          const rightMargin = effW / 2 + 8 + extraOffset;
          labelX = cx + rightMargin;
          anchor = "start";
          if (valueText && labelText) {
            labelY = cy - 4;
            valueY = cy + 10;
            valueX = labelX;
          } else if (valueText && !labelText) {
            valueX = labelX;
            valueY = cy + 4;
          } else {
            labelY = cy + 4;
          }
          rect = {
            minX: labelX - 2,
            minY: cy - textH / 2 - 2,
            maxX: labelX + textW + 2,
            maxY: cy + textH / 2 + 2,
          };
        } else {
          // left
          const leftMargin = effW / 2 + 8 + extraOffset;
          labelX = cx - leftMargin;
          anchor = "end";
          if (valueText && labelText) {
            labelY = cy - 4;
            valueY = cy + 10;
            valueX = labelX;
          } else if (valueText && !labelText) {
            valueX = labelX;
            valueY = cy + 4;
          } else {
            labelY = cy + 4;
          }
          rect = {
            minX: labelX - textW - 2,
            minY: cy - textH / 2 - 2,
            maxX: labelX + 2,
            maxY: cy + textH / 2 + 2,
          };
        }

        // Calculate collision penalty
        let penalty = extraOffset * 2; // slight penalty for further away

        // 1. Collision with symbols
        for (const sBox of symbolBoxes) {
          if (rectsOverlap(rect, sBox)) penalty += 500;
        }

        // 2. Collision with wires
        for (const wSeg of wireSegments) {
          if (segmentIntersectsRect(wSeg.x1, wSeg.y1, wSeg.x2, wSeg.y2, rect)) {
            penalty += 200;
          }
        }

        // 3. Collision with previously placed labels
        for (const pRect of placedRects) {
          if (rectsOverlap(rect, pRect)) penalty += 1000;
        }

        if (penalty === 0) {
          bestPlacement = {
            componentId: comp.id,
            position: pos,
            labelText,
            valueText,
            labelX,
            labelY,
            valueX,
            valueY,
            anchor,
            bounds: rect,
          };
          minPenalty = 0;
          break;
        }

        if (penalty < minPenalty) {
          minPenalty = penalty;
          bestPlacement = {
            componentId: comp.id,
            position: pos,
            labelText,
            valueText,
            labelX,
            labelY,
            valueX,
            valueY,
            anchor,
            bounds: rect,
          };
        }
      }

      if (minPenalty === 0) break;
    }

    if (bestPlacement) {
      placed.set(comp.id, bestPlacement);
      placedRects.push(bestPlacement.bounds);
    }
  }

  return placed;
}
