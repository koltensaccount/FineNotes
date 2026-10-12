import { describe, it, expect } from "vitest";
import type { CircuitWire, CircuitNode } from "../../src/circuit/ir";
import { dragWireSegment } from "../../src/circuit/wire-geometry";

describe("Continuous wire dragging with successive pointer movements", () => {
  it("maintains segment identity and avoids accumulating redundant bends over successive moves", () => {
    // A horizontal wire from (0, 0) to (10, 0)
    const initialWire: CircuitWire = {
      id: "w1",
      fromNode: "n1",
      toNode: "n2",
    };
    const initialNodes: Record<string, CircuitNode> = {
      n1: { id: "n1", x: 0, y: 0 },
      n2: { id: "n2", x: 10, y: 0 },
    };

    // Original segment index 0 (horizontal line)
    const segmentIndex = 0;

    // Successive pointer movements simulating continuous drag
    const moveYPositions = [1, 2, 3.5, 5, 2, 0];

    let lastWaypoints = undefined;
    for (const targetY of moveYPositions) {
      // Calculate update using snapshot baseline
      const waypoints = dragWireSegment(initialWire, initialNodes, segmentIndex, targetY);

      if (targetY === 0) {
        // Dragging back to original line should collapse back to 0 waypoints (straight line)
        expect(waypoints).toHaveLength(0);
      } else {
        // Orthogonal reshaping creates a 3-segment path with 2 waypoints: (0, targetY) and (10, targetY)
        expect(waypoints).toHaveLength(2);
        expect(waypoints[0]).toEqual({ x: 0, y: targetY });
        expect(waypoints[1]).toEqual({ x: 10, y: targetY });
      }
      lastWaypoints = waypoints;
    }

    expect(lastWaypoints).toHaveLength(0);
  });

  it("handles successive vertical segment dragging from snapshot baseline", () => {
    // A vertical wire from (5, 0) to (5, 10)
    const initialWire: CircuitWire = {
      id: "w2",
      fromNode: "n1",
      toNode: "n2",
    };
    const initialNodes: Record<string, CircuitNode> = {
      n1: { id: "n1", x: 5, y: 0 },
      n2: { id: "n2", x: 5, y: 10 },
    };

    const segmentIndex = 0;
    const moveXPositions = [6, 8, 4, 5];

    for (const targetX of moveXPositions) {
      const waypoints = dragWireSegment(initialWire, initialNodes, segmentIndex, targetX);
      if (targetX === 5) {
        expect(waypoints).toHaveLength(0);
      } else {
        expect(waypoints).toHaveLength(2);
        expect(waypoints[0]).toEqual({ x: targetX, y: 0 });
        expect(waypoints[1]).toEqual({ x: targetX, y: 10 });
      }
    }
  });

  it("reshapes an already-bent wire without compounding waypoints across multiple moves", () => {
    // Wire with an existing bend: (0,0) -> (4,0) -> (4,6) -> (10,6)
    const initialWire: CircuitWire = {
      id: "w3",
      fromNode: "n1",
      toNode: "n2",
      waypoints: [
        { x: 4, y: 0 },
        { x: 4, y: 6 },
      ],
    };
    const initialNodes: Record<string, CircuitNode> = {
      n1: { id: "n1", x: 0, y: 0 },
      n2: { id: "n2", x: 10, y: 6 },
    };

    // Middle vertical segment is between index 1 (4,0) and 2 (4,6) -> segmentIndex 1
    const middleSegment = 1;
    const moveXPositions = [5, 7, 2, 4];

    for (const targetX of moveXPositions) {
      const waypoints = dragWireSegment(initialWire, initialNodes, middleSegment, targetX);
      // Both internal bends should shift their x coordinate to targetX
      expect(waypoints).toHaveLength(2);
      expect(waypoints[0]).toEqual({ x: targetX, y: 0 });
      expect(waypoints[1]).toEqual({ x: targetX, y: 6 });
    }
  });
});
