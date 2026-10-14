/**
 * Automatic Circuit Layout & Orthogonal Wire Routing Engine.
 *
 * Implements clean schematic layout normalization:
 * 1. Component alignment and grid snapping (aligning series and parallel pairs).
 * 2. Terminal-to-node snapping ensuring zero lead gaps.
 * 3. Component overlap prevention with configurable clearance.
 * 4. Obstacle-aware orthogonal Manhattan wire routing.
 *
 * Preserves 100% of the electrical netlist connectivity.
 */

import {
  type CircuitComponent,
  type CircuitDiagnostic,
  COMPONENT_CATALOG,
  type KirchhoffCircuit,
  cloneCircuit,
  getComponentPortPosition,
} from "./ir";

export interface LayoutOptions {
  gridSpacing?: number; // Minimum clearance between component bodies in grid units (default 2)
  snapGrid?: number; // Integer quantization step (default 1)
}

interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Computes the bounding box of a component in grid coordinates */
export function getComponentBoundingBox(comp: CircuitComponent, margin = 0.2): Rect {
  const def = COMPONENT_CATALOG[comp.type];
  const w = def ? def.width : 2;
  const h = def ? def.height : 2;

  const rad = (comp.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const effW = w * cos + h * sin;
  const effH = w * sin + h * cos;

  return {
    minX: comp.x - effW / 2 - margin,
    minY: comp.y - effH / 2 - margin,
    maxX: comp.x + effW / 2 + margin,
    maxY: comp.y + effH / 2 + margin,
  };
}

/**
 * Tests if a line segment intersects a rotated component's bounding box in component-local coordinates.
 * Prevents false positives where terminals on diagonally rotated components are trapped inside
 * shrunken axis-aligned bounding boxes.
 */
export function segmentIntersectsOrientedBox(
  sx1: number,
  sy1: number,
  sx2: number,
  sy2: number,
  comp: CircuitComponent,
  margin: number,
): boolean {
  const def = COMPONENT_CATALOG[comp.type];
  const w = def ? def.width : 2;
  const h = def ? def.height : 2;

  const halfW = w / 2 + margin;
  const halfH = h / 2 + margin;
  if (halfW <= 0 || halfH <= 0) return false;

  const bMinX = -halfW;
  const bMaxX = halfW;
  const bMinY = -halfH;
  const bMaxY = halfH;

  // Transform world segment coordinates to component-local coordinates
  const rad = (-comp.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const dx1 = sx1 - comp.x;
  const dy1 = sy1 - comp.y;
  const lx1 = dx1 * cos - dy1 * sin;
  const ly1 = dx1 * sin + dy1 * cos;

  const dx2 = sx2 - comp.x;
  const dy2 = sy2 - comp.y;
  const lx2 = dx2 * cos - dy2 * sin;
  const ly2 = dx2 * sin + dy2 * cos;

  // Liang-Barsky line clipping against local axis-aligned box [bMinX, bMaxX] x [bMinY, bMaxY]
  const p = [-(lx2 - lx1), lx2 - lx1, -(ly2 - ly1), ly2 - ly1];
  const q = [lx1 - bMinX, bMaxX - lx1, ly1 - bMinY, bMaxY - ly1];

  let u1 = 0;
  let u2 = 1;

  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-9) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > u2) return false;
        if (t > u1) u1 = t;
      } else {
        if (t < u1) return false;
        if (t < u2) u2 = t;
      }
    }
  }

  return u1 <= u2;
}

export interface WireObstacleSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  netId?: string;
}

/**
 * Options for routing wires and terminal leads between two points.
 */
export interface RouteWireOptions {
  fromCompId?: string;
  toCompId?: string;
  endpointCompIds?: Set<string>;
  ignoreNodeIds?: Set<string>;
  ignoreWireId?: string;
  existingWaypoints?: { x: number; y: number }[];
  preferHV?: boolean;
  /** Prefer the shortest clear straight/L route over imported bends. */
  simplifyImported?: boolean;
  snapGrid?: number;
  diagnostics?: CircuitDiagnostic[];
  netId?: string;
  additionalObstacles?: WireObstacleSegment[];
}

/**
 * Checks whether an axis-aligned line segment is obstructed by component bodies,
 * unrelated electrical nodes/junctions, or overlapping wire segments.
 */
