/**
 * Vector SVG renderer for Kirchhoff IR electrical circuits.
 *
 * Renders complete schematics to crisp standalone SVG strings or DOM nodes,
 * supporting wire routing, junction dots, standard IEEE/IEC component symbols,
 * labels, and values.
 */

import {
  type CircuitComponent,
  COMPONENT_CATALOG,
  type KirchhoffCircuit,
  getComponentPortPosition,
} from "./ir";

export interface SvgRenderOptions {
  theme?: "light" | "dark" | "paper";
  strokeColor?: string;
  wireColor?: string;
  fillColor?: string;
  backgroundColor?: string;
  highlightComponentId?: string;
  highlightNodeId?: string;
  showGrid?: boolean;
  showNodes?: boolean;
  showPorts?: boolean;
  padding?: number;
}

/** Computes the bounding box of the circuit in grid units */
export function computeCircuitBounds(circuit: KirchhoffCircuit): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  let hasPoints = false;

  for (const node of Object.values(circuit.nodes)) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
    hasPoints = true;
  }

  for (const comp of Object.values(circuit.components)) {
    const def = COMPONENT_CATALOG[comp.type];
    const halfW = (def ? def.width : 2) / 2 + 0.5;
    const halfH = (def ? def.height : 2) / 2 + 0.5;
    minX = Math.min(minX, comp.x - halfW);
    maxX = Math.max(maxX, comp.x + halfW);
    minY = Math.min(minY, comp.y - halfH);
    maxY = Math.max(maxY, comp.y + halfH);
    hasPoints = true;
  }

  for (const wire of circuit.wires) {
    if (wire.waypoints) {
      for (const pt of wire.waypoints) {
        minX = Math.min(minX, pt.x);
        maxX = Math.max(maxX, pt.x);
        minY = Math.min(minY, pt.y);
        maxY = Math.max(maxY, pt.y);
        hasPoints = true;
      }
    }
  }

  if (!hasPoints) {
    return { minX: -5, minY: -5, maxX: 5, maxY: 5 };
  }

  // Ensure minimum dimensions
  if (maxX <= minX) {
    minX -= 2;
    maxX += 2;
  }
  if (maxY <= minY) {
    minY -= 2;
    maxY += 2;
  }

  return { minX, minY, maxX, maxY };
}

