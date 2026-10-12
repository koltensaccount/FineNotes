import { COMPONENT_CATALOG, type KirchhoffCircuit, KIRCHHOFF_IR_VERSION } from "./ir";

/** Complete RC example: shared node IDs express a connection, never a wire through a device. */
export const RECOGNITION_EXAMPLE: KirchhoffCircuit = {
  version: KIRCHHOFF_IR_VERSION,
  title: "RC low-pass",
  uncertainties: [],
  nodes: {
    input: { id: "input", x: 0, y: 0 },
    output: { id: "output", x: 6, y: 0, label: "Vout" },
    return: { id: "return", x: 6, y: 4 },
  },
  components: {
    v1: {
      id: "v1",
      type: "vsource_dc",
      label: "Vin",
      value: "5V",
      x: 0,
      y: 2,
      rotation: 0,
      ports: { pos: "input", neg: "return" },
    },
    r1: {
      id: "r1",
      type: "resistor",
      label: "R1",
      value: "10kΩ",
      x: 3,
      y: 0,
      rotation: 0,
      ports: { p1: "input", p2: "output" },
    },
    c1: {
      id: "c1",
      type: "capacitor",
      label: "C1",
      value: "100nF",
      x: 6,
      y: 2,
      rotation: 90,
      ports: { p1: "output", p2: "return" },
    },
  },
  wires: [],
};

// Derive terminal orientation from the same catalog used by the editor and renderer.
const terminalGuide = Object.values(COMPONENT_CATALOG)
  .map((def) => `- ${def.type}: ${def.ports.map((p) => `${p.id} at (${p.x},${p.y})`).join(", ")}`)
  .join("\n");

export const CIRCUIT_SYSTEM_PROMPT = `Recognize the electrical circuit actually drawn in Image 1.
Return kirchhoff-ir/1.0 JSON. Image 2, when present, is surrounding notes: use it only to read unclear labels or values, never to add circuitry.

Work in this order: identify each symbol and its terminals; trace each drawn wire and junction; assign terminal connections; then assign approximate positions.
Do not complete a familiar circuit from memory. Do not invent components or connections.
Use the cathode bar to identify diode polarity, and the marked + terminal for polarized parts.
A crossing is not a connection unless the drawing shows a dot or an unambiguous joined endpoint/T junction. Record ambiguous crossings and illegible symbols/labels in uncertainties; leave uncertain terminal connections absent instead of guessing.
Every referenced node must be defined. Use only the catalog terminal IDs below.
One node ID can be shared by terminals on the same electrical connection. A wire between node IDs is an additional conductor: NEVER add a wire merely because a component has those two terminals; that would bypass/short the component.
Distinguish electrical connectivity from position: terminals on the same net need not occupy the same point.

Coordinates use x right, y down, approximately 0–20 units. Preserve the drawing's relative arrangement. Rotation is clockwise in degrees; mirror reflects local x before rotation.
The terminal offsets below are at rotation 0. Resistors/capacitors/diodes are horizontal at 0; voltage/current sources and batteries are vertical at 0. Compute rotation for each symbol from its own offsets, not a universal two-terminal rule.
${terminalGuide}

Copy labels and values as drawn; omit unreadable values and explain in uncertainties.
Respond only with JSON. This is a complete electrically valid RC example, not a template to impose on the image:
${JSON.stringify(RECOGNITION_EXAMPLE, null, 2)}`;

const string = { type: "string" };
const number = { type: "number" };
const point = { type: "object", properties: { x: number, y: number }, required: ["x", "y"] };

/** Gemini's JSON Schema dialect supports typed dictionaries via additionalProperties. */
export const CIRCUIT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    version: { type: "string", enum: [KIRCHHOFF_IR_VERSION] },
    title: string,
    uncertainties: { type: "array", items: string },
    nodes: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          id: string,
          x: number,
          y: number,
          label: string,
          junction: { type: "boolean" },
        },
        required: ["id", "x", "y"],
      },
    },
    components: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          id: string,
          type: { type: "string", enum: Object.keys(COMPONENT_CATALOG) },
          label: string,
          value: string,
          x: number,
          y: number,
          rotation: number,
          mirror: { type: "boolean" },
          ports: { type: "object", additionalProperties: string },
        },
        required: ["id", "type", "label", "x", "y", "rotation", "ports"],
      },
    },
    wires: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: string,
          fromNode: string,
          toNode: string,
          waypoints: { type: "array", items: point },
          direct: { type: "boolean" },
        },
        required: ["id", "fromNode", "toNode"],
      },
    },
  },
  required: ["version", "title", "uncertainties", "nodes", "components", "wires"],
};

/** Compare electrical nets, independent of node names, geometry or routing waypoints. */
export function circuitTopologySignature(
  circuit: KirchhoffCircuit,
  useComponentIds = false,
): string {
  const parent = new Map(Object.keys(circuit.nodes).map((id) => [id, id]));
  const find = (id: string): string => {
    const p = parent.get(id);
    if (!p || p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  for (const wire of circuit.wires) {
    if (parent.has(wire.fromNode) && parent.has(wire.toNode)) {
      parent.set(find(wire.fromNode), find(wire.toNode));
    }
  }
  const nets = new Map<string, string[]>();
  const components = Object.values(circuit.components)
    .map((comp) => {
      for (const [port, node] of Object.entries(comp.ports)) {
        const root = find(node);
        const terminals = nets.get(root) || [];
        terminals.push(
          `${useComponentIds ? comp.id : comp.label}:${comp.type}:${comp.value || ""}:${port}`,
        );
        nets.set(root, terminals);
      }
      return `${useComponentIds ? comp.id : comp.label}:${comp.type}:${comp.value || ""}:${Object.keys(comp.ports).sort().join(",")}`;
    })
    .sort();
  return JSON.stringify({
    components,
    nets: [...nets.values()].map((v) => v.sort()).sort((a, b) => a.join().localeCompare(b.join())),
  });
}
