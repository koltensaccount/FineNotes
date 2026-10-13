import { COMPONENT_CATALOG, createEmptyCircuit, type ComponentType } from "../../src/circuit/ir";
/** AC source/resistor/diode/ground loop from the user's Beta 44 screenshot. */
export function editorFixture() {
  const c = createEmptyCircuit("AC diode loop");
  const coords = { a: [0, 0], b: [8, 0], m: [8, 4], d: [8, 8], e: [0, 8], g: [5, 8.5] };
  for (const [id, [x, y]] of Object.entries(coords)) c.nodes[id] = { id, x, y };
  for (const [id, type, x, y, rotation, ends] of [
    ["vs", "vsource", 0, 4, 0, ["a", "e"]],
    ["r", "resistor", 8, 2, 90, ["b", "m"]],
    ["di", "diode", 8, 6, 90, ["m", "d"]],
    ["gnd", "ground", 5, 9.3, 0, ["g"]],
  ] as const) {
    const def = COMPONENT_CATALOG[type as ComponentType];
    c.components[id] = {
      id,
      type,
      label: id === "vs" ? "V_s" : id === "r" ? "R" : id === "di" ? "D" : "GND",
      x,
      y,
      rotation,
      ports: Object.fromEntries(def.ports.map((p, i) => [p.id, ends[i]])),
    };
  }
  c.wires = [
    { id: "top", fromNode: "a", toNode: "b" },
    { id: "bottom-left", fromNode: "e", toNode: "g" },
    { id: "bottom-right", fromNode: "g", toNode: "d" },
  ];
  return c;
}
export function terminalPartition(c: ReturnType<typeof editorFixture>) {
  const parent = new Map(Object.keys(c.nodes).map((id) => [id, id]));
  function root(id: string): string {
    const p = parent.get(id)!;
    return p === id ? id : root(p);
  }
  for (const w of c.wires) parent.set(root(w.fromNode), root(w.toNode));
  const groups = new Map<string, string[]>();
  for (const comp of Object.values(c.components))
    for (const [port, node] of Object.entries(comp.ports)) {
      const id = root(node),
        group = groups.get(id) ?? [];
      group.push(`${comp.id}/${port}`);
      groups.set(id, group);
    }
  return [...groups.values()].map((g) => g.sort().join(",")).sort();
}