/** Renders a component's symbol SVG markup at grid unit scale */
function renderComponentSymbol(
  comp: CircuitComponent,
  strokeColor: string,
  isHighlighted: boolean,
  gridSize = 20,
): string {
  const parts: string[] = [];
  const type = comp.type;
  const strokeW = Number(((isHighlighted ? 2.5 : 1.8) / gridSize).toFixed(4));
  const strokeThick = Number(((isHighlighted ? 3.0 : 2.2) / gridSize).toFixed(4));
  const strokeFine = Number(((isHighlighted ? 2.0 : 1.4) / gridSize).toFixed(4));
  const mainStroke = isHighlighted ? "#2563eb" : strokeColor;

  switch (type) {
    case "resistor":
    case "variable_resistor": {
      // Zigzag resistor: (-1.5, 0) to (-0.9, 0) to zigzag to (0.9, 0) to (1.5, 0)
      const d = "M -1.5 0 L -0.9 0 L -0.75 -0.35 L -0.45 0.35 L -0.15 -0.35 L 0.15 0.35 L 0.45 -0.35 L 0.75 0.35 L 0.9 0 L 1.5 0";
      parts.push(`<path d="${d}" fill="none" stroke="${mainStroke}" stroke-width="${strokeW}" stroke-linejoin="round" />`);
      if (type === "variable_resistor") {
        parts.push(`<line x1="-0.7" y1="0.6" x2="0.7" y2="-0.6" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
        parts.push(`<polygon points="0.7,-0.6 0.4,-0.65 0.65,-0.4" fill="${mainStroke}" />`);
      }
      break;
    }

    case "capacitor":
    case "polarized_capacitor":
    case "variable_capacitor": {
      // Parallel plates: left lead (-1, 0) -> (-0.2, 0), plate at x = -0.2; right lead (0.2, 0) -> (1, 0), plate at x = 0.2
      parts.push(`<line x1="-1" y1="0" x2="-0.2" y2="0" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<line x1="-0.2" y1="-0.6" x2="-0.2" y2="0.6" stroke="${mainStroke}" stroke-width="${strokeThick}" />`);
      parts.push(`<line x1="0.2" y1="0" x2="1" y2="0" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<line x1="0.2" y1="-0.6" x2="0.2" y2="0.6" stroke="${mainStroke}" stroke-width="${strokeThick}" />`);
      if (type === "polarized_capacitor") {
        parts.push(`<text x="-0.5" y="-0.4" font-size="0.6" font-family="sans-serif" font-weight="bold" fill="${mainStroke}" text-anchor="middle">+</text>`);
      }
      if (type === "variable_capacitor") {
        parts.push(`<line x1="-0.6" y1="0.7" x2="0.6" y2="-0.7" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
        parts.push(`<polygon points="0.6,-0.7 0.3,-0.75 0.55,-0.5" fill="${mainStroke}" />`);
      }
      break;
    }

    case "inductor": {
      // 4 arcs from -1.5 to 1.5
      const d = "M -1.5 0 L -0.9 0 " +
        "A 0.3 0.3 0 0 1 -0.3 0 " +
        "A 0.3 0.3 0 0 1 0.3 0 " +
        "A 0.3 0.3 0 0 1 0.9 0 " +
        "L 1.5 0";
      parts.push(`<path d="${d}" fill="none" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      break;
    }

    case "vsource":
    case "vsource_dc":
    case "isource": {
      // Circle with diameter 1.6: leads at y = -1.5 to -0.8 and 0.8 to 1.5
      parts.push(`<line x1="0" y1="-1.5" x2="0" y2="-0.8" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<line x1="0" y1="0.8" x2="0" y2="1.5" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<circle cx="0" cy="0" r="0.8" fill="none" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      if (type === "vsource_dc") {
        // + on top, - on bottom
        parts.push(`<text x="0" y="-0.2" font-size="0.6" font-family="sans-serif" font-weight="bold" fill="${mainStroke}" text-anchor="middle">+</text>`);
        parts.push(`<text x="0" y="0.5" font-size="0.7" font-family="sans-serif" font-weight="bold" fill="${mainStroke}" text-anchor="middle">-</text>`);
      } else if (type === "vsource") {
        // Sine wave
        const sine = "M -0.4 0 C -0.2 -0.4, 0 -0.4, 0 0 C 0 0.4, 0.2 0.4, 0.4 0";
        parts.push(`<path d="${sine}" fill="none" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      } else if (type === "isource") {
        // Arrow pointing from in to out (bottom to top)
        parts.push(`<line x1="0" y1="0.5" x2="0" y2="-0.5" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
        parts.push(`<polygon points="0,-0.55 -0.2,-0.2 0.2,-0.2" fill="${mainStroke}" />`);
      }
      break;
    }

    case "battery": {
      // Long line (pos), short thicker line (neg)
      parts.push(`<line x1="0" y1="-1" x2="0" y2="-0.2" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<line x1="-0.7" y1="-0.2" x2="0.7" y2="-0.2" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<line x1="-0.4" y1="0.2" x2="0.4" y2="0.2" stroke="${mainStroke}" stroke-width="${strokeThick}" />`);
      parts.push(`<line x1="0" y1="0.2" x2="0" y2="1" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<text x="0.6" y="-0.3" font-size="0.5" font-family="sans-serif" fill="${mainStroke}">+</text>`);
      break;
    }

    case "diode":
    case "zener_diode":
    case "led": {
      // Triangle pointing right: anode at -1.2, cathode at 1.2
      parts.push(`<line x1="-1.2" y1="0" x2="-0.4" y2="0" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<line x1="0.4" y1="0" x2="1.2" y2="0" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<polygon points="-0.4,-0.5 -0.4,0.5 0.4,0" fill="${mainStroke}" stroke="${mainStroke}" stroke-width="${strokeW}" stroke-linejoin="round" />`);
      if (type === "zener_diode") {
        parts.push(`<path d="M 0.25 -0.7 L 0.4 -0.5 L 0.4 0.5 L 0.55 0.7" fill="none" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      } else {
        parts.push(`<line x1="0.4" y1="-0.5" x2="0.4" y2="0.5" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      }
      if (type === "led") {
        // Light emission arrows
        parts.push(`<line x1="0" y1="-0.6" x2="0.4" y2="-1" stroke="${mainStroke}" stroke-width="${strokeFine}" />`);
        parts.push(`<polygon points="0.4,-1 0.25,-0.95 0.35,-0.85" fill="${mainStroke}" />`);
        parts.push(`<line x1="0.3" y1="-0.4" x2="0.7" y2="-0.8" stroke="${mainStroke}" stroke-width="${strokeFine}" />`);
        parts.push(`<polygon points="0.7,-0.8 0.55,-0.75 0.65,-0.65" fill="${mainStroke}" />`);
      }
      break;
    }

    case "transistor_npn":
    case "transistor_pnp": {
      // Circle optional. Base at (-1.5, 0), collector at (1, -1.5), emitter at (1, 1.5)
      parts.push(`<line x1="-1.5" y1="0" x2="-0.4" y2="0" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      // Base vertical bar
      parts.push(`<line x1="-0.4" y1="-0.8" x2="-0.4" y2="0.8" stroke="${mainStroke}" stroke-width="${strokeThick}" />`);
      // Collector line
      parts.push(`<line x1="-0.4" y1="-0.4" x2="1" y2="-1" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<line x1="1" y1="-1" x2="1" y2="-1.5" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      // Emitter line
      parts.push(`<line x1="-0.4" y1="0.4" x2="1" y2="1" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<line x1="1" y1="1" x2="1" y2="1.5" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      if (type === "transistor_npn") {
        // Arrow pointing outward on emitter
        parts.push(`<polygon points="0.9,0.95 0.5,0.7 0.7,0.5" fill="${mainStroke}" />`);
      } else {
        // Arrow pointing inward towards base
        parts.push(`<polygon points="0.1,0.55 0.5,0.8 0.3,0.4" fill="${mainStroke}" />`);
      }
      break;
    }

    case "transistor_nmos":
    case "transistor_pmos": {
      // Gate at (-1.5, 0), Drain at (1, -1.5), Source at (1, 1.5)
      parts.push(`<line x1="-1.5" y1="0" x2="-0.6" y2="0" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      // Gate plate
      parts.push(`<line x1="-0.6" y1="-0.7" x2="-0.6" y2="0.7" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      // Channel plates
      parts.push(`<line x1="-0.2" y1="-0.8" x2="-0.2" y2="-0.3" stroke="${mainStroke}" stroke-width="${strokeThick}" />`);
      parts.push(`<line x1="-0.2" y1="-0.1" x2="-0.2" y2="0.1" stroke="${mainStroke}" stroke-width="${strokeThick}" />`);
      parts.push(`<line x1="-0.2" y1="0.3" x2="-0.2" y2="0.8" stroke="${mainStroke}" stroke-width="${strokeThick}" />`);
      // Drain & Source connections
      parts.push(`<line x1="-0.2" y1="-0.55" x2="1" y2="-0.55" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<line x1="1" y1="-0.55" x2="1" y2="-1.5" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<line x1="-0.2" y1="0.55" x2="1" y2="0.55" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<line x1="1" y1="0.55" x2="1" y2="1.5" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      if (type === "transistor_nmos") {
        // Bulk arrow inwards
        parts.push(`<line x1="-0.2" y1="0" x2="0.5" y2="0" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
        parts.push(`<line x1="0.5" y1="0" x2="0.5" y2="0.55" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
        parts.push(`<polygon points="-0.1,0 0.2,-0.15 0.2,0.15" fill="${mainStroke}" />`);
      } else {
        // Bubble or arrow for PMOS
        parts.push(`<circle cx="-0.4" cy="0" r="0.18" fill="none" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      }
      break;
    }

    case "opamp": {
      // Triangle opamp: ports at in_inv (-2, -1), in_noninv (-2, 1), out (2, 0)
      parts.push(`<line x1="-2" y1="-1" x2="-1.5" y2="-1" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<line x1="-2" y1="1" x2="-1.5" y2="1" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<polygon points="-1.5,-1.8 -1.5,1.8 1.5,0" fill="none" stroke="${mainStroke}" stroke-width="${strokeW}" stroke-linejoin="round" />`);
      parts.push(`<line x1="1.5" y1="0" x2="2" y2="0" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<text x="-1.1" y="-0.7" font-size="0.6" font-family="sans-serif" fill="${mainStroke}">-</text>`);
      parts.push(`<text x="-1.1" y="1.2" font-size="0.6" font-family="sans-serif" fill="${mainStroke}">+</text>`);
      break;
    }

    case "ground":
    case "earth": {
      // Stem from (0, -0.8) to (0, 0)
      parts.push(`<line x1="0" y1="-0.8" x2="0" y2="0" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      if (type === "ground") {
        // Signal ground: 3 horizontal bars
        parts.push(`<line x1="-0.6" y1="0" x2="0.6" y2="0" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
        parts.push(`<line x1="-0.4" y1="0.25" x2="0.4" y2="0.25" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
        parts.push(`<line x1="-0.2" y1="0.5" x2="0.2" y2="0.5" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      } else {
        // Earth ground: angled diagonal lines
        parts.push(`<line x1="-0.6" y1="0" x2="0.6" y2="0" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
        parts.push(`<line x1="-0.5" y1="0" x2="-0.65" y2="0.3" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
        parts.push(`<line x1="-0.1" y1="0" x2="-0.25" y2="0.3" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
        parts.push(`<line x1="0.3" y1="0" x2="0.15" y2="0.3" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      }
      break;
    }

    case "switch_spst": {
      // Leads at (-1.5, 0) and (1.5, 0) with open contact arm
      parts.push(`<line x1="-1.5" y1="0" x2="-0.7" y2="0" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<circle cx="-0.6" cy="0" r="0.12" fill="none" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<line x1="-0.5" y1="0" x2="0.5" y2="-0.5" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<circle cx="0.6" cy="0" r="0.12" fill="none" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<line x1="0.7" y1="0" x2="1.5" y2="0" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      break;
    }

    case "lamp": {
      // Circle with X inside
      parts.push(`<line x1="-1.2" y1="0" x2="-0.8" y2="0" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<circle cx="0" cy="0" r="0.8" fill="none" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<line x1="-0.55" y1="-0.55" x2="0.55" y2="0.55" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<line x1="-0.55" y1="0.55" x2="0.55" y2="-0.55" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<line x1="0.8" y1="0" x2="1.2" y2="0" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      break;
    }

    default: {
      // Generic rectangle
      parts.push(`<line x1="-1.5" y1="0" x2="-1" y2="0" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<rect x="-1" y="-0.6" width="2" height="1.2" fill="none" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      parts.push(`<line x1="1" y1="0" x2="1.5" y2="0" stroke="${mainStroke}" stroke-width="${strokeW}" />`);
      break;
    }
  }

  return parts.join("\n");
}

/** Renders the complete circuit schematic to an SVG string */
export function renderCircuitToSvg(
  circuit: KirchhoffCircuit,
  options: SvgRenderOptions = {},
): string {
  const gridSize = circuit.gridSize || 20;
  const padding = options.padding !== undefined ? options.padding : 30;

  const strokeColor = options.strokeColor || (options.theme === "dark" ? "#e2e8f0" : "#1e293b");
  const wireColor = options.wireColor || (options.theme === "dark" ? "#94a3b8" : "#334155");
  const nodeColor = options.theme === "dark" ? "#38bdf8" : "#0284c7";
  const labelColor = options.theme === "dark" ? "#cbd5e1" : "#475569";

  const bounds = computeCircuitBounds(circuit);

  const viewMinX = bounds.minX * gridSize - padding;
  const viewMinY = bounds.minY * gridSize - padding;
  const viewWidth = (bounds.maxX - bounds.minX) * gridSize + padding * 2;
  const viewHeight = (bounds.maxY - bounds.minY) * gridSize + padding * 2;

  const svgParts: string[] = [];

  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewMinX} ${viewMinY} ${viewWidth} ${viewHeight}" width="100%" height="100%">`,
  );

  // Optional background
  if (options.backgroundColor) {
    svgParts.push(
      `<rect x="${viewMinX}" y="${viewMinY}" width="${viewWidth}" height="${viewHeight}" fill="${options.backgroundColor}" />`,
    );
  }

  // Optional background grid
  if (options.showGrid) {
    const gridPoints: string[] = [];
    const step = gridSize;
    const startX = Math.floor(viewMinX / step) * step;
    const endX = Math.ceil((viewMinX + viewWidth) / step) * step;
    const startY = Math.floor(viewMinY / step) * step;
    const endY = Math.ceil((viewMinY + viewHeight) / step) * step;
    const dotColor = options.theme === "dark" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)";

    for (let gx = startX; gx <= endX; gx += step) {
      for (let gy = startY; gy <= endY; gy += step) {
        gridPoints.push(`M ${gx} ${gy} l 0.01 0`);
      }
    }
    svgParts.push(
      `<path d="${gridPoints.join(" ")}" stroke="${dotColor}" stroke-width="1.5" stroke-linecap="round" />`,
    );
  }

  // Count connections per node to detect junctions
  const nodeConnectionCount: Record<string, number> = {};
  for (const wire of circuit.wires) {
    nodeConnectionCount[wire.fromNode] = (nodeConnectionCount[wire.fromNode] || 0) + 1;
    nodeConnectionCount[wire.toNode] = (nodeConnectionCount[wire.toNode] || 0) + 1;
  }
  for (const comp of Object.values(circuit.components)) {
    for (const nId of Object.values(comp.ports)) {
      nodeConnectionCount[nId] = (nodeConnectionCount[nId] || 0) + 1;
    }
  }

  // Render wires
  for (const wire of circuit.wires) {
    const fromNode = circuit.nodes[wire.fromNode];
    const toNode = circuit.nodes[wire.toNode];
    if (!fromNode || !toNode) continue;

    const x1 = fromNode.x * gridSize;
    const y1 = fromNode.y * gridSize;
    const x2 = toNode.x * gridSize;
    const y2 = toNode.y * gridSize;

    let pathD = `M ${x1} ${y1}`;
    if (wire.waypoints && wire.waypoints.length > 0) {
      for (const pt of wire.waypoints) {
        pathD += ` L ${pt.x * gridSize} ${pt.y * gridSize}`;
      }
    } else if (Math.abs(x1 - x2) > 0.01 && Math.abs(y1 - y2) > 0.01) {
      // Orthogonal Manhattan routing: route horizontally then vertically
      pathD += ` L ${x2} ${y1}`;
    }
    pathD += ` L ${x2} ${y2}`;

    svgParts.push(
      `<path d="${pathD}" fill="none" stroke="${wireColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`,
    );
  }

  // Render components
  for (const comp of Object.values(circuit.components)) {
    const cx = comp.x * gridSize;
    const cy = comp.y * gridSize;
    const isHighlighted = comp.id === options.highlightComponentId;

    let transform = `translate(${cx}, ${cy}) scale(${gridSize}) rotate(${comp.rotation})`;
    if (comp.mirror) {
      transform += ` scale(-1, 1)`;
    }

    svgParts.push(`<g transform="${transform}">`);
    svgParts.push(renderComponentSymbol(comp, strokeColor, isHighlighted, gridSize));
    svgParts.push(`</g>`);

    // Render component label & value (in world orientation for readability)
    const labelText = comp.label;
    const valueText = comp.value;

    if (labelText || valueText) {
      // Offset text slightly above or to the side of the component
      const def = COMPONENT_CATALOG[comp.type];
      const textOffsetY = ((def ? def.height : 2) / 2 + 0.6) * gridSize;

      svgParts.push(`<g font-family="system-ui, -apple-system, sans-serif" text-anchor="middle">`);
      if (labelText) {
        svgParts.push(
          `<text x="${cx}" y="${cy - textOffsetY}" font-size="12" font-weight="600" fill="${strokeColor}">${escapeXml(labelText)}</text>`,
        );
      }
      if (valueText) {
        const valueY = labelText ? cy - textOffsetY - 13 : cy - textOffsetY;
        svgParts.push(
          `<text x="${cx}" y="${valueY}" font-size="11" font-weight="400" fill="${labelColor}">${escapeXml(valueText)}</text>`,
        );
      }
      svgParts.push(`</g>`);
    }

    // Optional port pins indicator
    if (options.showPorts) {
      const def = COMPONENT_CATALOG[comp.type];
      if (def) {
        for (const port of def.ports) {
          const ppos = getComponentPortPosition(comp, port.id);
          if (ppos) {
            svgParts.push(
              `<circle cx="${ppos.x * gridSize}" cy="${ppos.y * gridSize}" r="3" fill="#3b82f6" opacity="0.75" />`,
            );
          }
        }
      }
    }
  }

  // Render nodes and junction dots
  for (const node of Object.values(circuit.nodes)) {
    const nx = node.x * gridSize;
    const ny = node.y * gridSize;
    const isJunction = node.junction === true;
    const isHighlighted = node.id === options.highlightNodeId;

    if (isJunction) {
      // Standard junction dot
      svgParts.push(`<circle cx="${nx}" cy="${ny}" r="3.5" fill="${wireColor}" />`);
    }

    if (options.showNodes || isHighlighted) {
      const dotColor = isHighlighted ? "#ef4444" : nodeColor;
      svgParts.push(
        `<circle cx="${nx}" cy="${ny}" r="5" fill="${dotColor}" stroke="#ffffff" stroke-width="1.5" />`,
      );
      if (node.label) {
        svgParts.push(
          `<text x="${nx + 8}" y="${ny - 6}" font-size="11" font-family="monospace" fill="${dotColor}" font-weight="bold">${escapeXml(node.label)}</text>`,
        );
      }
    }
  }

  svgParts.push(`</svg>`);
  return svgParts.join("\n");
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
