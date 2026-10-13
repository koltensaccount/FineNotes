import { stripMathDelimiters } from "./math-label";
/**
 * Bidirectional CircuitikZ LaTeX serializer and parser.
 *
 * Implements deterministic conversion between Kirchhoff IR (v1.0) and
 * standard LaTeX CircuitikZ markup suitable for Overleaf and TeX engines.
 */

import {
  type CircuitComponent,
  type ComponentType,
  type KirchhoffCircuit,
  COMPONENT_CATALOG,
  createEmptyCircuit,
  validateAndNormalizeCircuit,
  getComponentPortPosition,
} from "./ir";
import { routeAllTerminalLeads } from "./layout";

/** Mapping of Kirchhoff component types to CircuitikZ bipole / symbol names */
const TIKZ_TYPE_MAP: Record<string, string> = {
  resistor: "R",
  variable_resistor: "vR",
  capacitor: "C",
  polarized_capacitor: "eC",
  variable_capacitor: "vC",
  inductor: "L",
  vsource: "sV",
  vsource_dc: "V",
  battery: "battery1",
  isource: "I",
  diode: "D",
  zener_diode: "zD",
  led: "leD",
  ground: "ground",
  earth: "earth",
  switch_spst: "closing switch",
  switch_spdt: "cute spdt up",
  lamp: "lamp",
  node_filled: "circ",
  node_open: "ocirc",
  text_label: "node",
  potentiometer: "vR",
  ac_source: "sV",
  fuse: "fuse",
  transformer: "transformer",
  schottky_diode: "sD",
  logic_and: "and gate US",
  logic_or: "or gate US",
  logic_not: "not gate US",
};

/** Reverse mapping from CircuitikZ bipole names to Kirchhoff component types */
const REVERSE_TIKZ_TYPE_MAP: Record<string, ComponentType> = {
  r: "resistor",
  resistor: "resistor",
  vr: "variable_resistor",
  c: "capacitor",
  capacitor: "capacitor",
  ec: "polarized_capacitor",
  vc: "variable_capacitor",
  l: "inductor",
  inductor: "inductor",
  v: "vsource_dc",
  sv: "vsource",
  battery: "battery",
  battery1: "battery",
  battery2: "battery",
  i: "isource",
  d: "diode",
  diode: "diode",
  zd: "zener_diode",
  led: "led",
  ground: "ground",
  earth: "earth",
  lamp: "lamp",
  "closing switch": "switch_spst",
  "open switch": "switch_spst",
  circ: "node_filled",
  ocirc: "node_open",
  potentiometer: "potentiometer",
  fuse: "fuse",
  transformer: "transformer",
  sd: "schottky_diode",
  generic: "generic_box",
};

/** Mapping from component port IDs to standard CircuitikZ named node anchors */
const MULTI_TERMINAL_ANCHORS: Record<string, Record<string, string>> = {
  opamp: {
    in_inv: "-",
    in_noninv: "+",
    out: "out",
    vcc: "up",
    vee: "down",
  },
  transistor_npn: {
    base: "B",
    collector: "C",
    emitter: "E",
  },
  transistor_pnp: {
    base: "B",
    collector: "C",
    emitter: "E",
  },
  transistor_nmos: {
    gate: "G",
    drain: "D",
    source: "S",
  },
  transistor_pmos: {
    gate: "G",
    drain: "D",
    source: "S",
  },
};

/** Reverse mapping from CircuitikZ node anchors to component port IDs */
const REVERSE_MULTI_TERMINAL_ANCHORS: Record<string, Record<string, string>> = {
  opamp: {
    "-": "in_inv",
    "+": "in_noninv",
    out: "out",
    up: "vcc",
    down: "vee",
  },
  transistor_npn: {
    B: "base",
    b: "base",
    C: "collector",
    c: "collector",
    E: "emitter",
    e: "emitter",
  },
  transistor_pnp: {
    B: "base",
    b: "base",
    C: "collector",
    c: "collector",
    E: "emitter",
    e: "emitter",
  },
  transistor_nmos: {
    G: "gate",
    g: "gate",
    D: "drain",
    d: "drain",
    S: "source",
    s: "source",
  },
  transistor_pmos: {
    G: "gate",
    g: "gate",
    D: "drain",
    d: "drain",
    S: "source",
    s: "source",
  },
};

