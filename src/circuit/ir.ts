/**
 * Kirchhoff IR Schema (v1.0) and component catalog.
 *
 * Defines the structured netlist representation of electrical circuits
 * compatible with kirchhoff-ir/1.0, suitable for bidirectional conversion
 * to CircuitikZ and interactive graphical rendering.
 */

export const KIRCHHOFF_IR_VERSION = "kirchhoff-ir/1.0";

export type ComponentType =
  // Passive two-terminal
  | "resistor"
  | "variable_resistor"
  | "capacitor"
  | "polarized_capacitor"
  | "variable_capacitor"
  | "inductor"
  // Sources
  | "vsource"
  | "vsource_dc"
  | "isource"
  | "battery"
  // Semiconductors
  | "diode"
  | "zener_diode"
  | "led"
  | "transistor_npn"
  | "transistor_pnp"
  | "transistor_nmos"
  | "transistor_pmos"
  // Multi-terminal / active
  | "opamp"
  // Connections / references
  | "ground"
  | "earth"
  | "switch_spst"
  | "lamp"
  | "generic_box";

export interface CircuitPort {
  id: string;
  name: string;
  /** Relative offset (dx, dy) in grid units from component centre at rotation 0 */
  x: number;
  y: number;
}

export interface ComponentDefinition {
  type: ComponentType;
  labelPrefix: string;
  defaultLabel: string;
  defaultValue?: string;
  ports: CircuitPort[];
  width: number;
  height: number;
  description: string;
}

