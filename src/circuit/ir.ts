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
  | "dependent_vsource"
  | "dependent_isource"
  | "battery"
  // Semiconductors
  | "diode"
  | "zener_diode"
  | "led"
  | "transistor_npn"
  | "transistor_pnp"
  | "transistor_nmos"
  | "transistor_pmos"
  | "transistor_njfet"
  | "transistor_pjfet"
  // Multi-terminal / active
  | "opamp"
  // Connections / references / nodes
  | "ground"
  | "earth"
  | "node_filled"
  | "node_open"
  | "text_label"
  | "voltage_label"
  | "switch_spst"
  | "switch_spdt"
  | "fuse"
  | "lamp"
  | "potentiometer"
  | "ac_source"
  | "transformer"
  | "schottky_diode"
  | "logic_and"
  | "logic_or"
  | "logic_not"
  | "logic_nand"
  | "logic_nor"
  | "logic_xor"
  | "logic_xnor"
  | "logic_buffer"
  | "meter_voltage"
  | "meter_current"
  | "crystal"
  | "photodiode"
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
  dependent_vsource: { type: "dependent_vsource", labelPrefix: "V", defaultLabel: "V_dep", ports: [{id:"pos",name:"+",x:0,y:-1.5},{id:"neg",name:"−",x:0,y:1.5}], width:2,height:3,description:"Dependent Voltage Source (VCVS / CCVS)" },
  dependent_isource: { type: "dependent_isource", labelPrefix: "I", defaultLabel: "I_dep", ports: [{id:"out",name:"out",x:0,y:-1.5},{id:"in",name:"in",x:0,y:1.5}], width:2,height:3,description:"Dependent Current Source (VCCS / CCCS)" },
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
  node_filled: {
    type: "node_filled",
    labelPrefix: "N",
    defaultLabel: "",
    ports: [{ id: "p1", name: "•", x: 0, y: 0 }],
    width: 0.4,
    height: 0.4,
    description: "Connection Node / Dot (Filled)",
  },
  node_open: {
    type: "node_open",
    labelPrefix: "T",
    defaultLabel: "",
    ports: [{ id: "p1", name: "○", x: 0, y: 0 }],
    width: 0.4,
    height: 0.4,
    description: "Terminal / Test Point (Open)",
  },
  voltage_label: {
    type: "voltage_label", labelPrefix: "VL", defaultLabel: "V_o", ports: [],
    width: 1.6, height: 3, description: "Voltage Label (+ / V / −)",
  },
  text_label: {
    type: "text_label",
    labelPrefix: "L",
    defaultLabel: "Label",
    ports: [],
    width: 1,
    height: 0.6,
    description: "Text / Math Label",
  },
  potentiometer: {
    type: "potentiometer",
    labelPrefix: "POT",
    defaultLabel: "POT1",
    defaultValue: "10kΩ",
    ports: [
      { id: "p1", name: "1", x: -1.5, y: 0 },
      { id: "p2", name: "2", x: 1.5, y: 0 },
      { id: "wiper", name: "W", x: 0, y: -1.2 },
    ],
    width: 3,
    height: 2.4,
    description: "Potentiometer (3-Terminal)",
  },
  ac_source: {
    type: "ac_source",
    labelPrefix: "V",
    defaultLabel: "V_AC",
    defaultValue: "120V",
    ports: [
      { id: "p1", name: "~", x: 0, y: -1.5 },
      { id: "p2", name: "~", x: 0, y: 1.5 },
    ],
    width: 2,
    height: 3,
    description: "AC Voltage Source",
  },
  switch_spdt: {
    type: "switch_spdt",
    labelPrefix: "SW",
    defaultLabel: "SW1",
    ports: [
      { id: "com", name: "COM", x: -1.5, y: 0 },
      { id: "t1", name: "1", x: 1.5, y: -0.8 },
      { id: "t2", name: "2", x: 1.5, y: 0.8 },
    ],
    width: 3,
    height: 2,
    description: "SPDT Switch (3-Terminal)",
  },
  fuse: {
    type: "fuse",
    labelPrefix: "F",
    defaultLabel: "F1",
    defaultValue: "1A",
    ports: [
      { id: "p1", name: "1", x: -1.5, y: 0 },
      { id: "p2", name: "2", x: 1.5, y: 0 },
    ],
    width: 3,
    height: 1,
    description: "Fuse",
  },
  transformer: {
    type: "transformer",
    labelPrefix: "TX",
    defaultLabel: "TX1",
    ports: [
      { id: "p1", name: "P1", x: -1.5, y: -1 },
      { id: "p2", name: "P2", x: -1.5, y: 1 },
      { id: "s1", name: "S1", x: 1.5, y: -1 },
      { id: "s2", name: "S2", x: 1.5, y: 1 },
    ],
    width: 3,
    height: 3,
    description: "Transformer",
  },
  schottky_diode: {
    type: "schottky_diode",
    labelPrefix: "D",
    defaultLabel: "D1",
    ports: [
      { id: "anode", name: "+", x: -1.2, y: 0 },
      { id: "cathode", name: "-", x: 1.2, y: 0 },
    ],
    width: 2.4,
    height: 1.5,
    description: "Schottky Diode",
  },
  logic_and: {
    type: "logic_and",
    labelPrefix: "U",
    defaultLabel: "AND1",
    ports: [
      { id: "in1", name: "A", x: -2, y: -0.7 },
      { id: "in2", name: "B", x: -2, y: 0.7 },
      { id: "out", name: "Y", x: 2, y: 0 },
    ],
    width: 4,
    height: 2.5,
    description: "AND Logic Gate",
  },
  logic_or: {
    type: "logic_or",
    labelPrefix: "U",
    defaultLabel: "OR1",
    ports: [
      { id: "in1", name: "A", x: -2, y: -0.7 },
      { id: "in2", name: "B", x: -2, y: 0.7 },
      { id: "out", name: "Y", x: 2, y: 0 },
    ],
    width: 4,
    height: 2.5,
    description: "OR Logic Gate",
  },
  logic_not: {
    type: "logic_not",
    labelPrefix: "U",
    defaultLabel: "NOT1",
    ports: [
      { id: "in", name: "A", x: -1.5, y: 0 },
      { id: "out", name: "Y", x: 1.5, y: 0 },
    ],
    width: 3,
    height: 2,
    description: "NOT Gate / Inverter",
  },
  logic_nand: {type:"logic_nand",labelPrefix:"U",defaultLabel:"NAND1",ports:[{id:"in1",name:"A",x:-2,y:-0.7},{id:"in2",name:"B",x:-2,y:0.7},{id:"out",name:"Y",x:2,y:0}],width:4,height:2.5,description:"NAND Logic Gate"},
  logic_nor: {type:"logic_nor",labelPrefix:"U",defaultLabel:"NOR1",ports:[{id:"in1",name:"A",x:-2,y:-0.7},{id:"in2",name:"B",x:-2,y:0.7},{id:"out",name:"Y",x:2,y:0}],width:4,height:2.5,description:"NOR Logic Gate"},
  logic_xor: {type:"logic_xor",labelPrefix:"U",defaultLabel:"XOR1",ports:[{id:"in1",name:"A",x:-2,y:-0.7},{id:"in2",name:"B",x:-2,y:0.7},{id:"out",name:"Y",x:2,y:0}],width:4,height:2.5,description:"XOR Logic Gate"},
  logic_xnor: {type:"logic_xnor",labelPrefix:"U",defaultLabel:"XNOR1",ports:[{id:"in1",name:"A",x:-2,y:-0.7},{id:"in2",name:"B",x:-2,y:0.7},{id:"out",name:"Y",x:2,y:0}],width:4,height:2.5,description:"XNOR Logic Gate"},
  logic_buffer: {type:"logic_buffer",labelPrefix:"U",defaultLabel:"BUFFER1",ports:[{id:"in",name:"A",x:-1.5,y:0},{id:"out",name:"Y",x:1.5,y:0}],width:3,height:2.5,description:"BUFFER Logic Gate"},
  transistor_njfet: {type:"transistor_njfet",labelPrefix:"Q",defaultLabel:"Q1",ports:[{id:"gate",name:"G",x:-1.5,y:0},{id:"drain",name:"D",x:1.5,y:-1.3},{id:"source",name:"S",x:1.5,y:1.3}],width:3,height:2.6,description:"N-Channel JFET"},
  transistor_pjfet: {type:"transistor_pjfet",labelPrefix:"Q",defaultLabel:"Q1",ports:[{id:"gate",name:"G",x:-1.5,y:0},{id:"drain",name:"D",x:1.5,y:-1.3},{id:"source",name:"S",x:1.5,y:1.3}],width:3,height:2.6,description:"P-Channel JFET"},
  meter_voltage: {
    type: "meter_voltage",
    labelPrefix: "V",
    defaultLabel: "V1",
    ports: [
      { id: "p1", name: "+", x: 0, y: -1.5 },
      { id: "p2", name: "-", x: 0, y: 1.5 },
    ],
    width: 2,
    height: 3,
    description: "Voltmeter (Voltage Measurement)",
  },
  meter_current: {
    type: "meter_current",
    labelPrefix: "A",
    defaultLabel: "A1",
    ports: [
      { id: "p1", name: "in", x: 0, y: -1.5 },
      { id: "p2", name: "out", x: 0, y: 1.5 },
    ],
    width: 2,
    height: 3,
    description: "Ammeter (Current Measurement)",
  },
  crystal: {
    type: "crystal",
    labelPrefix: "Y",
    defaultLabel: "Y1",
    defaultValue: "16MHz",
    ports: [
      { id: "p1", name: "1", x: -1.5, y: 0 },
      { id: "p2", name: "2", x: 1.5, y: 0 },
    ],
    width: 3,
    height: 1.5,
    description: "Quartz Crystal Resonator",
  },
  photodiode: {
    type: "photodiode",
    labelPrefix: "D",
    defaultLabel: "PD1",
    ports: [
      { id: "anode", name: "A", x: -1.2, y: 0 },
      { id: "cathode", name: "K", x: 1.2, y: 0 },
    ],
    width: 2.4,
    height: 1.5,
    description: "Photodiode (Light Sensor)",
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

export interface ComponentCategory {
  name: string;
  types: ComponentType[];
}

export const COMPONENT_CATEGORIES: ComponentCategory[] = [
  {
    name: "Nodes & Terminals",
    types: ["node_filled", "node_open", "ground", "earth", "text_label", "voltage_label"],
  },
  {
    name: "Passives",
    types: ["resistor", "variable_resistor", "potentiometer", "capacitor", "polarized_capacitor", "variable_capacitor", "inductor", "crystal"],
  },
  {
    name: "Sources & Instruments",
    types: ["vsource_dc", "vsource", "ac_source", "battery", "isource", "dependent_vsource", "dependent_isource", "meter_voltage", "meter_current"],
  },
  {
    name: "Semiconductors & Diodes",
    types: ["diode", "zener_diode", "schottky_diode", "led", "photodiode", "transistor_npn", "transistor_pnp", "transistor_nmos", "transistor_pmos", "transistor_njfet", "transistor_pjfet", "opamp"],
  },
  {
    name: "Digital Logic Gates",
    types: ["logic_and", "logic_or", "logic_not", "logic_nand", "logic_nor", "logic_xor", "logic_xnor", "logic_buffer"],
  },
  {
    name: "Switches & Protection",
    types: ["switch_spst", "switch_spdt", "fuse", "lamp", "transformer", "generic_box"],
  },
];

export function getComponentCategoryName(type: ComponentType): string {
  for (const cat of COMPONENT_CATEGORIES) {
    if (cat.types.includes(type)) return cat.name;
  }
  return "Other";
}

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
  /** Manual label position offset relative to component center (px) */
  labelOffset?: { x: number; y: number; manual?: boolean };
  /** Manual value position offset relative to component center (px) */
  valueOffset?: { x: number; y: number; manual?: boolean };
}