/** Serialize a Kirchhoff circuit to standard CircuitikZ LaTeX */
export function circuitToTikz(circuit: KirchhoffCircuit): string {
  const lines: string[] = [];
  lines.push("\\begin{circuitikz}[american]");

  // Scale factor to convert grid pixels to standard TikZ coordinates (~1cm per unit)
  // Standard grid spacing in TikZ is 1-2 cm.
  const toTikzCoord = (val: number): string => {
    // Round to 2 decimal places
    const v = Math.round(val * 100) / 100;
    return Number.isInteger(v) ? `${v}` : `${v.toFixed(2).replace(/\.?0+$/, "")}`;
  };

  const compVisited = new Set<string>();
  const leadExcludedCompIds = new Set<string>();

  // Emit two-terminal and source components
  for (const comp of Object.values(circuit.components)) {
    const tikzType = TIKZ_TYPE_MAP[comp.type] || "generic";

    if (comp.type === "node_filled" || comp.type === "node_open") {
      const pId = Object.keys(comp.ports)[0] || "p1";
      const connNode = comp.ports[pId];
      const node = connNode ? circuit.nodes[connNode] : null;
      const x = node ? node.x : comp.x;
      const y = node ? -node.y : -comp.y;
      const tikzShape = comp.type === "node_filled" ? "circ" : "ocirc";
      const labelPart = comp.label ? `, label={$${tikzMath(comp.label)}$}` : "";
      lines.push(`  \\draw (${toTikzCoord(x)}, ${toTikzCoord(y)}) node[${tikzShape}${labelPart}] (${comp.id}) {};`);
      compVisited.add(comp.id);
      continue;
    }

    if (comp.type === "text_label") {
      const x = comp.x;
      const y = -comp.y;
      const rawText = comp.label || "";
      const text = rawText.startsWith("$") && rawText.endsWith("$") ? rawText : `$${rawText}$`;
      lines.push(`  \\draw (${toTikzCoord(x)}, ${toTikzCoord(y)}) node (${comp.id}) {${text}};`);
      compVisited.add(comp.id);
      continue;
    }

    if (comp.type === "ground" || comp.type === "earth") {
      const pId = comp.ports["gnd"] ? "gnd" : (comp.ports["earth"] ? "earth" : Object.keys(comp.ports)[0]);
      const gndNode = pId ? comp.ports[pId] : undefined;
      const node = gndNode ? circuit.nodes[gndNode] : null;
      const termPos = pId ? getComponentPortPosition(comp, pId) : null;

      // Anchor CircuitikZ ground node at its terminal connection coordinate
      const termX = termPos ? termPos.x : (node ? node.x : comp.x);
      const termY = termPos ? termPos.y : (node ? node.y : comp.y);

      const dist = node ? Math.hypot(termX - node.x, termY - node.y) : 0;
      const x = dist > 0.05 ? termX : (node ? node.x : termX);
      const y = dist > 0.05 ? -termY : (node ? -node.y : -termY);

      lines.push(`  \\draw (${toTikzCoord(x)}, ${toTikzCoord(y)}) node[${comp.type}] {};`);
      compVisited.add(comp.id);
      continue;
    }

    if (comp.type === "opamp") {
      const x = comp.x;
      const y = -comp.y;
      const opts: string[] = ["op amp"];
      if (comp.label) opts.push(`l=$${tikzMath(comp.label)}$`);
      if (comp.rotation) {
        const tikzRot = ((-comp.rotation % 360) + 360) % 360;
        if (tikzRot !== 0) opts.push(`rotate=${tikzRot}`);
      }
      if (comp.mirror) opts.push("xscale=-1");
      lines.push(`  \\draw (${toTikzCoord(x)}, ${toTikzCoord(y)}) node[${opts.join(", ")}] (${comp.id}) {};`);
      compVisited.add(comp.id);
      continue;
    }

    if (comp.type.startsWith("transistor_")) {
      const x = comp.x;
      const y = -comp.y;
      let qType = "npn";
      if (comp.type === "transistor_pnp") qType = "pnp";
      else if (comp.type === "transistor_nmos") qType = "nmos";
      else if (comp.type === "transistor_pmos") qType = "pmos";

      const opts: string[] = [qType];
      if (comp.label) opts.push(`l=$${tikzMath(comp.label)}$`);
      if (comp.rotation) {
        const tikzRot = ((-comp.rotation % 360) + 360) % 360;
        if (tikzRot !== 0) opts.push(`rotate=${tikzRot}`);
      }
      if (comp.mirror) opts.push("xscale=-1");
      lines.push(`  \\draw (${toTikzCoord(x)}, ${toTikzCoord(y)}) node[${opts.join(", ")}] (${comp.id}) {};`);
      compVisited.add(comp.id);
      continue;
    }

    // Standard two-terminal components
    // Determine terminal positions
    const catalogKeys = COMPONENT_CATALOG[comp.type]?.ports.map((port) => port.id) || [];
    const portKeys = catalogKeys.filter((key) => comp.ports[key]);
    if (portKeys.length >= 2) {
      let p1Key = portKeys[0];
      let p2Key = portKeys[1];

      // Note on polarity convention:
      // For DC sources and batteries, CircuitikZ draws + on the first node of the `to[...]` path
      // if pos is p1, otherwise inverted.
      if (comp.type === "vsource_dc" || comp.type === "battery") {
        if (comp.ports["pos"] && comp.ports["neg"]) {
          p1Key = "pos";
          p2Key = "neg";
        }
      }

      const n1Id = comp.ports[p1Key];
      const n2Id = comp.ports[p2Key];
      const n1 = circuit.nodes[n1Id];
      const n2 = circuit.nodes[n2Id];

      const p1pos = getComponentPortPosition(comp, p1Key);
      const p2pos = getComponentPortPosition(comp, p2Key);

      const compsAtN1 = Object.values(circuit.components).filter((c) =>
        Object.values(c.ports).includes(n1Id),
      );
      const compsAtN2 = Object.values(circuit.components).filter((c) =>
        Object.values(c.ports).includes(n2Id),
      );

      const dist1 = n1 && p1pos ? Math.hypot(p1pos.x - n1.x, p1pos.y - n1.y) : 0;
      const dist2 = n2 && p2pos ? Math.hypot(p2pos.x - n2.x, p2pos.y - n2.y) : 0;

      let x1: number;
      let y1: number;
      let x2: number;
      let y2: number;

      // If this is a lone component between n1 and n2 without shared branch nodes, draw directly between nodes
      if (compsAtN1.length <= 1 && compsAtN2.length <= 1) {
        x1 = n1 ? n1.x : (p1pos ? p1pos.x : comp.x - 1.5);
        y1 = n1 ? -n1.y : (p1pos ? -p1pos.y : -comp.y);
        x2 = n2 ? n2.x : (p2pos ? p2pos.x : comp.x + 1.5);
        y2 = n2 ? -n2.y : (p2pos ? -p2pos.y : -comp.y);
        leadExcludedCompIds.add(comp.id);
      } else {
        // Shared node(s): components with separated terminals use their actual port positions
        x1 = dist1 > 0.05 && p1pos ? p1pos.x : (n1 ? n1.x : (p1pos ? p1pos.x : comp.x - 1.5));
        y1 = dist1 > 0.05 && p1pos ? -p1pos.y : (n1 ? -n1.y : (p1pos ? -p1pos.y : -comp.y));
        x2 = dist2 > 0.05 && p2pos ? p2pos.x : (n2 ? n2.x : (p2pos ? p2pos.x : comp.x + 1.5));
        y2 = dist2 > 0.05 && p2pos ? -p2pos.y : (n2 ? -n2.y : (p2pos ? -p2pos.y : -comp.y));
      }

      // Build options string
      const opts: string[] = [tikzType];
      if (comp.label) {
        opts.push(`l=$${tikzMath(comp.label)}$`);
      }
      if (comp.value) {
        opts.push(`v=$${tikzMath(comp.value)}$`);
      }

      lines.push(
        `  \\draw (${toTikzCoord(x1)}, ${toTikzCoord(y1)}) to[${opts.join(", ")}] (${toTikzCoord(x2)}, ${toTikzCoord(y2)});`,
      );
      compVisited.add(comp.id);
    }
  }

  // Emit routed terminal leads (connecting component ports to nodes when separated by layout)
  const leads = routeAllTerminalLeads(circuit);
  for (const lead of leads) {
    if (leadExcludedCompIds.has(lead.componentId)) continue;
    if (lead.points.length < 2) continue;
    const comp = circuit.components[lead.componentId];
    const anchor = comp ? MULTI_TERMINAL_ANCHORS[comp.type]?.[lead.portId] : undefined;
    const startStr = anchor
      ? `(${comp.id}.${anchor})`
      : `(${toTikzCoord(lead.points[0].x)}, ${toTikzCoord(-lead.points[0].y)})`;
    let pathStr = startStr;
    for (let i = 1; i < lead.points.length; i++) {
      pathStr += ` -- (${toTikzCoord(lead.points[i].x)}, ${toTikzCoord(-lead.points[i].y)})`;
    }
    lines.push(`  \\draw ${pathStr};`);
  }

  const getAnchorForNode = (nodeId: string): string | null => {
    for (const comp of Object.values(circuit.components)) {
      const anchors = MULTI_TERMINAL_ANCHORS[comp.type];
      if (!anchors) continue;
      for (const [pId, nId] of Object.entries(comp.ports)) {
        if (nId === nodeId && anchors[pId]) {
          const ppos = getComponentPortPosition(comp, pId);
          const node = circuit.nodes[nodeId];
          if (node && ppos && Math.hypot(ppos.x - node.x, ppos.y - node.y) <= 0.05) {
            return `(${comp.id}.${anchors[pId]})`;
          }
        }
      }
    }
    return null;
  };

  // Emit wires
  for (const wire of circuit.wires) {
    const from = circuit.nodes[wire.fromNode];
    const to = circuit.nodes[wire.toNode];
    if (!from || !to) continue;

    const fromAnchor = getAnchorForNode(wire.fromNode);
    const toAnchor = getAnchorForNode(wire.toNode);

    let pathStr = fromAnchor || `(${toTikzCoord(from.x)}, ${toTikzCoord(-from.y)})`;
    if (!wire.direct && wire.waypoints && wire.waypoints.length > 0) {
      for (const wp of wire.waypoints) {
        pathStr += ` -- (${toTikzCoord(wp.x)}, ${toTikzCoord(-wp.y)})`;
      }
      pathStr += ` -- ${toAnchor || `(${toTikzCoord(to.x)}, ${toTikzCoord(-to.y)})`}`;
    } else if (!wire.direct && Math.abs(from.x - to.x) > 0.01 && Math.abs(from.y - to.y) > 0.01) {
      pathStr += ` -| ${toAnchor || `(${toTikzCoord(to.x)}, ${toTikzCoord(-to.y)})`}`;
    } else {
      pathStr += ` -- ${toAnchor || `(${toTikzCoord(to.x)}, ${toTikzCoord(-to.y)})`}`;
    }

    lines.push(`  \\draw ${pathStr};`);
  }

  // Emit junction nodes
  for (const node of Object.values(circuit.nodes)) {
    if (node.junction) {
      lines.push(`  \\node[circ] at (${toTikzCoord(node.x)}, ${toTikzCoord(-node.y)}) {};`);
    }
  }

  lines.push("\\end{circuitikz}");
  return lines.join("\n");
}