/** Standard catalog of supported electrical components */
export const COMPONENT_CATALOG: Record<ComponentType, ComponentDefinition> = {
  resistor: {
    type: "resistor",
    labelPrefix: "R",
    defaultLabel: "R1",
    defaultValue: "1kΩ",
    ports: [
      { id: "p1", name: "1", x: -1.5, y: 0 },
      { id: "p2", name: "2", x: 1.5, y: 0 },
    ],
    width: 3,
    height: 1,
    description: "Resistor",
  },
  variable_resistor: {
    type: "variable_resistor",
    labelPrefix: "R",
    defaultLabel: "R_var",
    defaultValue: "10kΩ",
    ports: [
      { id: "p1", name: "1", x: -1.5, y: 0 },
      { id: "p2", name: "2", x: 1.5, y: 0 },
    ],
    width: 3,
    height: 1.5,
    description: "Variable Resistor / Potentiometer",
  },
  capacitor: {
    type: "capacitor",
    labelPrefix: "C",
    defaultLabel: "C1",
    defaultValue: "100nF",
    ports: [
      { id: "p1", name: "1", x: -1, y: 0 },
      { id: "p2", name: "2", x: 1, y: 0 },
    ],
    width: 2,
    height: 1.5,
    description: "Capacitor",
  },
  polarized_capacitor: {
    type: "polarized_capacitor",
    labelPrefix: "C",
    defaultLabel: "C1",
    defaultValue: "10μF",
    ports: [
      { id: "pos", name: "+", x: -1, y: 0 },
      { id: "neg", name: "-", x: 1, y: 0 },
    ],
    width: 2,
    height: 1.5,
    description: "Polarized Electrolytic Capacitor",
  },
  variable_capacitor: {
    type: "variable_capacitor",
    labelPrefix: "C",
    defaultLabel: "C_var",
    defaultValue: "50pF",
    ports: [
      { id: "p1", name: "1", x: -1, y: 0 },
      { id: "p2", name: "2", x: 1, y: 0 },
    ],
    width: 2,
    height: 1.5,
    description: "Variable Capacitor",
  },
  inductor: {
    type: "inductor",
    labelPrefix: "L",
    defaultLabel: "L1",
    defaultValue: "10mH",
    ports: [
      { id: "p1", name: "1", x: -1.5, y: 0 },
      { id: "p2", name: "2", x: 1.5, y: 0 },
    ],
    width: 3,
    height: 1,
    description: "Inductor",
  },
  vsource: {
    type: "vsource",
    labelPrefix: "V",
    defaultLabel: "V1",
    defaultValue: "5V",
    ports: [
      { id: "pos", name: "+", x: 0, y: -1.5 },
      { id: "neg", name: "-", x: 0, y: 1.5 },
    ],
    width: 2,
    height: 3,
    description: "AC Voltage Source",
  },
  vsource_dc: {
    type: "vsource_dc",
    labelPrefix: "V",
    defaultLabel: "V1",
    defaultValue: "5V",
    ports: [
      { id: "pos", name: "+", x: 0, y: -1.5 },
      { id: "neg", name: "-", x: 0, y: 1.5 },
    ],
    width: 2,
    height: 3,
    description: "DC Voltage Source",
  },
  battery: {
    type: "battery",
    labelPrefix: "V",
    defaultLabel: "V_bat",
    defaultValue: "9V",
    ports: [
      { id: "pos", name: "+", x: 0, y: -1 },
      { id: "neg", name: "-", x: 0, y: 1 },
    ],
    width: 2,
    height: 2,
    description: "Battery",
  },
  isource: {
    type: "isource",
    labelPrefix: "I",
    defaultLabel: "I1",
    defaultValue: "1mA",
    ports: [
      { id: "out", name: "out", x: 0, y: -1.5 },
      { id: "in", name: "in", x: 0, y: 1.5 },
    ],
    width: 2,
    height: 3,
    description: "Current Source",
  },
  diode: {
    type: "diode",
    labelPrefix: "D",
    defaultLabel: "D1",
    ports: [
      { id: "anode", name: "A", x: -1.2, y: 0 },
      { id: "cathode", name: "K", x: 1.2, y: 0 },
    ],
    width: 2.4,
    height: 1.5,
    description: "Diode",
  },
  zener_diode: {
    type: "zener_diode",
    labelPrefix: "D",
    defaultLabel: "DZ1",
    defaultValue: "3.3V",
    ports: [
      { id: "anode", name: "A", x: -1.2, y: 0 },
      { id: "cathode", name: "K", x: 1.2, y: 0 },
    ],
    width: 2.4,
    height: 1.5,
    description: "Zener Diode",
  },
  led: {
    type: "led",
    labelPrefix: "D",
    defaultLabel: "LED1",
    ports: [
      { id: "anode", name: "A", x: -1.2, y: 0 },
      { id: "cathode", name: "K", x: 1.2, y: 0 },
    ],
    width: 2.4,
    height: 2,
    description: "Light Emitting Diode",
  },
  transistor_npn: {
    type: "transistor_npn",
    labelPrefix: "Q",
    defaultLabel: "Q1",
    ports: [
      { id: "base", name: "B", x: -1.5, y: 0 },
      { id: "collector", name: "C", x: 1, y: -1.5 },
      { id: "emitter", name: "E", x: 1, y: 1.5 },
    ],
    width: 3,
    height: 3,
    description: "NPN Bipolar Junction Transistor",
  },
  transistor_pnp: {
    type: "transistor_pnp",
    labelPrefix: "Q",
    defaultLabel: "Q1",
    ports: [
      { id: "base", name: "B", x: -1.5, y: 0 },
      { id: "collector", name: "C", x: 1, y: -1.5 },
      { id: "emitter", name: "E", x: 1, y: 1.5 },
    ],
    width: 3,
    height: 3,
    description: "PNP Bipolar Junction Transistor",
  },
  transistor_nmos: {
    type: "transistor_nmos",
    labelPrefix: "M",
    defaultLabel: "M1",
    ports: [
      { id: "gate", name: "G", x: -1.5, y: 0 },
      { id: "drain", name: "D", x: 1, y: -1.5 },
      { id: "source", name: "S", x: 1, y: 1.5 },
    ],
    width: 3,
    height: 3,
    description: "N-Channel MOSFET",
  },
  transistor_pmos: {
    type: "transistor_pmos",
    labelPrefix: "M",
    defaultLabel: "M1",
    ports: [
      { id: "gate", name: "G", x: -1.5, y: 0 },
      { id: "drain", name: "D", x: 1, y: -1.5 },
      { id: "source", name: "S", x: 1, y: 1.5 },
    ],
    width: 3,
    height: 3,
    description: "P-Channel MOSFET",
  },
  opamp: {
    type: "opamp",
    labelPrefix: "U",
    defaultLabel: "U1",
    ports: [
      { id: "in_inv", name: "-", x: -2, y: -1 },
      { id: "in_noninv", name: "+", x: -2, y: 1 },
      { id: "out", name: "out", x: 2, y: 0 },
      { id: "vcc", name: "V+", x: 0, y: -2 },
      { id: "vee", name: "V-", x: 0, y: 2 },
    ],
    width: 4,
    height: 4,
    description: "Operational Amplifier",
  },
  ground: {
    type: "ground",
    labelPrefix: "GND",
    defaultLabel: "GND",
    ports: [{ id: "gnd", name: "GND", x: 0, y: -0.8 }],
    width: 1.6,
    height: 1.6,
    description: "Signal Ground",
  },
  earth: {
    type: "earth",
    labelPrefix: "EARTH",
    defaultLabel: "EARTH",
    ports: [{ id: "earth", name: "EARTH", x: 0, y: -0.8 }],
    width: 1.6,
    height: 1.6,
    description: "Earth Ground",
  },
  switch_spst: {
    type: "switch_spst",
    labelPrefix: "SW",
    defaultLabel: "SW1",
    ports: [
      { id: "p1", name: "1", x: -1.5, y: 0 },
      { id: "p2", name: "2", x: 1.5, y: 0 },
    ],
    width: 3,
    height: 1.5,
    description: "SPST Switch",
  },
  lamp: {
    type: "lamp",
    labelPrefix: "LAMP",
    defaultLabel: "LMP1",
    ports: [
      { id: "p1", name: "1", x: -1.2, y: 0 },
      { id: "p2", name: "2", x: 1.2, y: 0 },
    ],
    width: 2.4,
    height: 2.4,
    description: "Lamp / Light Bulb",
  },
  generic_box: {
    type: "generic_box",
    labelPrefix: "U",
    defaultLabel: "BOX1",
    ports: [
      { id: "p1", name: "1", x: -1.5, y: 0 },
      { id: "p2", name: "2", x: 1.5, y: 0 },
    ],
    width: 3,
    height: 2,
    description: "Generic Component",
  },
};