export function isSegmentObstructed(
  sx1: number,
  sy1: number,
  sx2: number,
  sy2: number,
  circuit: KirchhoffCircuit,
  options?: RouteWireOptions,
): boolean {
  const isEndpointComp = (id: string) =>
    id === options?.fromCompId ||
    id === options?.toCompId ||
    (options?.endpointCompIds?.has(id) ?? false);

  // 1. Component obstacles tested against exact oriented component body
  for (const comp of Object.values(circuit.components)) {
    if (comp.type === "text_label" || comp.type === "voltage_label") continue;
    if (isEndpointComp(comp.id)) {
      // Endpoint component: allowed to attach to exterior port,
      // but must never penetrate through the component's inner body
      if (segmentIntersectsOrientedBox(sx1, sy1, sx2, sy2, comp, -0.15)) return true;
    } else {
      // Unrelated / intermediate component
      if (segmentIntersectsOrientedBox(sx1, sy1, sx2, sy2, comp, 0.15)) return true;
    }
  }

  // Shared-net components are still obstacles at their OTHER terminals.
  // Passing a lead through an unrelated pin makes the SVG look joined and the
  // coordinate-based CircuitikZ importer correctly treats that pin as connected.
  for (const comp of Object.values(circuit.components)) {
    const def = COMPONENT_CATALOG[comp.type];
    for (const port of def?.ports || []) {
      const nodeId = comp.ports[port.id];
      if (nodeId && (options?.ignoreNodeIds?.has(nodeId) || options?.netId === nodeId)) continue;
      const point = getComponentPortPosition(comp, port.id);
      if (!point) continue;
      if (Math.abs(sy1 - sy2) < 0.001 && Math.abs(point.y - sy1) < 0.25 &&
          point.x >= Math.min(sx1, sx2) - 0.1 && point.x <= Math.max(sx1, sx2) + 0.1) return true;
      if (Math.abs(sx1 - sx2) < 0.001 && Math.abs(point.x - sx1) < 0.25 &&
          point.y >= Math.min(sy1, sy2) - 0.1 && point.y <= Math.max(sy1, sy2) + 0.1) return true;
    }
  }

  // 2. Unrelated electrical nodes / junctions
  for (const n of Object.values(circuit.nodes)) {
    if (options?.ignoreNodeIds?.has(n.id)) continue;

    if (Math.abs(sy1 - sy2) < 0.001) {
      // Horizontal segment
      const minX = Math.min(sx1, sx2);
      const maxX = Math.max(sx1, sx2);
      if (
        Math.abs(n.y - sy1) < 0.25 &&
        n.x >= minX - 0.1 &&
        n.x <= maxX + 0.1
      ) {
        return true;
      }
    } else if (Math.abs(sx1 - sx2) < 0.001) {
      // Vertical segment
      const minY = Math.min(sy1, sy2);
      const maxY = Math.max(sy1, sy2);
      if (
        Math.abs(n.x - sx1) < 0.25 &&
        n.y >= minY - 0.1 &&
        n.y <= maxY + 0.1
      ) {
        return true;
      }
    }
  }

  // 3. Overlapping wire segments of other wires
  for (const wire of circuit.wires) {
    if (wire.id === options?.ignoreWireId) continue;
    // A terminal lead may share its own electrical net, without a detour.
    if (options?.netId && options.ignoreNodeIds?.has(wire.fromNode) && options.ignoreNodeIds.has(wire.toNode)) continue;
    const wFrom = circuit.nodes[wire.fromNode];
    const wTo = circuit.nodes[wire.toNode];
    if (!wFrom || !wTo) continue;

    let pts: Array<{ x: number; y: number }>;
    if (wire.waypoints && wire.waypoints.length > 0) {
      pts = [wFrom, ...wire.waypoints, wTo];
    } else if (!wire.direct && Math.abs(wFrom.x - wTo.x) > 0.01 && Math.abs(wFrom.y - wTo.y) > 0.01) {
      // Matches the exact Manhattan L-bend rendered in renderCircuitToSvg
      pts = [wFrom, { x: wTo.x, y: wFrom.y }, wTo];
    } else {
      pts = [wFrom, wTo];
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const wx1 = pts[i].x;
      const wy1 = pts[i].y;
      const wx2 = pts[i + 1].x;
      const wy2 = pts[i + 1].y;

      if (Math.abs(sy1 - sy2) < 0.001 && Math.abs(wy1 - wy2) < 0.001 && Math.abs(sy1 - wy1) < 0.25) {
        const overlapMin = Math.max(Math.min(sx1, sx2), Math.min(wx1, wx2));
        const overlapMax = Math.min(Math.max(sx1, sx2), Math.max(wx1, wx2));
        if (overlapMax - overlapMin > 0.25) return true;
      } else if (Math.abs(sx1 - sx2) < 0.001 && Math.abs(wx1 - wx2) < 0.001 && Math.abs(sx1 - wx1) < 0.25) {
        const overlapMin = Math.max(Math.min(sy1, sy2), Math.min(wy1, wy2));
        const overlapMax = Math.min(Math.max(sy1, sy2), Math.max(wy1, wy2));
        if (overlapMax - overlapMin > 0.25) return true;
      }
    }
  }

  // 4. Additional wire obstacles (e.g. previously routed terminal leads)
  if (options?.additionalObstacles) {
    for (const obs of options.additionalObstacles) {
      if (options.netId && obs.netId && options.netId === obs.netId) {
        continue;
      }
      const wx1 = obs.x1;
      const wy1 = obs.y1;
      const wx2 = obs.x2;
      const wy2 = obs.y2;

      if (Math.abs(sy1 - sy2) < 0.001 && Math.abs(wy1 - wy2) < 0.001 && Math.abs(sy1 - wy1) < 0.25) {
        const overlapMin = Math.max(Math.min(sx1, sx2), Math.min(wx1, wx2));
        const overlapMax = Math.min(Math.max(sx1, sx2), Math.max(wx1, wx2));
        if (overlapMax - overlapMin > 0.25) return true;
      } else if (Math.abs(sx1 - sx2) < 0.001 && Math.abs(wx1 - wx2) < 0.001 && Math.abs(sx1 - wx1) < 0.25) {
        const overlapMin = Math.max(Math.min(sy1, sy2), Math.min(wy1, wy2));
        const overlapMax = Math.min(Math.max(sy1, sy2), Math.max(wy1, wy2));
        if (overlapMax - overlapMin > 0.25) return true;
      }
    }
  }

  return false;
}