/** Wire connecting nodes */
export interface CircuitWire {
  id: string;
  fromNode: string;
  toNode: string;
  /** Optional intermediate routing waypoints in grid coordinates */
  waypoints?: Array<{ x: number; y: number }>;
  /** When true, renders directly between endpoints rather than defaulting to Manhattan L-bends */
  direct?: boolean;
  /** True when wire geometry was manually adjusted or placed by user */
  userEdited?: boolean;
}

/** Complete structured representation matching kirchhoff-ir/1.0 */
export interface KirchhoffCircuit {
  version: typeof KIRCHHOFF_IR_VERSION;
  title?: string;
  gridSize?: number; // Default 20 px per grid unit
  nodes: Record<string, CircuitNode>;
  components: Record<string, CircuitComponent>;
  wires: CircuitWire[];
  diagnostics?: CircuitDiagnostic[];
  uncertainties?: string[];
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
    diagnostics: circuit.diagnostics ? [...circuit.diagnostics] : undefined,
    uncertainties: circuit.uncertainties ? [...circuit.uncertainties] : undefined,
    nodes: Object.fromEntries(
      Object.entries(circuit.nodes).map(([id, node]) => [id, { ...node }]),
    ),
    components: Object.fromEntries(
      Object.entries(circuit.components).map(([id, comp]) => [
        id,
        {
          ...comp,
          ports: { ...comp.ports },
          labelOffset: comp.labelOffset ? { ...comp.labelOffset } : undefined,
          valueOffset: comp.valueOffset ? { ...comp.valueOffset } : undefined,
        },
      ]),
    ),
    wires: circuit.wires.map((wire) => ({
      ...wire,
      waypoints: wire.waypoints ? wire.waypoints.map((pt) => ({ ...pt })) : undefined,
      userEdited: wire.userEdited,
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
  const py = port.y;

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
  const repairs: CircuitDiagnostic[] = [];
  const reportRepair = (message: string, componentId?: string): void => {
    repairs.push({ severity: "warning", code: "NORMALIZATION_REPAIR", message, componentId });
  };
  const circuit: KirchhoffCircuit = {
    version: KIRCHHOFF_IR_VERSION,
    title: typeof obj.title === "string" ? obj.title : "Circuit",
    gridSize: typeof obj.gridSize === "number" && obj.gridSize > 0 ? obj.gridSize : 20,
    nodes: {},
    components: {},
    wires: [],
  };

  // 1. Ingest nodes
  if (typeof obj.nodes === "object" && obj.nodes !== null) {
    for (const [id, n] of Object.entries(obj.nodes as Record<string, unknown>)) {
      if (typeof n === "object" && n !== null) {
        const nodeObj = n as Record<string, unknown>;
        const nodeId = typeof nodeObj.id === "string" && nodeObj.id.trim() ? nodeObj.id.trim() : id.trim();
        if (!nodeId) continue;
        if (![nodeObj.x, nodeObj.y].every((v) => typeof v === "number" && Number.isFinite(v))) {
          reportRepair(`Missing or invalid position for junction "${nodeId}" was reset to the origin.`);
        }
        circuit.nodes[nodeId] = {
          id: nodeId,
          x: typeof nodeObj.x === "number" && Number.isFinite(nodeObj.x) ? nodeObj.x : 0,
          y: typeof nodeObj.y === "number" && Number.isFinite(nodeObj.y) ? nodeObj.y : 0,
          label: typeof nodeObj.label === "string" ? nodeObj.label : undefined,
          junction: false,
        };
      }
    }
  }

  // 2. Ingest components & auto-create missing nodes for mapped ports
  if (typeof obj.components === "object" && obj.components !== null) {
    for (const [id, c] of Object.entries(obj.components as Record<string, unknown>)) {
      if (typeof c === "object" && c !== null) {
        const compObj = c as Record<string, unknown>;
        const compId = typeof compObj.id === "string" && compObj.id.trim() ? compObj.id.trim() : id.trim();
        if (!compId) continue;

        const rawType = typeof compObj.type === "string" ? compObj.type : "resistor";
        const type: ComponentType = (rawType in COMPONENT_CATALOG)
          ? (rawType as ComponentType)
          : "generic_box";
        if (type !== rawType) reportRepair(`Unknown component type "${rawType}" was displayed as a generic box.`, compId);
        if (![compObj.x, compObj.y].every((v) => typeof v === "number" && Number.isFinite(v))) {
          reportRepair(`Missing or invalid position for "${compId}" was reset to the origin.`, compId);
        }

        const comp: CircuitComponent = {
          id: compId,
          type,
          label: typeof compObj.label === "string" ? compObj.label : (COMPONENT_CATALOG[type]?.defaultLabel || "C"),
          value: typeof compObj.value === "string" ? compObj.value : undefined,
          x: typeof compObj.x === "number" && Number.isFinite(compObj.x) ? compObj.x : 0,
          y: typeof compObj.y === "number" && Number.isFinite(compObj.y) ? compObj.y : 0,
          rotation: typeof compObj.rotation === "number" && Number.isFinite(compObj.rotation) ? ((compObj.rotation % 360) + 360) % 360 : 0,
          mirror: Boolean(compObj.mirror),
          ports: {},
        };

        if (typeof compObj.ports === "object" && compObj.ports !== null) {
          for (const [pId, nId] of Object.entries(compObj.ports as Record<string, unknown>)) {
            if (typeof nId === "string" && nId.trim()) {
              const targetNodeId = nId.trim();
              if (!circuit.nodes[targetNodeId]) {
                reportRepair(`Missing node "${targetNodeId}" was created for ${compId}.${pId}; verify this connection.`, compId);
                const portPos = getComponentPortPosition(comp, pId) ?? { x: comp.x, y: comp.y };
                circuit.nodes[targetNodeId] = {
                  id: targetNodeId,
                  x: portPos.x,
                  y: portPos.y,
                  junction: false,
                };
              }
              comp.ports[pId] = targetNodeId;
            }
          }
        }

        circuit.components[compId] = comp;
      }
    }
  }

  // 3. Ingest wires and discard dangling references, duplicate wires, and self-loops
  const seenWires = new Set<string>();
  if (Array.isArray(obj.wires)) {
    let wireIdx = 1;
    for (const w of obj.wires) {
      if (typeof w === "object" && w !== null) {
        const wireObj = w as Record<string, unknown>;
        const fromNode = typeof wireObj.fromNode === "string" ? wireObj.fromNode.trim() : "";
        const toNode = typeof wireObj.toNode === "string" ? wireObj.toNode.trim() : "";

        // Reject nonexistent nodes, empty strings, or self loops
        if (fromNode && toNode && fromNode !== toNode && circuit.nodes[fromNode] && circuit.nodes[toNode]) {
          const wireKey = `${fromNode}--${toNode}`;
          const reverseKey = `${toNode}--${fromNode}`;
          if (seenWires.has(wireKey) || seenWires.has(reverseKey)) continue;
          seenWires.add(wireKey);

          circuit.wires.push({
            id: typeof wireObj.id === "string" && wireObj.id.trim() ? wireObj.id.trim() : `w${wireIdx++}`,
            fromNode,
            toNode,
            waypoints: Array.isArray(wireObj.waypoints)
              ? wireObj.waypoints
                  .filter((pt: unknown): pt is { x: number; y: number } => {
                    if (typeof pt !== "object" || pt === null) return false;
                    const point = pt as Record<string, unknown>;
                    return typeof point.x === "number" && typeof point.y === "number" && Number.isFinite(point.x) && Number.isFinite(point.y);
                  })
              : undefined,
            direct: wireObj.direct ? true : undefined,
          });
        } else {
          reportRepair(`Wire "${typeof wireObj.id === "string" ? wireObj.id : "unnamed"}" was discarded because its endpoints are missing or identical.`);
        }
      }
    }
  }

  // 4. Ingest any flagged uncertainties
  if (Array.isArray(obj.uncertainties)) {
    circuit.uncertainties = obj.uncertainties.filter((u): u is string => typeof u === "string");
  }

  // 5. Calculate node junctions based on degree (3 or more connected branches)
  const connectionCounts: Record<string, number> = {};
  for (const wire of circuit.wires) {
    connectionCounts[wire.fromNode] = (connectionCounts[wire.fromNode] || 0) + 1;
    connectionCounts[wire.toNode] = (connectionCounts[wire.toNode] || 0) + 1;
  }
  for (const comp of Object.values(circuit.components)) {
    for (const nId of Object.values(comp.ports)) {
      connectionCounts[nId] = (connectionCounts[nId] || 0) + 1;
    }
  }
  for (const [nId, node] of Object.entries(circuit.nodes)) {
    node.junction = (connectionCounts[nId] || 0) >= 3;
  }

  // 6. Run comprehensive electrical connectivity validation
  circuit.diagnostics = [...repairs, ...validateCircuitConnectivity(circuit)];

  return circuit;
}

export interface CircuitDiagnostic {
  severity: "error" | "warning" | "info";
  code:
    | "DANGLING_WIRE"
    | "MISSING_NODE"
    | "INVALID_PORT"
    | "DISCONNECTED_COMPONENT"
    | "UNCONNECTED_TERMINAL"
    | "INTENTIONALLY_OPEN_PORT"
    | "ISOLATED_SUBCIRCUIT"
    | "UNROUTABLE_OBSTRUCTION"
    | "NORMALIZATION_REPAIR"
    | "SHORTED_COMPONENT";
  message: string;
  componentId?: string;
  nodeId?: string;
  wireId?: string;
  portId?: string;
}

/**
 * Validates the electrical connectivity of a circuit netlist:
 * - Detects dangling wire endpoints and dead-end stubs.
 * - Validates component ports against COMPONENT_CATALOG.
 * - Distinguishes intentionally open ports from failed connections.
 * - Detects isolated/disconnected components and isolated subcircuits.
 */
export function validateCircuitConnectivity(circuit: KirchhoffCircuit): CircuitDiagnostic[] {
  const diagnostics: CircuitDiagnostic[] = [];
  const validNodeIds = new Set(Object.keys(circuit.nodes));
  // Electrical nets join only through wires, never through component bodies.
  const netParent = new Map([...validNodeIds].map((id) => [id, id]));
  const findNet = (id: string): string => {
    const parent = netParent.get(id);
    if (!parent || parent === id) return id;
    const root = findNet(parent);
    netParent.set(id, root);
    return root;
  };
  for (const wire of circuit.wires) {
    if (validNodeIds.has(wire.fromNode) && validNodeIds.has(wire.toNode)) {
      netParent.set(findNet(wire.fromNode), findNet(wire.toNode));
    }
  }

  // 1. Check wires
  const nodeWireCount: Record<string, number> = {};
  for (const wire of circuit.wires) {
    if (!validNodeIds.has(wire.fromNode)) {
      diagnostics.push({
        severity: "error",
        code: "MISSING_NODE",
        message: `Wire "${wire.id}" references nonexistent fromNode "${wire.fromNode}".`,
        wireId: wire.id,
        nodeId: wire.fromNode,
      });
    } else {
      nodeWireCount[wire.fromNode] = (nodeWireCount[wire.fromNode] || 0) + 1;
    }

    if (!validNodeIds.has(wire.toNode)) {
      diagnostics.push({
        severity: "error",
        code: "MISSING_NODE",
        message: `Wire "${wire.id}" references nonexistent toNode "${wire.toNode}".`,
        wireId: wire.id,
        nodeId: wire.toNode,
      });
    } else {
      nodeWireCount[wire.toNode] = (nodeWireCount[wire.toNode] || 0) + 1;
    }
  }

  // 2. Check components and port mappings
  const nodeComponentPorts: Record<string, Array<{ compId: string; portId: string }>> = {};
  for (const comp of Object.values(circuit.components)) {
    const def = COMPONENT_CATALOG[comp.type];
    const catalogPortIds = new Set(def ? def.ports.map((p) => p.id) : []);
    if (def?.ports.length === 2 && comp.type !== "switch_spst") {
      const a = comp.ports[def.ports[0].id];
      const b = comp.ports[def.ports[1].id];
      if (a && b && validNodeIds.has(a) && validNodeIds.has(b) && findNet(a) === findNet(b)) {
        diagnostics.push({
          severity: "warning", code: "SHORTED_COMPONENT", componentId: comp.id,
          message: `${comp.label || comp.id} has both terminals on the same electrical net. Check for a wire bypassing this component.`,
        });
      }
    }

    // Check for invalid ports
    for (const [pId, nId] of Object.entries(comp.ports)) {
      if (def && !catalogPortIds.has(pId)) {
        diagnostics.push({
          severity: "warning",
          code: "INVALID_PORT",
          message: `Component "${comp.id}" (${comp.type}) has unknown port "${pId}".`,
          componentId: comp.id,
          portId: pId,
        });
      }

      if (!validNodeIds.has(nId)) {
        diagnostics.push({
          severity: "error",
          code: "MISSING_NODE",
          message: `Component "${comp.id}" port "${pId}" references nonexistent node "${nId}".`,
          componentId: comp.id,
          portId: pId,
          nodeId: nId,
        });
      } else {
        if (!nodeComponentPorts[nId]) nodeComponentPorts[nId] = [];
        nodeComponentPorts[nId].push({ compId: comp.id, portId: pId });
      }
    }

    // Check for missing/unconnected ports
    if (def) {
      const connectedPortIds = new Set(Object.keys(comp.ports));
      for (const port of def.ports) {
        if (!connectedPortIds.has(port.id)) {
          // Distinguish intentionally open terminals
          const isIntentionallyOpen =
            (comp.type === "switch_spst" && port.id === "p2") ||
            (comp.type === "opamp" && (port.id === "vcc" || port.id === "vee"));

          if (isIntentionallyOpen) {
            diagnostics.push({
              severity: "info",
              code: "INTENTIONALLY_OPEN_PORT",
              message: `Component "${comp.id}" has intentionally open terminal "${port.name || port.id}".`,
              componentId: comp.id,
              portId: port.id,
            });
          } else {
            diagnostics.push({
              severity: "warning",
              code: "UNCONNECTED_TERMINAL",
              message: `Component "${comp.id}" (${comp.type}) has unconnected terminal "${port.name || port.id}".`,
              componentId: comp.id,
              portId: port.id,
            });
          }
        }
      }
    }

    // Check for completely disconnected components
    const totalPorts = Object.keys(comp.ports).length;
    if (totalPorts === 0) {
      diagnostics.push({
        severity: "error",
        code: "DISCONNECTED_COMPONENT",
        message: `Component "${comp.id}" (${comp.type}) has no connected terminals.`,
        componentId: comp.id,
      });
    }
  }

  // 3. Check for dangling nodes (degree 1 with only a wire, no components)
  for (const [nodeId, wireCount] of Object.entries(nodeWireCount)) {
    const compPorts = nodeComponentPorts[nodeId] || [];
    if (wireCount === 1 && compPorts.length === 0) {
      diagnostics.push({
        severity: "warning",
        code: "DANGLING_WIRE",
        message: `Node "${nodeId}" terminates with a dangling wire and no connected component.`,
        nodeId,
      });
    }
  }

  // 4. Graph connectivity analysis (connected components)
  const adj: Record<string, Set<string>> = {};
  for (const nodeId of validNodeIds) {
    adj[nodeId] = new Set();
  }
  for (const wire of circuit.wires) {
    if (validNodeIds.has(wire.fromNode) && validNodeIds.has(wire.toNode)) {
      adj[wire.fromNode].add(wire.toNode);
      adj[wire.toNode].add(wire.fromNode);
    }
  }
  for (const comp of Object.values(circuit.components)) {
    const ports = Object.values(comp.ports).filter((nId) => validNodeIds.has(nId));
    for (let i = 0; i < ports.length; i++) {
      for (let j = i + 1; j < ports.length; j++) {
        adj[ports[i]].add(ports[j]);
        adj[ports[j]].add(ports[i]);
      }
    }
  }

  const visited = new Set<string>();
  const subcircuits: string[][] = [];
  for (const nodeId of validNodeIds) {
    if (!visited.has(nodeId)) {
      const componentNodes: string[] = [];
      const queue = [nodeId];
      visited.add(nodeId);
      while (queue.length > 0) {
        const curr = queue.shift()!;
        componentNodes.push(curr);
        for (const neighbor of adj[curr] || []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      subcircuits.push(componentNodes);
    }
  }

  if (subcircuits.length > 1 && Object.keys(circuit.components).length > 1) {
    for (let i = 1; i < subcircuits.length; i++) {
      diagnostics.push({
        severity: "warning",
        code: "ISOLATED_SUBCIRCUIT",
        message: `Subcircuit containing nodes [${subcircuits[i].join(", ")}] is electrically isolated from main circuit.`,
        nodeId: subcircuits[i][0],
      });
    }
  }

  return diagnostics;
}