/** A connection node in the circuit netlist */
export interface CircuitNode {
  id: string;
  x: number;
  y: number;
  label?: string;
  /** True when manually designated as an electrical junction point */
  junction?: boolean;
}

/** Component instance in the circuit */
export interface CircuitComponent {
  id: string;
  type: ComponentType;
  label: string;
  value?: string;
  x: number;
  y: number;
  /** Rotation in degrees (0, 90, 180, 270) */
  rotation: number;
  /** Mirror horizontally before rotation */
  mirror?: boolean;
  /**
   * Terminal connections mapping port id -> connected circuit node id.
   * e.g. { "p1": "n1", "p2": "n2" } or { "pos": "n1", "neg": "n2" }
   */
  ports: Record<string, string>;
}

/** Wire connecting nodes */
export interface CircuitWire {
  id: string;
  fromNode: string;
  toNode: string;
  /** Optional intermediate routing waypoints in grid coordinates */
  waypoints?: Array<{ x: number; y: number }>;
}

/** Complete structured representation matching kirchhoff-ir/1.0 */
export interface KirchhoffCircuit {
  version: typeof KIRCHHOFF_IR_VERSION;
  title?: string;
  gridSize?: number; // Default 20 px per grid unit
  nodes: Record<string, CircuitNode>;
  components: Record<string, CircuitComponent>;
  wires: CircuitWire[];
}

/** Factory for an empty circuit */
export function createEmptyCircuit(title?: string): KirchhoffCircuit {
  return {
    version: KIRCHHOFF_IR_VERSION,
    title: title || "Untitled Circuit",
    gridSize: 20,
    nodes: {},
    components: {},
    wires: [],
  };
}

/** Deep clone of a Kirchhoff circuit */
export function cloneCircuit(circuit: KirchhoffCircuit): KirchhoffCircuit {
  return {
    version: KIRCHHOFF_IR_VERSION,
    title: circuit.title,
    gridSize: circuit.gridSize ?? 20,
    nodes: Object.fromEntries(
      Object.entries(circuit.nodes).map(([id, node]) => [id, { ...node }]),
    ),
    components: Object.fromEntries(
      Object.entries(circuit.components).map(([id, comp]) => [
        id,
        {
          ...comp,
          ports: { ...comp.ports },
        },
      ]),
    ),
    wires: circuit.wires.map((wire) => ({
      ...wire,
      waypoints: wire.waypoints ? wire.waypoints.map((pt) => ({ ...pt })) : undefined,
    })),
  };
}