/**
 * Computes obstacle-aware Manhattan routing between two points.
 * Preserves existing valid detours, avoids unrelated nodes and component bodies.
 */
export function routeWireBetweenPoints(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  circuit: KirchhoffCircuit,
  options?: RouteWireOptions,
): Array<{ x: number; y: number }> {
  if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < 0.05) {
    return [];
  }

  if (options?.simplifyImported) {
    const clear = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      !isSegmentObstructed(a.x, a.y, b.x, b.y, circuit, options);
    if (Math.abs(p1.x - p2.x) < 0.001 || Math.abs(p1.y - p2.y) < 0.001) {
      if (clear(p1, p2)) return [];
    } else {
      const corners = [{ x: p2.x, y: p1.y }, { x: p1.x, y: p2.y }];
      if (options.preferHV === false) corners.reverse();
      for (const corner of corners) {
        if (clear(p1, corner) && clear(corner, p2)) return [corner];
      }
    }
  }

  // 1. Preserve existing waypoints if strictly orthogonal and obstacle-free
  if (options?.existingWaypoints && options.existingWaypoints.length > 0) {
    const fullPath = [p1, ...options.existingWaypoints, p2];
    let allValid = true;
    for (let i = 0; i < fullPath.length - 1; i++) {
      const isOrthogonal =
        Math.abs(fullPath[i].x - fullPath[i + 1].x) < 0.001 ||
        Math.abs(fullPath[i].y - fullPath[i + 1].y) < 0.001;
      if (
        !isOrthogonal ||
        isSegmentObstructed(
          fullPath[i].x,
          fullPath[i].y,
          fullPath[i + 1].x,
          fullPath[i + 1].y,
          circuit,
          options,
        )
      ) {
        allValid = false;
        break;
      }
    }
    if (allValid) {
      return [...options.existingWaypoints];
    }
  }

  // Helper to generate expanding channel offsets
  const getDetourOffsets = (maxOffset = 20, step = 0.5): number[] => {
    const offsets: number[] = [];
    for (let d = 1.5; d <= maxOffset; d += step) {
      offsets.push(d, -d);
    }
    return offsets;
  };

  const isCollinear = Math.abs(p1.x - p2.x) < 0.001 || Math.abs(p1.y - p2.y) < 0.001;
  if (isCollinear) {
    // Check if direct straight segment is completely clear
    if (!isSegmentObstructed(p1.x, p1.y, p2.x, p2.y, circuit, options)) {
      return [];
    }

    // Straight segment is obstructed (e.g. by unrelated junction or component body) -> search expanding U-bend channels
    const detourOffsets = getDetourOffsets(20);
    const outwardSteps = [0, 1, 2, 3];

    if (Math.abs(p1.y - p2.y) < 0.001) {
      // Horizontal collinear
      const dirX = Math.sign(p2.x - p1.x) || 1;
      for (const step1 of outwardSteps) {
        const outX1 = p1.x - dirX * step1;
        if (step1 > 0 && isSegmentObstructed(p1.x, p1.y, outX1, p1.y, circuit, options)) {
          continue;
        }
        for (const step2 of outwardSteps) {
          const outX2 = p2.x + dirX * step2;
          if (step2 > 0 && isSegmentObstructed(outX2, p2.y, p2.x, p2.y, circuit, options)) {
            continue;
          }

          for (const offset of detourOffsets) {
            const detourY = p1.y + offset;
            const obs =
              isSegmentObstructed(outX1, p1.y, outX1, detourY, circuit, options) ||
              isSegmentObstructed(outX1, detourY, outX2, detourY, circuit, options) ||
              isSegmentObstructed(outX2, detourY, outX2, p2.y, circuit, options);
            if (!obs) {
              const wps: Array<{ x: number; y: number }> = [];
              if (step1 > 0) wps.push({ x: outX1, y: p1.y });
              wps.push({ x: outX1, y: detourY });
              wps.push({ x: outX2, y: detourY });
              if (step2 > 0) wps.push({ x: outX2, y: p2.y });
              return wps;
            }
          }
        }
      }
    } else {
      // Vertical collinear
      const dirY = Math.sign(p2.y - p1.y) || 1;
      for (const step1 of outwardSteps) {
        const outY1 = p1.y - dirY * step1;
        if (step1 > 0 && isSegmentObstructed(p1.x, p1.y, p1.x, outY1, circuit, options)) {
          continue;
        }
        for (const step2 of outwardSteps) {
          const outY2 = p2.y + dirY * step2;
          if (step2 > 0 && isSegmentObstructed(p2.x, outY2, p2.x, p2.y, circuit, options)) {
            continue;
          }

          for (const offset of detourOffsets) {
            const detourX = p1.x + offset;
            const obs =
              isSegmentObstructed(p1.x, outY1, detourX, outY1, circuit, options) ||
              isSegmentObstructed(detourX, outY1, detourX, outY2, circuit, options) ||
              isSegmentObstructed(detourX, outY2, p2.x, outY2, circuit, options);
            if (!obs) {
              const wps: Array<{ x: number; y: number }> = [];
              if (step1 > 0) wps.push({ x: p1.x, y: outY1 });
              wps.push({ x: detourX, y: outY1 });
              wps.push({ x: detourX, y: outY2 });
              if (step2 > 0) wps.push({ x: p2.x, y: outY2 });
              return wps;
            }
          }
        }
      }
    }

    if (options?.diagnostics) {
      options.diagnostics.push({
        code: "UNROUTABLE_OBSTRUCTION",
        severity: "warning",
        message: `Could not find an obstacle-free orthogonal detour between (${p1.x}, ${p1.y}) and (${p2.x}, ${p2.y})`,
      });
    }
    // Return a default U-bend detour rather than an obstructed straight line through obstacles
    const defaultOffset = 2;
    if (Math.abs(p1.y - p2.y) < 0.001) {
      return [{ x: p1.x, y: p1.y + defaultOffset }, { x: p2.x, y: p2.y + defaultOffset }];
    } else {
      return [{ x: p1.x + defaultOffset, y: p1.y }, { x: p2.x + defaultOffset, y: p2.y }];
    }
  }

  // Non-collinear endpoints: evaluate Manhattan L-bends
  const preferHV = options?.preferHV ?? true;
  const obsHV =
    isSegmentObstructed(p1.x, p1.y, p2.x, p1.y, circuit, options) ||
    isSegmentObstructed(p2.x, p1.y, p2.x, p2.y, circuit, options);
  const obsVH =
    isSegmentObstructed(p1.x, p1.y, p1.x, p2.y, circuit, options) ||
    isSegmentObstructed(p1.x, p2.y, p2.x, p2.y, circuit, options);

  if (!obsHV && (obsVH || preferHV)) {
    return [{ x: p2.x, y: p1.y }];
  }
  if (!obsVH && (obsHV || !preferHV)) {
    return [{ x: p1.x, y: p2.y }];
  }
  if (!obsHV) return [{ x: p2.x, y: p1.y }];
  if (!obsVH) return [{ x: p1.x, y: p2.y }];

  // Both direct L-bends obstructed: search expanding channel detours
  for (const offset of getDetourOffsets(20)) {
    const midY = p1.y + offset;
    const obsH =
      isSegmentObstructed(p1.x, p1.y, p1.x, midY, circuit, options) ||
      isSegmentObstructed(p1.x, midY, p2.x, midY, circuit, options) ||
      isSegmentObstructed(p2.x, midY, p2.x, p2.y, circuit, options);
    if (!obsH) {
      return [{ x: p1.x, y: midY }, { x: p2.x, y: midY }];
    }

    const midX = p1.x + offset;
    const obsV =
      isSegmentObstructed(p1.x, p1.y, midX, p1.y, circuit, options) ||
      isSegmentObstructed(midX, p1.y, midX, p2.y, circuit, options) ||
      isSegmentObstructed(midX, p2.y, p2.x, p2.y, circuit, options);
    if (!obsV) {
      return [{ x: midX, y: p1.y }, { x: midX, y: p2.y }];
    }
  }

  if (options?.diagnostics) {
    options.diagnostics.push({
      code: "UNROUTABLE_OBSTRUCTION",
      severity: "warning",
      message: `Could not find an obstacle-free orthogonal route between (${p1.x}, ${p1.y}) and (${p2.x}, ${p2.y})`,
    });
  }

  // Fallback
  return preferHV ? [{ x: p2.x, y: p1.y }] : [{ x: p1.x, y: p2.y }];
}

