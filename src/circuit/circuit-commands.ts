/**
 * Undoable commands for circuit diagrams in the document model.
 *
 * Implements identity-preserving stroke replacement and circuit editing,
 * ensuring complete undo/redo reversibility without data loss.
 */

import type { Command } from "../model/commands";
import {
  type CircuitElement,
  type InkDocument,
  type Stroke,
  pageById,
} from "../model/document";

interface RemovedStroke {
  index: number;
  stroke: Stroke;
}

/**
 * Replaces selected handwritten strokes with a generated circuit diagram.
 * Undoing cleanly restores all original strokes to their original indices,
 * geometry, and timing.
 */
export class ReplaceStrokesWithCircuitCommand implements Command {
  readonly label: string;
  private removedStrokesState: RemovedStroke[] | null = null;
  private placedCircuit: CircuitElement | null = null;

  constructor(
    readonly pageId: string,
    private readonly strokesToRemove: readonly Stroke[],
    private readonly circuit: CircuitElement,
    label = "Convert to CircuitikZ",
  ) {
    this.label = label;
  }

  apply(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;

    // Remove strokes and save original indices
    const removed: RemovedStroke[] = [];
    const targets = new Set(this.strokesToRemove);

    for (let i = page.strokes.length - 1; i >= 0; i--) {
      if (targets.has(page.strokes[i])) {
        removed.push({ index: i, stroke: page.strokes[i] });
        page.strokes.splice(i, 1);
      }
    }
    this.removedStrokesState = removed;

    // Add circuit to page
    if (!page.circuits) {
      page.circuits = [];
    }
    this.placedCircuit = this.circuit;
    page.circuits.push(this.circuit);
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;

    // Remove placed circuit
    if (page.circuits && this.placedCircuit) {
      const idx = page.circuits.indexOf(this.placedCircuit);
      if (idx >= 0) {
        page.circuits.splice(idx, 1);
      }
    }

    // Restore original strokes in ascending index order
    if (this.removedStrokesState) {
      for (let k = this.removedStrokesState.length - 1; k >= 0; k--) {
        const { index, stroke } = this.removedStrokesState[k];
        page.strokes.splice(Math.min(index, page.strokes.length), 0, stroke);
      }
    }

    this.removedStrokesState = null;
    this.placedCircuit = null;
  }
}

/** Updates a circuit's IR or parameters in place with undo/redo */
export class UpdateCircuitCommand implements Command {
  readonly label: string;
  private previousSnapshot: CircuitElement | null = null;

  constructor(
    readonly pageId: string,
    private readonly circuitId: string,
    private readonly next: CircuitElement,
    label = "Edit circuit",
  ) {
    this.label = label;
  }

  apply(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page || !page.circuits) return;

    const circuit = page.circuits.find((c) => c.id === this.circuitId);
    if (!circuit) return;

    this.previousSnapshot = structuredClone(circuit);
    circuit.x = this.next.x;
    circuit.y = this.next.y;
    circuit.w = this.next.w;
    circuit.h = this.next.h;
    circuit.rotation = this.next.rotation;
    circuit.locked = this.next.locked;
    circuit.ir = structuredClone(this.next.ir);
    circuit.tikz = this.next.tikz;
    circuit.svg = this.next.svg;
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page || !page.circuits || !this.previousSnapshot) return;

    const circuit = page.circuits.find((c) => c.id === this.circuitId);
    if (!circuit) return;

    circuit.x = this.previousSnapshot.x;
    circuit.y = this.previousSnapshot.y;
    circuit.w = this.previousSnapshot.w;
    circuit.h = this.previousSnapshot.h;
    circuit.rotation = this.previousSnapshot.rotation;
    circuit.locked = this.previousSnapshot.locked;
    circuit.ir = structuredClone(this.previousSnapshot.ir);
    circuit.tikz = this.previousSnapshot.tikz;
    circuit.svg = this.previousSnapshot.svg;

    this.previousSnapshot = null;
  }
}

/** Adds a new circuit element to a page */
export class AddCircuitCommand implements Command {
  readonly label: string;

  constructor(
    readonly pageId: string,
    private readonly circuit: CircuitElement,
    label = "Add circuit",
  ) {
    this.label = label;
  }

  apply(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    if (!page.circuits) page.circuits = [];
    page.circuits.push(this.circuit);
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page || !page.circuits) return;
    const idx = page.circuits.indexOf(this.circuit);
    if (idx >= 0) page.circuits.splice(idx, 1);
  }
}
