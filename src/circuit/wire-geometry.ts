/**
 * Wire geometry utilities for direct LTspice-style segment dragging and manipulation.
 *
 * Implements:
 * - Direct wire segment hit-testing and dragging (horizontal moves vertically, vertical moves horizontally).
 * - Automatic bend insertion and adjoining bend reshaping.
 * - Collinear waypoint simplification and redundant bend collapse.
 * - Movable electrical junction identification and real-time net tracking.
 */

import type { CircuitNode, CircuitWire, KirchhoffCircuit } from "./ir";

export interface WirePolylinePoint {
  x: number;
  y: number;
}

export interface WireSegmentHit {
  wireId: string;
  segmentIndex: number;
  isHorizontal: boolean;
  p1: WirePolylinePoint;
  p2: WirePolylinePoint;
  dist: number;
}

/** Distance from point (px, py) to segment (x1, y1) -> (x2, y2) */
export function pointToSegmentDist(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

/**
 * Returns the full list of geometric vertices for a wire in grid coordinates,
 * resolving endpoints and any implicit Manhattan bends when waypoints are omitted.
 */
export function getWirePolyline(
  wire: CircuitWire,
  nodes: Record<string, CircuitNode>,
): WirePolylinePoint[] {
  const from = nodes[wire.fromNode];
  const to = nodes[wire.toNode];
  if (!from || !to) return [];

  const points: WirePolylinePoint[] = [{ x: from.x, y: from.y }];

  if (!wire.direct && wire.waypoints && wire.waypoints.length > 0) {
    for (const wp of wire.waypoints) {
      points.push({ x: wp.x, y: wp.y });
    }
  } else if (!wire.direct && Math.abs(from.x - to.x) > 0.01 && Math.abs(from.y - to.y) > 0.01) {
    // Default orthogonal Manhattan bend: route horizontally then vertically
    points.push({ x: to.x, y: from.y });
  }

  points.push({ x: to.x, y: to.y });
  return points;
}

/**
 * Hit tests all segments of a wire and returns the closest segment within `threshold`.
 */
export function hitTestWireSegment(
  wire: CircuitWire,
  nodes: Record<string, CircuitNode>,
  gridX: number,
  gridY: number,
  threshold = 0.6,
): WireSegmentHit | null {
  const points = getWirePolyline(wire, nodes);
  if (points.length < 2) return null;

  let bestHit: WireSegmentHit | null = null;
  let minD = threshold;

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const d = pointToSegmentDist(gridX, gridY, p1.x, p1.y, p2.x, p2.y);
    if (d < minD) {
      minD = d;
      const isHorizontal = Math.abs(p1.y - p2.y) <= Math.abs(p1.x - p2.x);
      bestHit = {
        wireId: wire.id,
        segmentIndex: i,
        isHorizontal,
        p1,
        p2,
        dist: d,
      };
    }
  }

  return bestHit;
}

/**
 * Drags a wire segment perpendicularly (horizontal shifts vertically, vertical shifts horizontally),
 * reshaping adjoining bends and inserting internal bends as needed to preserve electrical endpoints
 * and orthogonal Manhattan routing.
 *
 * Returns the updated array of internal waypoints for the wire.
 */
export function dragWireSegment(
  wire: CircuitWire,
  nodes: Record<string, CircuitNode>,
  segmentIndex: number,
  newCoord: number,
): WirePolylinePoint[] {
  const points = getWirePolyline(wire, nodes);
  if (points.length < 2 || segmentIndex < 0 || segmentIndex >= points.length - 1) {
    return wire.waypoints ? wire.waypoints.map((p) => ({ ...p })) : [];
  }

  const p1 = points[segmentIndex];
  const p2 = points[segmentIndex + 1];
  const isHorizontal = Math.abs(p1.y - p2.y) <= Math.abs(p1.x - p2.x);

  const isFirstSegment = segmentIndex === 0;
  const isLastSegment = segmentIndex === points.length - 2;

  let newPoints: WirePolylinePoint[] = [];

  if (isHorizontal) {
    const newY = newCoord;

    if (points.length === 2) {
      // Straight wire between two fixed nodes
      newPoints = [
        { ...points[0] },
        { x: points[0].x, y: newY },
        { x: points[1].x, y: newY },
        { ...points[1] },
      ];
    } else {
      newPoints = points.map((p) => ({ ...p }));
      if (isFirstSegment) {
        // Start node cannot move; insert bend at (p1.x, newY)
        newPoints.splice(1, 0, { x: p1.x, y: newY });
        newPoints[2].y = newY;
      } else if (isLastSegment) {
        // p1 is an internal waypoint
        newPoints[segmentIndex].y = newY;
        // End node cannot move; insert bend at (p2.x, newY) before end node
        newPoints.splice(newPoints.length - 1, 0, { x: p2.x, y: newY });
      } else {
        // Both p1 and p2 are internal waypoints
        newPoints[segmentIndex].y = newY;
        newPoints[segmentIndex + 1].y = newY;
      }
    }
  } else {
    const newX = newCoord;

    if (points.length === 2) {
      // Straight wire between two fixed nodes
      newPoints = [
        { ...points[0] },
        { x: newX, y: points[0].y },
        { x: newX, y: points[1].y },
        { ...points[1] },
      ];
    } else {
      newPoints = points.map((p) => ({ ...p }));
      if (isFirstSegment) {
        // Start node cannot move; insert bend at (newX, p1.y)
        newPoints.splice(1, 0, { x: newX, y: p1.y });
        newPoints[2].x = newX;
      } else if (isLastSegment) {
        // p1 is an internal waypoint
        newPoints[segmentIndex].x = newX;
        // End node cannot move; insert bend at (newX, p2.y) before end node
        newPoints.splice(newPoints.length - 1, 0, { x: newX, y: p2.y });
      } else {
        // Both p1 and p2 are internal waypoints
        newPoints[segmentIndex].x = newX;
        newPoints[segmentIndex + 1].x = newX;
      }
    }
  }

  // Extract waypoints (exclude start node at 0 and end node at length-1)
  const fromPt = newPoints[0];
  const toPt = newPoints[newPoints.length - 1];
  const rawWaypoints = newPoints.slice(1, -1);

  return simplifyWaypoints(fromPt, toPt, rawWaypoints);
}