/**
 * Normalizes and cleans the layout of a KirchhoffCircuit.
 */
export function autoLayoutCircuit(
  inputCircuit: KirchhoffCircuit,
  options: LayoutOptions = {},
): KirchhoffCircuit {
  const circuit = cloneCircuit(inputCircuit);
  const snapStep = options.snapGrid ?? 1;

  // 1. Initial grid snapping of component coordinates
  for (const comp of Object.values(circuit.components)) {
    comp.x = Math.round(comp.x / snapStep) * snapStep;
    comp.y = Math.round(comp.y / snapStep) * snapStep;
  }

  // 2. Collinear alignment for series-connected components
  // Build node-to-component mapping
  const nodeToComps: Record<string, Array<{ comp: CircuitComponent; portId: string }>> = {};
  for (const comp of Object.values(circuit.components)) {
    for (const [pId, nId] of Object.entries(comp.ports)) {
      if (!nodeToComps[nId]) nodeToComps[nId] = [];
      nodeToComps[nId].push({ comp, portId: pId });
    }
  }

  // Align components connected in simple series (node degree 2 with exactly two components)
  for (const [, entries] of Object.entries(nodeToComps)) {
    if (entries.length === 2) {
      const c1 = entries[0].comp;
      const c2 = entries[1].comp;
      if (c1.id !== c2.id) {
        const dx = Math.abs(c1.x - c2.x);
        const dy = Math.abs(c1.y - c2.y);
        if (dx >= dy && dy < 2.5) {
          // Align horizontally to average Y
          const avgY = Math.round((c1.y + c2.y) / (2 * snapStep)) * snapStep;
          c1.y = avgY;
          c2.y = avgY;
        } else if (dy > dx && dx < 2.5) {
          // Align vertically to average X
          const avgX = Math.round((c1.x + c2.x) / (2 * snapStep)) * snapStep;
          c1.x = avgX;
          c2.x = avgX;
        }
      }
    }
  }

  // Build disjoint-set (netlist) of electrical nets to prevent unrelated nodes from snapping together
  const parentNet = new Map<string, string>();
  const findNet = (id: string): string => {
    let p = parentNet.get(id);
    if (!p) {
      parentNet.set(id, id);
      return id;
    }
    if (p !== id) {
      p = findNet(p);
      parentNet.set(id, p);
    }
    return p;
  };
  const unionNet = (id1: string, id2: string) => {
    const root1 = findNet(id1);
    const root2 = findNet(id2);
    if (root1 !== root2) {
      parentNet.set(root1, root2);
    }
  };

  for (const wire of circuit.wires) {
    unionNet(wire.fromNode, wire.toNode);
  }

  // 3. Prevent component overlap (iterative relaxation to ensure earlier pairs are not re-collided)
  const compList = Object.values(circuit.components);
  let changed = true;
  let iter = 0;
  while (changed && iter++ < 10) {
    changed = false;
    for (let i = 0; i < compList.length; i++) {
      for (let j = i + 1; j < compList.length; j++) {
        const c1 = compList[i];
        const c2 = compList[j];
        const c1Nodes = new Set(Object.values(c1.ports));
        const sharesNode = Object.values(c2.ports).some((nId) => c1Nodes.has(nId));

        let touchingDifferentNet = false;
        if (sharesNode) {
          for (const [p1Id, n1Id] of Object.entries(c1.ports)) {
            const pos1 = getComponentPortPosition(c1, p1Id);
            if (!pos1) continue;
            for (const [p2Id, n2Id] of Object.entries(c2.ports)) {
              const pos2 = getComponentPortPosition(c2, p2Id);
              if (!pos2) continue;
              const d = Math.hypot(pos1.x - pos2.x, pos1.y - pos2.y);
              if (d < 0.25) {
                if (findNet(n1Id) !== findNet(n2Id)) {
                  touchingDifferentNet = true;
                  break;
                }
              }
            }
            if (touchingDifferentNet) break;
          }
        }

        const margin = (sharesNode && !touchingDifferentNet) ? 0 : 0.4;
        const b1 = getComponentBoundingBox(c1, margin);
        const b2 = getComponentBoundingBox(c2, margin);

        const overlapX = Math.min(b1.maxX, b2.maxX) - Math.max(b1.minX, b2.minX);
        const overlapY = Math.min(b1.maxY, b2.maxY) - Math.max(b1.minY, b2.minY);

        if (overlapX > 0 && overlapY > 0) {
          changed = true;
          // Resolve overlap along axis of lesser overlap
          if (overlapX < overlapY) {
            const shift = Math.ceil(overlapX / snapStep) * snapStep;
            if (c1.x <= c2.x) {
              c2.x += shift;
            } else {
              c1.x += shift;
            }
          } else {
            const shift = Math.ceil(overlapY / snapStep) * snapStep;
            if (c1.y <= c2.y) {
              c2.y += shift;
            } else {
              c1.y += shift;
            }
          }
        }
      }
    }
  }

  const positionedNodes: Array<{ id: string; x: number; y: number; net: string }> = [];

  // 4. Snap nodes to component terminals & convert separated ports into explicit wires
  for (const [nodeId, node] of Object.entries(circuit.nodes)) {
    const entries = nodeToComps[nodeId] || [];
    let candX = node.x;
    let candY = node.y;

    if (entries.length === 1) {
      // Exactly 1 component port: node sits exactly at that port's terminal
      const pos = getComponentPortPosition(entries[0].comp, entries[0].portId);
      if (pos) {
        candX = pos.x;
        candY = pos.y;
      }
    } else if (entries.length > 1) {
      // Multiple component ports meet at this node
      const portPositions = entries
        .map((e) => ({ ...e, pos: getComponentPortPosition(e.comp, e.portId) }))
        .filter((e): e is typeof e & { pos: { x: number; y: number } } => e.pos !== null);

      if (portPositions.length > 0) {
        let maxDist = 0;
        for (let i = 0; i < portPositions.length; i++) {
          for (let j = i + 1; j < portPositions.length; j++) {
            maxDist = Math.max(
              maxDist,
              Math.hypot(
                portPositions[i].pos.x - portPositions[j].pos.x,
                portPositions[i].pos.y - portPositions[j].pos.y,
              ),
            );
          }
        }

        if (maxDist < 0.05) {
          // Coincident terminals: keep exact port coordinate
          candX = portPositions[0].pos.x;
          candY = portPositions[0].pos.y;
        } else if (maxDist < 2.5) {
          // Converging junction: snap node to average
          const avgX = portPositions.reduce((acc, p) => acc + p.pos.x, 0) / portPositions.length;
          const avgY = portPositions.reduce((acc, p) => acc + p.pos.y, 0) / portPositions.length;
          const avgCandX = Math.round(avgX / snapStep) * snapStep;
          const avgCandY = Math.round(avgY / snapStep) * snapStep;

          // Ensure avgCandX, avgCandY does not penetrate inside any component body
          let insideBody = false;
          for (const comp of Object.values(circuit.components)) {
            if (segmentIntersectsOrientedBox(avgCandX, avgCandY, avgCandX, avgCandY, comp, -0.05)) {
              insideBody = true;
              break;
            }
          }

          if (!insideBody) {
            candX = avgCandX;
            candY = avgCandY;
          } else {
            // Pick the port position outside component bodies
            candX = portPositions[0].pos.x;
            candY = portPositions[0].pos.y;
          }
        } else {
          // Separated components sharing net: snap node to the closest port
          let bestIdx = 0;
          let bestDist = Math.hypot(portPositions[0].pos.x - node.x, portPositions[0].pos.y - node.y);
          for (let i = 1; i < portPositions.length; i++) {
            const d = Math.hypot(portPositions[i].pos.x - node.x, portPositions[i].pos.y - node.y);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = i;
            }
          }
          candX = portPositions[bestIdx].pos.x;
          candY = portPositions[bestIdx].pos.y;
        }
      }
    } else {
      // Pure wire junction: snap to grid
      candX = Math.round(node.x / snapStep) * snapStep;
      candY = Math.round(node.y / snapStep) * snapStep;
    }

    // Ensure distinct electrical nets never snap to the same coordinate
    const nodeNet = findNet(nodeId);
    const collidesWithOtherNet = (x: number, y: number) =>
      positionedNodes.some(
        (pn) => pn.net !== nodeNet && Math.hypot(pn.x - x, pn.y - y) < 0.25,
      );

    if (collidesWithOtherNet(candX, candY)) {
      const offsets = [
        { dx: snapStep, dy: 0 },
        { dx: -snapStep, dy: 0 },
        { dx: 0, dy: snapStep },
        { dx: 0, dy: -snapStep },
        { dx: snapStep, dy: snapStep },
        { dx: -snapStep, dy: -snapStep },
        { dx: snapStep, dy: -snapStep },
        { dx: -snapStep, dy: snapStep },
      ];
      let placed = false;
      for (const off of offsets) {
        if (!collidesWithOtherNet(candX + off.dx, candY + off.dy)) {
          candX = candX + off.dx;
          candY = candY + off.dy;
          placed = true;
          break;
        }
      }
      if (!placed) {
        candX = node.x;
        candY = node.y;
      }
    }

    node.x = candX;
    node.y = candY;
    positionedNodes.push({ id: nodeId, x: node.x, y: node.y, net: nodeNet });
  }

  // 5. Orthogonal Manhattan wire routing with obstacle avoidance
  for (const wire of circuit.wires) {
    const fromNode = circuit.nodes[wire.fromNode];
    const toNode = circuit.nodes[wire.toNode];
    if (!fromNode || !toNode) continue;

    const fromComps = nodeToComps[wire.fromNode] || [];
    const toComps = nodeToComps[wire.toNode] || [];
    const fromCompId = fromComps.length === 1 ? fromComps[0].comp.id : undefined;
    const toCompId = toComps.length === 1 ? toComps[0].comp.id : undefined;
    const endpointCompIds = new Set<string>();
    for (const fc of fromComps) endpointCompIds.add(fc.comp.id);
    for (const tc of toComps) endpointCompIds.add(tc.comp.id);

    let preferHV = true;
    if (fromComps.length === 1) {
      const def = COMPONENT_CATALOG[fromComps[0].comp.type];
      const p = def?.ports.find((port) => port.id === fromComps[0].portId);
      if (p && Math.abs(p.x) < Math.abs(p.y)) {
        preferHV = false;
      }
    }

    const layoutDiagnostics: CircuitDiagnostic[] = [];
    const waypoints = routeWireBetweenPoints(
      { x: fromNode.x, y: fromNode.y },
      { x: toNode.x, y: toNode.y },
      circuit,
      {
        fromCompId,
        toCompId,
        endpointCompIds,
        ignoreNodeIds: new Set([wire.fromNode, wire.toNode]),
        ignoreWireId: wire.id,
        existingWaypoints: wire.waypoints,
        simplifyImported: !wire.userEdited,
        preferHV,
        snapGrid: snapStep,
        diagnostics: layoutDiagnostics,
      },
    );

    wire.waypoints = waypoints.length > 0 ? waypoints : undefined;
    if (layoutDiagnostics.length > 0) {
      circuit.diagnostics = [...(circuit.diagnostics || []), ...layoutDiagnostics];
    }
  }

  return circuit;
}

