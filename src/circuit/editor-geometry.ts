/** Editor geometry is explicit. Electrical membership comes only from endpoint IDs, never crossings. */
import { getComponentPortPosition, type KirchhoffCircuit, type CircuitWire } from "./ir";
import { routeAllTerminalLeads } from "./layout";
import {
  getWirePolyline,
  dragWireSegment,
  isMovableJunction,
  simplifyWaypoints,
} from "./wire-geometry";

function fresh(c: KirchhoffCircuit, prefix: string): string {
  let i = 1;
  while (c.nodes[`${prefix}${i}`] || c.wires.some((w) => w.id === `${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

/** Backward-compatible editor normalization: generated leads become ordinary persistent wires. */
export function materializeCircuitGeometry(c: KirchhoffCircuit): void {
  const leads = routeAllTerminalLeads(c);
  for (const wire of c.wires) {
    if (!wire.direct) wire.waypoints = getWirePolyline(wire, c.nodes).slice(1, -1);
    wire.userEdited = true;
  }
  for (const comp of Object.values(c.components))
    for (const [port, nodeId] of Object.entries(comp.ports)) {
      const node = c.nodes[nodeId],
        at = getComponentPortPosition(comp, port);
      if (!node || !at) continue;
      const shared = Object.values(c.components).some(
        (other) => other.id !== comp.id && Object.values(other.ports).includes(nodeId),
      );
      const degree = c.wires.filter((w) => w.fromNode === nodeId || w.toNode === nodeId).length;
      if (
        !shared &&
        !node.junction &&
        degree <= 1 &&
        Math.hypot(at.x - node.x, at.y - node.y) < 0.001
      )
        continue;
      const anchor = fresh(c, "terminal_");
      c.nodes[anchor] = { id: anchor, x: at.x, y: at.y };
      comp.ports[port] = anchor;
      const lead = leads.find((l) => l.componentId === comp.id && l.portId === port);
      c.wires.push({
        id: fresh(c, "lead_"),
        fromNode: anchor,
        toNode: nodeId,
        waypoints: lead?.waypoints.map((p) => ({ ...p })) ?? [],
        userEdited: true,
      });
    }
  for (const node of Object.values(c.nodes)) {
    if (c.wires.filter((w) => w.fromNode === node.id || w.toNode === node.id).length >= 3)
      node.junction = true;
  }
}

/** Stretch just the end legs from a snapshot; leave unrelated routing and electrical IDs alone. */
export function stretchCircuitWires(c: KirchhoffCircuit, before: KirchhoffCircuit): void {
  for (const wire of c.wires) {
    const old = before.wires.find((w) => w.id === wire.id);
    if (!old) continue;
    const a = c.nodes[wire.fromNode],
      b = c.nodes[wire.toNode],
      oa = before.nodes[old.fromNode],
      ob = before.nodes[old.toNode];
    if (!a || !b || !oa || !ob) continue;
    if (a.x === oa.x && a.y === oa.y && b.x === ob.x && b.y === ob.y) continue;
    const pts = getWirePolyline(old, before.nodes).map((p) => ({ ...p }));
    if (pts.length < 2) continue;
    if (old.direct) {
      wire.waypoints = undefined;
      continue;
    }
    let middle = pts.slice(1, -1);
    if (!middle.length) {
      if (Math.abs(a.x - b.x) > 0.001 && Math.abs(a.y - b.y) > 0.001) {
        const terminal = Object.values(before.components).find((comp) =>
          Object.values(comp.ports).includes(old.fromNode),
        );
        const horizontal =
          Math.hypot(oa.x - ob.x, oa.y - ob.y) < 0.001 && terminal
            ? Math.abs(oa.x - terminal.x) >= Math.abs(oa.y - terminal.y)
            : Math.abs(oa.y - ob.y) < 0.001;
        middle = [horizontal ? { x: b.x, y: a.y } : { x: a.x, y: b.y }];
      }
    } else {
      const first = middle[0],
        last = middle[middle.length - 1];
      if (Math.abs(pts[0].y - pts[1].y) < 0.001) first.y = a.y;
      else first.x = a.x;
      if (Math.abs(pts[pts.length - 2].y - pts[pts.length - 1].y) < 0.001) last.y = b.y;
      else last.x = b.x;
      // One corner cannot follow two parallel end legs: retain each end's independent bend.
      if (
        middle.length === 1 &&
        Math.abs(oa.y - pts[1].y) < 0.001 &&
        Math.abs(ob.y - pts[1].y) < 0.001 &&
        a.y !== b.y
      )
        middle = [
          { x: pts[1].x, y: a.y },
          { x: pts[1].x, y: b.y },
        ];
      if (
        middle.length === 1 &&
        Math.abs(oa.x - pts[1].x) < 0.001 &&
        Math.abs(ob.x - pts[1].x) < 0.001 &&
        a.x !== b.x
      )
        middle = [
          { x: a.x, y: pts[1].y },
          { x: b.x, y: pts[1].y },
        ];
    }
    wire.waypoints = simplifyWaypoints(a, b, middle);
    wire.userEdited = true;
  }
}

export interface WireEndpoint {
  nodeId?: string;
  compId?: string;
  portId?: string;
  wireId?: string;
  point?: { x: number; y: number };
}
/** Project onto actual wire geometry before splitting. A crossing alone never creates a net. */
export function junctionOnWire(
  c: KirchhoffCircuit,
  wireId: string,
  point: { x: number; y: number },
): string | null {
  const wire = c.wires.find((w) => w.id === wireId);
  if (!wire) return null;
  const pts = getWirePolyline(wire, c.nodes);
  let best = Infinity,
    index = 0,
    at = { ...point };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i],
      b = pts[i + 1],
      dx = b.x - a.x,
      dy = b.y - a.y,
      len = dx * dx + dy * dy;
    const t = len
      ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len))
      : 0;
    const p = { x: a.x + t * dx, y: a.y + t * dy },
      dist = Math.hypot(p.x - point.x, p.y - point.y);
    if (dist < best) {
      best = dist;
      index = i;
      at = p;
    }
  }
  const a = pts[index],
    b = pts[index + 1];
  if (a && b && Math.abs(a.y - b.y) < 0.001)
    at.x = Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), Math.round(at.x * 2) / 2));
  if (a && b && Math.abs(a.x - b.x) < 0.001)
    at.y = Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), Math.round(at.y * 2) / 2));
  const first = pts[0],
    last = pts[pts.length - 1];
  if (!first || !last) return null;
  if (Math.hypot(at.x - first.x, at.y - first.y) < 0.05) return wire.fromNode;
  if (Math.hypot(at.x - last.x, at.y - last.y) < 0.05) return wire.toNode;
  const id = fresh(c, "junction_");
  c.nodes[id] = { id, ...at, junction: true };
  const oldTo = wire.toNode;
  const next: CircuitWire = {
    ...wire,
    id: fresh(c, "wire_"),
    fromNode: id,
    toNode: oldTo,
    waypoints: simplifyWaypoints(at, last, pts.slice(index + 1, -1)),
    userEdited: true,
  };
  wire.toNode = id;
  wire.waypoints = simplifyWaypoints(first, at, pts.slice(1, index + 1));
  wire.userEdited = true;
  c.wires.splice(c.wires.indexOf(wire) + 1, 0, next);
  return id;
}

/** Snap a component's first physical terminal, including ground's fractional symbol offset. */
export function snapCircuitComponent(
  c: KirchhoffCircuit,
  id: string,
  x: number,
  y: number,
): { x: number; y: number } {
  const comp = c.components[id];
  if (!comp) return { x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2 };
  const first = Object.keys(comp.ports)[0],
    at = first ? getComponentPortPosition({ ...comp, x: 0, y: 0 }, first) : null;
  return {
    x: Math.round((x + (at?.x ?? 0)) * 2) / 2 - (at?.x ?? 0),
    y: Math.round((y + (at?.y ?? 0)) * 2) / 2 - (at?.y ?? 0),
  };
}

/** Move free junction ends with a dragged segment; physical component terminals stay anchored. */
export function moveCircuitSegment(
  c: KirchhoffCircuit,
  before: KirchhoffCircuit,
  wireId: string,
  index: number,
  coordinate: number,
): void {
  const wire = c.wires.find((w) => w.id === wireId),
    original = before.wires.find((w) => w.id === wireId);
  if (!wire || !original) return;
  const pts = getWirePolyline(original, before.nodes);
  if (index < 0 || index >= pts.length - 1) return;
  const horizontal =
    Math.abs(pts[index].y - pts[index + 1].y) <= Math.abs(pts[index].x - pts[index + 1].x);
  const middle = dragWireSegment(original, before.nodes, index, coordinate);
  for (const [id, move] of [
    [original.fromNode, index === 0],
    [original.toNode, index === pts.length - 2],
  ] as const) {
    if (move && isMovableJunction(before, id)) {
      if (horizontal) c.nodes[id].y = coordinate;
      else c.nodes[id].x = coordinate;
    }
  }
  stretchCircuitWires(c, before);
  wire.waypoints = simplifyWaypoints(c.nodes[wire.fromNode], c.nodes[wire.toNode], middle);
  wire.direct = false;
  wire.userEdited = true;
}

/** Arc order lets two points on one wire split its far end first, retaining the near half's ID. */
export function wirePointOrder(
  c: KirchhoffCircuit,
  id: string,
  p: { x: number; y: number },
): number {
  const w = c.wires.find((w) => w.id === id);
  if (!w) return 0;
  const pts = getWirePolyline(w, c.nodes);
  let best = Infinity,
    order = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i],
      b = pts[i + 1],
      dx = b.x - a.x,
      dy = b.y - a.y,
      len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    const d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    if (d < best) {
      best = d;
      order = i + t;
    }
  }
  return order;
}