/** Computes world coordinates for a component's port */
export function getComponentPortPosition(
  comp: CircuitComponent,
  portId: string,
): { x: number; y: number } | null {
  const def = COMPONENT_CATALOG[comp.type];
  if (!def) return null;
  const port = def.ports.find((p) => p.id === portId);
  if (!port) return null;

  let px = port.x;
  let py = port.y;

  if (comp.mirror) {
    px = -px;
  }

  const rad = (comp.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const rx = px * cos - py * sin;
  const ry = px * sin + py * cos;

  return {
    x: comp.x + rx,
    y: comp.y + ry,
  };
}

/** Validates and repairs an IR object */
export function validateAndNormalizeCircuit(raw: unknown): KirchhoffCircuit {
  if (typeof raw !== "object" || raw === null) {
    return createEmptyCircuit();
  }
  const obj = raw as Record<string, unknown>;
  const circuit: KirchhoffCircuit = {
    version: KIRCHHOFF_IR_VERSION,
    title: typeof obj.title === "string" ? obj.title : "Circuit",
    gridSize: typeof obj.gridSize === "number" && obj.gridSize > 0 ? obj.gridSize : 20,
    nodes: {},
    components: {},
    wires: [],
  };

  if (typeof obj.nodes === "object" && obj.nodes !== null) {
    for (const [id, n] of Object.entries(obj.nodes as Record<string, unknown>)) {
      if (typeof n === "object" && n !== null) {
        const nodeObj = n as Record<string, unknown>;
        circuit.nodes[id] = {
          id: typeof nodeObj.id === "string" ? nodeObj.id : id,
          x: typeof nodeObj.x === "number" ? nodeObj.x : 0,
          y: typeof nodeObj.y === "number" ? nodeObj.y : 0,
          label: typeof nodeObj.label === "string" ? nodeObj.label : undefined,
          junction: Boolean(nodeObj.junction),
        };
      }
    }
  }

  if (typeof obj.components === "object" && obj.components !== null) {
    for (const [id, c] of Object.entries(obj.components as Record<string, unknown>)) {
      if (typeof c === "object" && c !== null) {
        const compObj = c as Record<string, unknown>;
        const rawType = String(compObj.type || "resistor");
        const type: ComponentType = (rawType in COMPONENT_CATALOG)
          ? (rawType as ComponentType)
          : "generic_box";

        const ports: Record<string, string> = {};
        if (typeof compObj.ports === "object" && compObj.ports !== null) {
          for (const [pId, nId] of Object.entries(compObj.ports as Record<string, unknown>)) {
            if (typeof nId === "string") {
              ports[pId] = nId;
            }
          }
        }

        circuit.components[id] = {
          id: typeof compObj.id === "string" ? compObj.id : id,
          type,
          label: typeof compObj.label === "string" ? compObj.label : (COMPONENT_CATALOG[type]?.defaultLabel || "C"),
          value: typeof compObj.value === "string" ? compObj.value : undefined,
          x: typeof compObj.x === "number" ? compObj.x : 0,
          y: typeof compObj.y === "number" ? compObj.y : 0,
          rotation: typeof compObj.rotation === "number" ? (compObj.rotation % 360 + 360) % 360 : 0,
          mirror: Boolean(compObj.mirror),
          ports,
        };
      }
    }
  }

  if (Array.isArray(obj.wires)) {
    let wireIdx = 1;
    for (const w of obj.wires) {
      if (typeof w === "object" && w !== null) {
        const wireObj = w as Record<string, unknown>;
        if (typeof wireObj.fromNode === "string" && typeof wireObj.toNode === "string") {
          circuit.wires.push({
            id: typeof wireObj.id === "string" ? wireObj.id : `w${wireIdx++}`,
            fromNode: wireObj.fromNode,
            toNode: wireObj.toNode,
            waypoints: Array.isArray(wireObj.waypoints)
              ? wireObj.waypoints
                  .filter((pt): pt is { x: number; y: number } =>
                    typeof pt === "object" && pt !== null && typeof pt.x === "number" && typeof pt.y === "number"
                  )
              : undefined,
          });
        }
      }
    }
  }

  return circuit;
}