/**
 * Re-routes specified circuit wires (or all wires if wireIds omitted) using obstacle-avoiding
 * orthogonal Manhattan routing without modifying any component or node positions.
 */
export function rerouteCircuitWires(
  circuit: KirchhoffCircuit,
  wireIds?: string[],
  options: { snapGrid?: number; forceAll?: boolean } = {},
): KirchhoffCircuit {
  const result = cloneCircuit(circuit);
  const snapStep = options.snapGrid ?? 0.5;
  const targetIds = wireIds ? new Set(wireIds) : null;

  const nodeToComps: Record<string, Array<{ comp: CircuitComponent; portId: string }>> = {};
  for (const comp of Object.values(result.components)) {
    for (const [pId, nId] of Object.entries(comp.ports)) {
      if (!nodeToComps[nId]) nodeToComps[nId] = [];
      nodeToComps[nId].push({ comp, portId: pId });
    }
  }

  for (const wire of result.wires) {
    if (targetIds && !targetIds.has(wire.id)) continue;
    if (!targetIds && !options.forceAll && wire.userEdited) continue;

    const fromNode = result.nodes[wire.fromNode];
    const toNode = result.nodes[wire.toNode];
    if (!fromNode || !toNode) continue;

    const fromComps = nodeToComps[wire.fromNode] || [];
    const toComps = nodeToComps[wire.toNode] || [];
    const fromCompId = fromComps.length === 1 ? fromComps[0].comp.id : undefined;
    const toCompId = toComps.length === 1 ? toComps[0].comp.id : undefined;
    const endpointCompIds = new Set<string>();
    for (const fc of fromComps) endpointCompIds.add(fc.comp.id);
    for (const tc of toComps) endpointCompIds.add(tc.comp.id);

    let preferHV = true;
    if (fromComps.length === 1) {
      const def = COMPONENT_CATALOG[fromComps[0].comp.type];
      const p = def?.ports.find((port) => port.id === fromComps[0].portId);
      if (p && Math.abs(p.x) < Math.abs(p.y)) {
        preferHV = false;
      }
    }

    const layoutDiagnostics: CircuitDiagnostic[] = [];
    const waypoints = routeWireBetweenPoints(
      { x: fromNode.x, y: fromNode.y },
      { x: toNode.x, y: toNode.y },
      result,
      {
        fromCompId,
        toCompId,
        endpointCompIds,
        ignoreNodeIds: new Set([wire.fromNode, wire.toNode]),
        ignoreWireId: wire.id,
        preferHV,
        snapGrid: snapStep,
        diagnostics: layoutDiagnostics,
      },
    );

    wire.waypoints = waypoints.length > 0 ? waypoints : undefined;
    wire.direct = false;
    if (layoutDiagnostics.length > 0) {
      result.diagnostics = [...(result.diagnostics || []), ...layoutDiagnostics];
    }
  }

  return result;
}

