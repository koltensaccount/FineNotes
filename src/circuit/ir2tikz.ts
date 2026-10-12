/**
 * Bidirectional CircuitikZ LaTeX serializer and parser.
 *
 * Implements deterministic conversion between Kirchhoff IR (v1.0) and
 * standard LaTeX CircuitikZ markup suitable for Overleaf and TeX engines.
 */

import {
  type ComponentType,
  type KirchhoffCircuit,
  createEmptyCircuit,
  validateAndNormalizeCircuit,
} from "./ir";

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
  lamp: "lamp",
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

  // Emit two-terminal and source components
  for (const comp of Object.values(circuit.components)) {
    const tikzType = TIKZ_TYPE_MAP[comp.type] || "generic";

    if (comp.type === "ground" || comp.type === "earth") {
      const gndNode = comp.ports["gnd"] || comp.ports["earth"] || Object.values(comp.ports)[0];
      const node = gndNode ? circuit.nodes[gndNode] : null;
      const x = node ? node.x : comp.x;
      const y = node ? -node.y : -comp.y; // Flip Y for standard Cartesian coordinates
      lines.push(`  \\draw (${toTikzCoord(x)}, ${toTikzCoord(y)}) node[${comp.type}] {};`);
      compVisited.add(comp.id);
      continue;
    }

    if (comp.type === "opamp") {
      const x = comp.x;
      const y = -comp.y;
      const label = comp.label ? `, l=${comp.label}` : "";
      lines.push(`  \\draw (${toTikzCoord(x)}, ${toTikzCoord(y)}) node[op amp${label}] (${comp.id}) {};`);
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

      lines.push(`  \\draw (${toTikzCoord(x)}, ${toTikzCoord(y)}) node[${qType}] (${comp.id}) {};`);
      compVisited.add(comp.id);
      continue;
    }

    // Standard two-terminal components
    // Determine terminal positions
    let portKeys = Object.keys(comp.ports);
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

      let x1 = n1 ? n1.x : comp.x - 1.5;
      let y1 = n1 ? -n1.y : -comp.y;
      let x2 = n2 ? n2.x : comp.x + 1.5;
      let y2 = n2 ? -n2.y : -comp.y;

      // Build options string
      const opts: string[] = [tikzType];
      if (comp.label) {
        opts.push(`l=$${comp.label}$`);
      }
      if (comp.value) {
        opts.push(`v=$${comp.value}$`);
      }

      lines.push(
        `  \\draw (${toTikzCoord(x1)}, ${toTikzCoord(y1)}) to[${opts.join(", ")}] (${toTikzCoord(x2)}, ${toTikzCoord(y2)});`,
      );
      compVisited.add(comp.id);
    }
  }

  // Emit wires
  for (const wire of circuit.wires) {
    const from = circuit.nodes[wire.fromNode];
    const to = circuit.nodes[wire.toNode];
    if (!from || !to) continue;

    let pathStr = `(${toTikzCoord(from.x)}, ${toTikzCoord(-from.y)})`;
    if (wire.waypoints) {
      for (const wp of wire.waypoints) {
        pathStr += ` -- (${toTikzCoord(wp.x)}, ${toTikzCoord(-wp.y)})`;
      }
    }
    pathStr += ` -- (${toTikzCoord(to.x)}, ${toTikzCoord(-to.y)})`;

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
  const getOrCreateNode = (x: number, y: number): string => {
    for (const [id, n] of Object.entries(circuit.nodes)) {
      if (Math.abs(n.x - x) < 0.05 && Math.abs(n.y - y) < 0.05) {
        return id;
      }
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
      const compType = REVERSE_TIKZ_TYPE_MAP[rawType] || "resistor";

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

      const compId = `c${compCounter++}`;
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;

      // Approximate rotation
      const angleRad = Math.atan2(y2 - y1, x2 - x1);
      const angleDeg = Math.round((angleRad * 180) / Math.PI / 90) * 90;
      const rotation = ((angleDeg % 360) + 360) % 360;

      circuit.components[compId] = {
        id: compId,
        type: compType,
        label: label || `C${compCounter - 1}`,
        value: value || undefined,
        x: cx,
        y: cy,
        rotation,
        ports: {
          p1: n1Id,
          p2: n2Id,
        },
      };
      continue;
    }

    // 2. Node element: \node[circ] at (x, y) {}; or \node[ground] at (x, y) {};
    const nodeMatch = rawLine.match(
      /\\node\[([^\]]+)\]\s*at\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*\{\s*\}\s*;/i,
    );
    if (nodeMatch) {
      const type = nodeMatch[1].trim().toLowerCase();
      const x = parseCoord(nodeMatch[2]);
      const y = parseCoord(nodeMatch[3], true);

      if (type === "circ") {
        const nId = getOrCreateNode(x, y);
        circuit.nodes[nId].junction = true;
      } else if (type === "ground" || type === "earth") {
        const nId = getOrCreateNode(x, y);
        const compId = `gnd${compCounter++}`;
        circuit.components[compId] = {
          id: compId,
          type: type === "earth" ? "earth" : "ground",
          label: "GND",
          x,
          y,
          rotation: 0,
          ports: { gnd: nId },
        };
      }
      continue;
    }

    // 3. Simple wire: \draw (x1, y1) -- (x2, y2);
    const wireMatch = rawLine.match(
      /\\draw\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*--\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*;/i,
    );
    if (wireMatch) {
      const x1 = parseCoord(wireMatch[1]);
      const y1 = parseCoord(wireMatch[2], true);
      const x2 = parseCoord(wireMatch[3]);
      const y2 = parseCoord(wireMatch[4], true);

      const n1Id = getOrCreateNode(x1, y1);
      const n2Id = getOrCreateNode(x2, y2);

      circuit.wires.push({
        id: `w${wireCounter++}`,
        fromNode: n1Id,
        toNode: n2Id,
      });
      continue;
    }

    // If a line is not recognized
    diagnostics.push({
      line: lineNum,
      message: `Unsupported or unparseable TikZ command: ${rawLine.slice(0, 40)}`,
      severity: "warning",
    });
  }

  return {
    circuit: validateAndNormalizeCircuit(circuit),
    diagnostics,
  };
}