/**
 * Simplifies a sequence of waypoints between `from` and `to`:
 * - Collapses consecutive points that are identical or virtually coincident (< 0.05).
 * - Removes collinear intermediate points (3 points sharing the same X or Y coordinate).
 * - Removes waypoints coincident with `from` or `to`.
 */
export function simplifyWaypoints(
  from: WirePolylinePoint,
  to: WirePolylinePoint,
  waypoints: WirePolylinePoint[],
): WirePolylinePoint[] {
  if (waypoints.length === 0) return [];

  const eps = 0.05;
  const all: WirePolylinePoint[] = [from, ...waypoints, to];

  // 1. Remove points nearly coincident with previous
  const deduped: WirePolylinePoint[] = [all[0]];
  for (let i = 1; i < all.length; i++) {
    const prev = deduped[deduped.length - 1];
    const curr = all[i];
    if (Math.hypot(curr.x - prev.x, curr.y - prev.y) > eps) {
      deduped.push(curr);
    }
  }

  // 2. Collapse collinear segments: if prev, curr, next share the same X or Y
  let changed = true;
  let points = deduped;
  while (changed && points.length >= 3) {
    changed = false;
    const nextPoints: WirePolylinePoint[] = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const prev = nextPoints[nextPoints.length - 1];
      const curr = points[i];
      const next = points[i + 1];

      const sameX = Math.abs(prev.x - curr.x) < eps && Math.abs(curr.x - next.x) < eps;
      const sameY = Math.abs(prev.y - curr.y) < eps && Math.abs(curr.y - next.y) < eps;

      if (sameX || sameY) {
        // Redundant intermediate bend; skip it
        changed = true;
      } else {
        nextPoints.push(curr);
      }
    }
    nextPoints.push(points[points.length - 1]);
    points = nextPoints;
  }

  // Waypoints are all internal points between endpoints
  if (points.length <= 2) {
    return [];
  }
  return points.slice(1, -1);
}

/**
 * Determines whether a given circuit node is a movable electrical junction.
 *
 * A node is a movable junction if:
 * 1. It is explicitly designated as a junction (`node.junction === true`), OR
 * 2. It connects to 3 or more wire endpoints (a physical wire T-junction or cross-junction), OR
 * 3. It connects to 2 or more wires and is NOT owned by any component terminal.
 */
export function isMovableJunction(circuit: KirchhoffCircuit, nodeId: string): boolean {
  const node = circuit.nodes[nodeId];
  if (!node) return false;
  if (node.junction === true) return true;

  // Count wire connections
  let wireCount = 0;
  for (const wire of circuit.wires) {
    if (wire.fromNode === nodeId || wire.toNode === nodeId) {
      wireCount++;
    }
  }

  if (wireCount >= 3) return true;

  // Check if node is owned by a component port
  let isComponentPort = false;
  for (const comp of Object.values(circuit.components)) {
    if (Object.values(comp.ports).includes(nodeId)) {
      isComponentPort = true;
      break;
    }
  }

  return !isComponentPort && wireCount >= 2;
}

/**
 * Hit tests all wires in a circuit to find the closest segment to (gridX, gridY).
 */
export function hitTestCircuitWireSegment(
  circuit: KirchhoffCircuit,
  gridX: number,
  gridY: number,
  threshold = 0.6,
): WireSegmentHit | null {
  let bestHit: WireSegmentHit | null = null;
  let minD = threshold;

  for (const wire of circuit.wires) {
    const hit = hitTestWireSegment(wire, circuit.nodes, gridX, gridY, minD);
    if (hit && hit.dist < minD) {
      minD = hit.dist;
      bestHit = hit;
    }
  }

  return bestHit;
}

/**
 * Drags a wire segment perpendicularly in a circuit, updating its waypoints,
 * setting `direct = false`, and marking `userEdited = true`.
 */
export function dragCircuitWireSegment(
  circuit: KirchhoffCircuit,
  wireId: string,
  segmentIndex: number,
  newCoord: number,
): boolean {
  const wire = circuit.wires.find((w) => w.id === wireId);
  if (!wire) return false;

  const newWaypoints = dragWireSegment(wire, circuit.nodes, segmentIndex, newCoord);
  wire.waypoints = newWaypoints.length > 0 ? newWaypoints : undefined;
  wire.direct = false;
  wire.userEdited = true;
  return true;
}

/**
 * Simplifies collinear or redundant waypoints for a wire in a circuit.
 */
export function simplifyCircuitWire(
  circuit: KirchhoffCircuit,
  wireId: string,
): boolean {
  const wire = circuit.wires.find((w) => w.id === wireId);
  if (!wire || !wire.waypoints || wire.waypoints.length === 0) return false;
  const from = circuit.nodes[wire.fromNode];
  const to = circuit.nodes[wire.toNode];
  if (!from || !to) return false;

  const simplified = simplifyWaypoints(from, to, wire.waypoints);
  wire.waypoints = simplified.length > 0 ? simplified : undefined;
  wire.userEdited = true;
  return true;
}

