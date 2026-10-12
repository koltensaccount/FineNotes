import {
  COMPONENT_CATALOG,
  getComponentPortPosition,
  type ComponentType,
  type KirchhoffCircuit,
} from "./ir";

/** Remap two-terminal devices by terminal order; preserve named pins for other devices. */
export function changeComponentType(
  circuit: KirchhoffCircuit,
  id: string,
  type: ComponentType,
): void {
  const comp = circuit.components[id];
  if (!comp) return;
  const oldDef = COMPONENT_CATALOG[comp.type];
  const newDef = COMPONENT_CATALOG[type];
  const oldPorts = comp.ports;
  const ports: Record<string, string> = {};
  for (let i = 0; i < newDef.ports.length; i++) {
    const port = newDef.ports[i];
    // Match by exact port name first, or fallback to ordinal index if terminal counts match
    let oldId: string | undefined;
    if (oldPorts[port.id]) {
      oldId = port.id;
    } else if (oldDef.ports.length === newDef.ports.length && oldDef.ports[i]) {
      oldId = oldDef.ports[i].id;
    } else if (oldDef.ports.length === 2 && newDef.ports.length === 2 && oldDef.ports[i]) {
      oldId = oldDef.ports[i].id;
    }
    const nodeId = oldId ? oldPorts[oldId] : undefined;
    if (nodeId && circuit.nodes[nodeId]) ports[port.id] = nodeId;
  }
  comp.type = type;
  comp.ports = ports;
  // Keep connected nets where they are. The renderer draws the new terminal leads.
  for (const port of newDef.ports) {
    if (ports[port.id]) continue;
    let nodeId = `n_${comp.id}_${port.id}`;
    let suffix = 1;
    while (circuit.nodes[nodeId]) nodeId = `n_${comp.id}_${port.id}_${suffix++}`;
    const point = getComponentPortPosition(comp, port.id)!;
    circuit.nodes[nodeId] = { id: nodeId, ...point };
    ports[port.id] = nodeId;
  }
}