export { autoLayoutCircuit as layoutCircuit };

export interface RoutedTerminalLead {
  componentId: string;
  portId: string;
  nodeId: string;
  pathD: string;
  waypoints: Array<{ x: number; y: number }>;
  points: Array<{ x: number; y: number }>;
}

/**
 * Computes obstacle-avoiding orthogonal routes for all component terminal leads in a circuit.
 * Ensures leads from distinct electrical nets do not share overlapping paths.
 */
function connectedWireNodes(circuit: KirchhoffCircuit, start: string): Set<string> {
  const nodes = new Set([start]);
  const pending = [start];
  while (pending.length) {
    const id = pending.pop()!;
    for (const wire of circuit.wires) {
      const other = wire.fromNode === id ? wire.toNode : wire.toNode === id ? wire.fromNode : null;
      if (other && !nodes.has(other)) { nodes.add(other); pending.push(other); }
    }
  }
  return nodes;
}

export function routeAllTerminalLeads(circuit: KirchhoffCircuit): RoutedTerminalLead[] {
  const gridSize = circuit.gridSize || 20;
  const routedLeads: RoutedTerminalLead[] = [];
  const leadObstacles: WireObstacleSegment[] = [];

  for (const comp of Object.values(circuit.components)) {
    for (const [pId, nId] of Object.entries(comp.ports)) {
      const node = circuit.nodes[nId];
      if (!node) continue;
      const ppos = getComponentPortPosition(comp, pId);
      if (!ppos) continue;
      const dist = Math.hypot(ppos.x - node.x, ppos.y - node.y);
      if (dist > 0.05) {
        const endpointCompIds = new Set<string>([comp.id]);
        for (const c of Object.values(circuit.components)) {
          if (Object.values(c.ports).includes(nId)) {
            endpointCompIds.add(c.id);
          }
        }
        const toComp = Object.values(circuit.components).find(
          (c) => c.id !== comp.id && Object.values(c.ports).includes(nId),
        );
        const waypoints = routeWireBetweenPoints(
          ppos,
          { x: node.x, y: node.y },
          circuit,
          {
            fromCompId: comp.id,
            toCompId: toComp?.id,
            endpointCompIds,
            ignoreNodeIds: connectedWireNodes(circuit, nId),
            netId: nId,
            additionalObstacles: leadObstacles,
          },
        );
        const pts = [ppos, ...waypoints, { x: node.x, y: node.y }];
        let leadD = `M ${pts[0].x * gridSize} ${pts[0].y * gridSize}`;
        for (let i = 1; i < pts.length; i++) {
          leadD += ` L ${pts[i].x * gridSize} ${pts[i].y * gridSize}`;
        }
        routedLeads.push({
          componentId: comp.id,
          portId: pId,
          nodeId: nId,
          pathD: leadD,
          waypoints,
          points: pts,
        });

        for (let i = 0; i < pts.length - 1; i++) {
          leadObstacles.push({
            x1: pts[i].x,
            y1: pts[i].y,
            x2: pts[i + 1].x,
            y2: pts[i + 1].y,
            netId: nId,
          });
        }
      }
    }
  }

  return routedLeads;
}