export interface TikzParseResult {
  circuit: KirchhoffCircuit;
  diagnostics: Array<{ line: number; message: string; severity: "error" | "warning" }>;
}

/** Parse a supported subset of CircuitikZ LaTeX back into a KirchhoffCircuit */
export function tikzToCircuit(tikzCode: string): TikzParseResult {
  const diagnostics: TikzParseResult["diagnostics"] = [];
  const circuit = createEmptyCircuit();

  const lines = tikzCode.split("\n");

  let nodeCounter = 1;
  let compCounter = 1;
  let wireCounter = 1;

  // Helper to find or create a node at coordinates
  const getOrCreateNode = (x: number, y: number, preferredId?: string): string => {
    for (const [id, n] of Object.entries(circuit.nodes)) {
      if (Math.abs(n.x - x) < 0.05 && Math.abs(n.y - y) < 0.05) {
        return id;
      }
    }
    if (preferredId && !circuit.nodes[preferredId]) {
      circuit.nodes[preferredId] = { id: preferredId, x, y };
      return preferredId;
    }
    while (circuit.nodes[`n${nodeCounter}`]) {
      nodeCounter++;
    }
    const id = `n${nodeCounter++}`;
    circuit.nodes[id] = { id, x, y };
    return id;
  };

  const parseCoord = (str: string, invertY = false): number => {
    const n = parseFloat(str);
    const res = invertY ? -n : n;
    return Object.is(res, -0) ? 0 : res;
  };

  // Pre-scan all explicit component names so generated IDs never collide with them
  const reservedCompIds = new Set<string>();
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("%")) continue;
    const nodeElemMatch = trimmed.match(
      /^(?:\\draw\s*\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)\s*node\[[^\]]+\](?:\s*\(([a-zA-Z0-9_-]+)\))?|\\node\[[^\]]+\]\s*at\s*\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)(?:\s*\(([a-zA-Z0-9_-]+)\))?)\s*\{\s*\}\s*;/i,
    );
    if (nodeElemMatch) {
      const explicitId = nodeElemMatch[1] ?? nodeElemMatch[2];
      if (explicitId) reservedCompIds.add(explicitId);
    }
  }

  const tikzNameToCompId = new Map<string, string>();

  const getNextCompId = (preferredId?: string): string => {
    if (preferredId && !circuit.components[preferredId]) {
      return preferredId;
    }
    while (circuit.components[`c${compCounter}`] || reservedCompIds.has(`c${compCounter}`)) {
      compCounter++;
    }
    return `c${compCounter++}`;
  };

  const getNextWireId = (): string => {
    while (circuit.wires.some((w) => w.id === `w${wireCounter}`)) {
      wireCounter++;
    }
    return `w${wireCounter++}`;
  };

  const handledLines = new Set<number>();

  // Pass 1: Parse all components (bipoles, grounds, transistors, opamps)
  for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
    const rawLine = lines[lineNum - 1].trim();
    if (!rawLine || rawLine.startsWith("%")) continue;
    if (rawLine.includes("\\begin{circuitikz}") || rawLine.includes("\\end{circuitikz}")) continue;

    // 1. Two-terminal / bipole component: \draw (x1, y1) to[TYPE, opts...] (x2, y2);
    const bipoleMatch = rawLine.match(
      /\\draw\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*to\[([^\]]+)\]\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*;/i,
    );

    if (bipoleMatch) {
      const x1 = parseCoord(bipoleMatch[1]);
      const y1 = parseCoord(bipoleMatch[2], true); // Invert Y back to page coordinates
      const optsString = bipoleMatch[3];
      const x2 = parseCoord(bipoleMatch[4]);
      const y2 = parseCoord(bipoleMatch[5], true);

      const optTokens = optsString.split(",").map((s) => s.trim());
      const rawType = (optTokens[0] || "R").toLowerCase();
      const compType = REVERSE_TIKZ_TYPE_MAP[rawType];
      if (rawType === "short" || rawType === "wire") {
        circuit.wires.push({ id: getNextWireId(), fromNode: getOrCreateNode(x1, y1), toNode: getOrCreateNode(x2, y2), direct: true });
        handledLines.add(lineNum);
        continue;
      }
      if (!compType) {
        diagnostics.push({ line: lineNum, severity: "error", message: `Unsupported component type "${rawType}"; circuit was not applied.` });
        handledLines.add(lineNum);
        continue;
      }

      let label = "";
      let value = "";

      for (const opt of optTokens.slice(1)) {
        const lMatch = opt.match(/^l\s*=\s*\$?([^$]+)\$?$/i);
        if (lMatch) label = lMatch[1].trim();
        const vMatch = opt.match(/^v\s*=\s*\$?([^$]+)\$?$/i);
        if (vMatch) value = vMatch[1].trim();
      }

      const n1Id = getOrCreateNode(x1, y1);
      const n2Id = getOrCreateNode(x2, y2);

      const compId = getNextCompId();
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;

      // Relative to this symbol's catalog axis (sources are vertical at rotation 0).
      const def = COMPONENT_CATALOG[compType];
      if (def.ports.length !== 2) {
        diagnostics.push({ line: lineNum, severity: "error", message: `Use node syntax for "${rawType}"; it is not a two-terminal component.` });
        handledLines.add(lineNum);
        continue;
      }
      const [firstPort, secondPort] = def.ports;
      const angleRad = Math.atan2(y2 - y1, x2 - x1);
      const localAngle = Math.atan2(secondPort.y - firstPort.y, secondPort.x - firstPort.x);
      const angleDeg = Math.round((angleRad - localAngle) * 180 / Math.PI * 100) / 100;
      const rotation = ((angleDeg % 360) + 360) % 360;

      circuit.components[compId] = {
        id: compId,
        type: compType,
        label: label || `C${compId.replace(/\D/g, "") || compCounter}`,
        value: value || undefined,
        x: cx,
        y: cy,
        rotation,
        ports: {
          [firstPort.id]: n1Id,
          [secondPort.id]: n2Id,
        },
      };
      handledLines.add(lineNum);
      continue;
    }

    // 2. Node element: \node[circ] at (x, y) {}; or \draw (x, y) node[op amp...] (id) {};
    const nodeElemMatch = rawLine.match(
      /^(?:\\draw\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*node\[([^\]]+)\](?:\s*\(([a-zA-Z0-9_-]+)\))?|\\node\[([^\]]+)\]\s*at\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)(?:\s*\(([a-zA-Z0-9_-]+)\))?)\s*\{\s*\}\s*;/i,
    );
    if (nodeElemMatch) {
      const xStr = nodeElemMatch[1] ?? nodeElemMatch[6];
      const yStr = nodeElemMatch[2] ?? nodeElemMatch[7];
      const optsStr = nodeElemMatch[3] ?? nodeElemMatch[5];
      const explicitId = nodeElemMatch[4] ?? nodeElemMatch[8];
      const x = parseCoord(xStr);
      const y = parseCoord(yStr, true);

      const optTokens = optsStr.split(",").map((s) => s.trim());
      const rawType = (optTokens[0] || "").toLowerCase();

      if (rawType === "circ" && optTokens.length === 1 && !explicitId) {
        const nId = getOrCreateNode(x, y);
        circuit.nodes[nId].junction = true;
        handledLines.add(lineNum);
      } else if (rawType === "circ" || rawType === "ocirc") {
        const isFilled = rawType === "circ";
        const nId = getOrCreateNode(x, y);
        const compId = getNextCompId(explicitId || (isFilled ? "N" : "T"));
        let label = "";
        for (const opt of optTokens.slice(1)) {
          const lMatch = opt.match(/^label\s*=\s*(?:\{?\$?([^$}]+)\$?\}?|\$?([^$]+)\$?)$/i);
          if (lMatch) label = (lMatch[1] || lMatch[2] || "").trim();
        }
        circuit.components[compId] = {
          id: compId,
          type: isFilled ? "node_filled" : "node_open",
          label: label || (isFilled ? "N1" : "T1"),
          x,
          y,
          rotation: 0,
          ports: { p1: nId },
        };
        if (explicitId) {
          tikzNameToCompId.set(explicitId, compId);
        }
        handledLines.add(lineNum);
      } else if (rawType === "ground" || rawType === "earth") {
        const isEarth = rawType === "earth";
        const pId = isEarth ? "earth" : "gnd";
        const nId = getOrCreateNode(x, y);
        const compId = getNextCompId(explicitId || pId);
        circuit.components[compId] = {
          id: compId,
          type: isEarth ? "earth" : "ground",
          label: isEarth ? "EARTH" : "GND",
          x,
          y: y + 0.8,
          rotation: 0,
          ports: { [pId]: nId },
        };
        if (explicitId) {
          tikzNameToCompId.set(explicitId, compId);
        }
        handledLines.add(lineNum);
      } else {
        let multiType: ComponentType | undefined;
        if (rawType === "op amp" || rawType === "opamp") {
          multiType = "opamp";
        } else if (rawType === "npn") {
          multiType = "transistor_npn";
        } else if (rawType === "pnp") {
          multiType = "transistor_pnp";
        } else if (rawType === "nmos") {
          multiType = "transistor_nmos";
        } else if (rawType === "pmos") {
          multiType = "transistor_pmos";
        }

        if (multiType) {
          let label = "";
          let rotation = 0;
          let mirror = false;
          for (const opt of optTokens.slice(1)) {
            const lMatch = opt.match(/^l\s*=\s*\$?([^$]+)\$?$/i);
            if (lMatch) label = lMatch[1].trim();
            const rMatch = opt.match(/^rotate\s*=\s*(-?\d+)$/i);
            if (rMatch) {
              const rawRot = parseInt(rMatch[1], 10);
              rotation = ((-rawRot % 360) + 360) % 360;
            }
            if (/xscale\s*=\s*-1/i.test(opt)) mirror = true;
          }

          const compId = getNextCompId(explicitId);
          const catalogEntry = COMPONENT_CATALOG[multiType];
          const ports: Record<string, string> = {};

          const comp: CircuitComponent = {
            id: compId,
            type: multiType,
            label: label || catalogEntry?.defaultLabel || compId,
            x,
            y,
            rotation,
            mirror: mirror || undefined,
            ports,
          };

          circuit.components[compId] = comp;
          if (explicitId) {
            tikzNameToCompId.set(explicitId, compId);
          }
          handledLines.add(lineNum);
        }
      }
      continue;
    }

    // 2b. Standalone text node: \draw (x, y) node (id) {text}; or \node at (x, y) {text};
    const textNodeMatch = rawLine.match(
      /^(?:\\draw\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*node(?:\s*\[([^\]]*)\])?(?:\s*\(([a-zA-Z0-9_-]+)\))?\s*\{(.*)\}\s*;|\\node(?:\s*\[([^\]]*)\])?\s*at\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)(?:\s*\(([a-zA-Z0-9_-]+)\))?\s*\{(.*)\}\s*;)/i,
    );
    if (textNodeMatch) {
      const xStr = textNodeMatch[1] ?? textNodeMatch[7];
      const yStr = textNodeMatch[2] ?? textNodeMatch[8];
      const explicitId = textNodeMatch[4] ?? textNodeMatch[9];
      const rawContent = (textNodeMatch[5] ?? textNodeMatch[10] ?? "").trim();
      const x = parseCoord(xStr);
      const y = parseCoord(yStr, true);
      const labelText = rawContent.replace(/^\$|\$$/g, "").trim();
      if (labelText) {
        const compId = getNextCompId(explicitId || "L");
        circuit.components[compId] = {
          id: compId,
          type: "text_label",
          label: labelText,
          x,
          y,
          rotation: 0,
          ports: {},
        };
        if (explicitId) {
          tikzNameToCompId.set(explicitId, compId);
        }
        handledLines.add(lineNum);
        continue;
      }
    }
  }

  // Pass 2: Parse wires and record diagnostics for unsupported commands
  for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
    const rawLine = lines[lineNum - 1].trim();
    if (!rawLine || rawLine.startsWith("%")) continue;
    if (rawLine.includes("\\begin{circuitikz}") || rawLine.includes("\\end{circuitikz}")) continue;

    // Skip lines already successfully handled in Pass 1
    if (handledLines.has(lineNum)) {
      continue;
    }

    // 3. Wire (simple or multi-segment with waypoints, preserving distinct subpaths):
    // e.g. \draw (x1, y1) -- (x2, y2) (x3, y3) -- (x4, y4);
    if (
      rawLine.startsWith("\\draw") &&
      (rawLine.includes("--") || rawLine.includes("-|") || rawLine.includes("|-")) &&
      !rawLine.includes("to[") &&
      !rawLine.includes("to [") &&
      !rawLine.includes("node[")
    ) {
      const pathBody = rawLine.replace(/^\\draw(?:\s*\[[^\]]*\])?\s*/i, "");
      const tokenRegex =
        /\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)|\(\s*([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_+-]+)\s*\)|(--|-\||\|-)|(cycle)|(;)/gi;
      const subpaths: Array<Array<{ x: number; y: number; nodeId?: string }>> = [];
      let currentSubpath: Array<{ x: number; y: number; nodeId?: string }> = [];
      let hasConnector = false;
      let lastConnector: string | null = null;

      let match: RegExpExecArray | null;
      while ((match = tokenRegex.exec(pathBody)) !== null) {
        if (match[1] !== undefined && match[2] !== undefined) {
          // Coordinate (x, y)
          const pt: { x: number; y: number; nodeId?: string } = {
            x: parseCoord(match[1]),
            y: parseCoord(match[2], true),
          };
          if (hasConnector && currentSubpath.length > 0) {
            if (lastConnector === "-|") {
              const prev = currentSubpath[currentSubpath.length - 1];
              currentSubpath.push({ x: pt.x, y: prev.y });
            } else if (lastConnector === "|-") {
              const prev = currentSubpath[currentSubpath.length - 1];
              currentSubpath.push({ x: prev.x, y: pt.y });
            }
            currentSubpath.push(pt);
            hasConnector = false;
            lastConnector = null;
          } else {
            // Move-to: starts a new subpath
            if (currentSubpath.length >= 2) {
              subpaths.push(currentSubpath);
            }
            currentSubpath = [pt];
            hasConnector = false;
            lastConnector = null;
          }
        } else if (match[3] !== undefined && match[4] !== undefined) {
          // Named anchor (compId.anchor)
          const rawCompName = match[3];
          const anchor = match[4];
          const resolvedCompId = tikzNameToCompId.get(rawCompName) || rawCompName;
          const comp = circuit.components[resolvedCompId];
          let pt: { x: number; y: number; nodeId?: string } | null = null;
          if (comp) {
            const portId = REVERSE_MULTI_TERMINAL_ANCHORS[comp.type]?.[anchor];
            if (portId) {
              if (!comp.ports[portId]) {
                const portPos = getComponentPortPosition(comp, portId);
                const pNodeId = getOrCreateNode(portPos ? portPos.x : comp.x, portPos ? portPos.y : comp.y);
                comp.ports[portId] = pNodeId;
              }
              const node = circuit.nodes[comp.ports[portId]];
              if (node) {
                pt = { x: node.x, y: node.y, nodeId: node.id };
              }
            }
          }
          if (!pt) {
            diagnostics.push({
              line: lineNum,
              message: `Unresolved component anchor: (${rawCompName}.${anchor})`,
              severity: "error",
            });
            currentSubpath = [];
            hasConnector = false;
            lastConnector = null;
            continue;
          }
          if (hasConnector && currentSubpath.length > 0) {
            if (lastConnector === "-|") {
              const prev = currentSubpath[currentSubpath.length - 1];
              currentSubpath.push({ x: pt.x, y: prev.y });
            } else if (lastConnector === "|-") {
              const prev = currentSubpath[currentSubpath.length - 1];
              currentSubpath.push({ x: prev.x, y: pt.y });
            }
            currentSubpath.push(pt);
            hasConnector = false;
            lastConnector = null;
          } else {
            if (currentSubpath.length >= 2) {
              subpaths.push(currentSubpath);
            }
            currentSubpath = [pt];
            hasConnector = false;
            lastConnector = null;
          }
        } else if (match[5] !== undefined) {
          // Connector: --, -|, or |-
          if (currentSubpath.length > 0) {
            hasConnector = true;
            lastConnector = match[5];
          }
        } else if (match[6] !== undefined) {
          // cycle
          if (currentSubpath.length > 0) {
            currentSubpath.push({ ...currentSubpath[0] });
            subpaths.push(currentSubpath);
            currentSubpath = [];
            hasConnector = false;
            lastConnector = null;
          }
        } else if (match[7] !== undefined) {
          // Semicolon ;
          if (currentSubpath.length >= 2) {
            subpaths.push(currentSubpath);
          }
          currentSubpath = [];
          hasConnector = false;
          lastConnector = null;
        }
      }

      if (currentSubpath.length >= 2) {
        subpaths.push(currentSubpath);
      }

      if (subpaths.length > 0) {
        for (const points of subpaths) {
          const start = points[0];
          const end = points[points.length - 1];
          const isClosed = points.length >= 3 && Math.hypot(start.x - end.x, start.y - end.y) < 0.05;

          if (isClosed) {
            // Split closed polyline into distinct representable segments across its vertices
            for (let i = 0; i < points.length - 1; i++) {
              const p1 = points[i];
              const p2 = points[i + 1];
              const nFromId = p1.nodeId || getOrCreateNode(p1.x, p1.y);
              const nToId = p2.nodeId || getOrCreateNode(p2.x, p2.y);
              if (nFromId !== nToId) {
                const isDiagonal = Math.abs(p1.x - p2.x) > 0.01 && Math.abs(p1.y - p2.y) > 0.01;
                circuit.wires.push({
                  id: getNextWireId(),
                  fromNode: nFromId,
                  toNode: nToId,
                  direct: isDiagonal ? true : undefined,
                });
              }
            }
          } else {
            const n1Id = start.nodeId || getOrCreateNode(start.x, start.y);
            const n2Id = end.nodeId || getOrCreateNode(end.x, end.y);
            const waypoints =
              points.length > 2 ? points.slice(1, -1).map((p) => ({ x: p.x, y: p.y })) : undefined;
            const isDiagonal =
              !waypoints && Math.abs(start.x - end.x) > 0.01 && Math.abs(start.y - end.y) > 0.01;

            circuit.wires.push({
              id: getNextWireId(),
              fromNode: n1Id,
              toNode: n2Id,
              waypoints,
              direct: isDiagonal ? true : undefined,
            });
          }
        }
        continue;
      }
    }

    // If a line is not recognized
    diagnostics.push({
      line: lineNum,
      message: `Unsupported or unparseable TikZ command: ${rawLine.slice(0, 40)}`,
      severity: "warning",
    });
  }

  // Post-pass: Split multi-segment wires at intermediate nodes referenced by components, other wire endpoints, or junctions
  const referencedNodeCoords: Array<{ id: string; x: number; y: number }> = [];
  for (const comp of Object.values(circuit.components)) {
    for (const nId of Object.values(comp.ports)) {
      const node = circuit.nodes[nId];
      if (node && !referencedNodeCoords.some((r) => r.id === node.id)) {
        referencedNodeCoords.push({ id: node.id, x: node.x, y: node.y });
      }
    }
  }
  for (const wire of circuit.wires) {
    for (const nId of [wire.fromNode, wire.toNode]) {
      const node = circuit.nodes[nId];
      if (node && !referencedNodeCoords.some((r) => r.id === node.id)) {
        referencedNodeCoords.push({ id: node.id, x: node.x, y: node.y });
      }
    }
  }
  for (const node of Object.values(circuit.nodes)) {
    if (node.junction && !referencedNodeCoords.some((r) => r.id === node.id)) {
      referencedNodeCoords.push({ id: node.id, x: node.x, y: node.y });
    }
  }

  function pointLiesOnSegment(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const segLenSq = dx * dx + dy * dy;
    if (segLenSq < 0.0025) return false; // segLen < 0.05

    // Project (px, py) onto the segment line: P_proj = (x1, y1) + t * (dx, dy)
    const t = ((px - x1) * dx + (py - y1) * dy) / segLenSq;
    const segLen = Math.sqrt(segLenSq);
    const marginT = 0.05 / segLen;

    // t must be strictly inside the segment interior (away from both endpoints)
    if (t < marginT || t > 1 - marginT) return false;

    // Perpendicular distance from (px, py) to the projection on the segment
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    const perpDist = Math.hypot(px - projX, py - projY);

    return perpDist < 0.02;
  }

  const newWires: typeof circuit.wires = [];
  for (const wire of circuit.wires) {
    const fromNode = circuit.nodes[wire.fromNode];
    const toNode = circuit.nodes[wire.toNode];
    if (!fromNode || !toNode) {
      newWires.push(wire);
      continue;
    }

    // Build initial polyline path: fromNode -> waypoints -> toNode
    const initialPoints: Array<{ x: number; y: number; nodeId?: string }> = [
      { x: fromNode.x, y: fromNode.y, nodeId: fromNode.id },
      ...(wire.waypoints || []).map((wp) => {
        const exactMatch = referencedNodeCoords.find(
          (rn) => Math.hypot(rn.x - wp.x, rn.y - wp.y) < 0.05,
        );
        return { x: wp.x, y: wp.y, nodeId: exactMatch?.id };
      }),
      { x: toNode.x, y: toNode.y, nodeId: toNode.id },
    ];

    // Expand segments with any referenced branch nodes lying along the segment
    const expandedPoints: Array<{ x: number; y: number; nodeId?: string }> = [];
    for (let i = 0; i < initialPoints.length - 1; i++) {
      const p1 = initialPoints[i];
      const p2 = initialPoints[i + 1];
      expandedPoints.push(p1);

      // Find any referenced nodes that lie strictly on the segment between p1 and p2
      const onSegmentNodes: Array<{ id: string; x: number; y: number; dist: number }> = [];
      for (const rn of referencedNodeCoords) {
        if (
          pointLiesOnSegment(rn.x, rn.y, p1.x, p1.y, p2.x, p2.y) &&
          rn.id !== p1.nodeId &&
          rn.id !== p2.nodeId
        ) {
          const dist = Math.hypot(rn.x - p1.x, rn.y - p1.y);
          onSegmentNodes.push({ id: rn.id, x: rn.x, y: rn.y, dist });
        }
      }

      onSegmentNodes.sort((a, b) => a.dist - b.dist);
      for (const osn of onSegmentNodes) {
        expandedPoints.push({ x: osn.x, y: osn.y, nodeId: osn.id });
      }
    }
    expandedPoints.push(initialPoints[initialPoints.length - 1]);

    // Split polyline into wires at each node reference
    let currentFromId = wire.fromNode;
    let currentWaypoints: Array<{ x: number; y: number }> = [];

    for (let i = 1; i < expandedPoints.length; i++) {
      const pt = expandedPoints[i];
      if (pt.nodeId) {
        const fromN = circuit.nodes[currentFromId];
        const toN = circuit.nodes[pt.nodeId];
        const isDiagonal =
          currentWaypoints.length === 0 &&
          fromN &&
          toN &&
          Math.abs(fromN.x - toN.x) > 0.01 &&
          Math.abs(fromN.y - toN.y) > 0.01;

        newWires.push({
          id: getNextWireId(),
          fromNode: currentFromId,
          toNode: pt.nodeId,
          waypoints: currentWaypoints.length > 0 ? currentWaypoints : undefined,
          direct: wire.direct || isDiagonal ? true : undefined,
        });
        currentFromId = pt.nodeId;
        currentWaypoints = [];
      } else {
        currentWaypoints.push({ x: pt.x, y: pt.y });
      }
    }
  }
  circuit.wires = newWires;

  return {
    circuit: validateAndNormalizeCircuit(circuit),
    diagnostics,
  };
}

/** Match inline SVG notation and avoid nested math delimiters in CircuitikZ. */
function tikzMath(source: string): string {
  return stripMathDelimiters(source);
}
