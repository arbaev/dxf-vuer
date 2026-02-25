import { describe, it, expect } from "vitest";
import { createScannerAt } from "../../__tests__/test-helpers";

import { parseLine } from "../line";
import { parseCircle } from "../circle";
import { parseArc } from "../arc";
import { parsePoint } from "../point";
import { parseEllipse } from "../ellipse";
import { parseSolid } from "../solid";
import { parse3DFace } from "../3dface";

// All test data ends with "0", "ENDSEC", "0", "EOF" to avoid scanner EOF
// issues caused by parsePoint's Z-coordinate look-ahead. In real DXF files,
// entities are always terminated by ENDSEC before EOF.

// =============================================================================
// LINE
// =============================================================================
describe("parseLine", () => {
  it("parses a basic line with two vertices and layer", () => {
    const { scanner, group } = createScannerAt(
      "0", "LINE",
      "8", "Layer1",
      "10", "1.0",
      "20", "2.0",
      "11", "10.0",
      "21", "20.0",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entity = parseLine(scanner, group);

    expect(entity.type).toBe("LINE");
    expect(entity.layer).toBe("Layer1");
    expect(entity.vertices).toHaveLength(2);
    // Code 10 vertex is unshifted (prepended), code 11 is pushed (appended)
    expect(entity.vertices[0]).toEqual({ x: 1, y: 2 });
    expect(entity.vertices[1]).toEqual({ x: 10, y: 20 });
  });

  it("parses a line with extrusion direction", () => {
    const { scanner, group } = createScannerAt(
      "0", "LINE",
      "10", "0.0",
      "20", "0.0",
      "11", "5.0",
      "21", "5.0",
      "210", "0.0",
      "220", "0.0",
      "230", "1.0",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entity = parseLine(scanner, group);

    expect(entity.type).toBe("LINE");
    expect(entity.extrusionDirection).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("parses common properties such as colorIndex", () => {
    const { scanner, group } = createScannerAt(
      "0", "LINE",
      "8", "Layer1",
      "62", "5",
      "10", "0.0",
      "20", "0.0",
      "11", "1.0",
      "21", "1.0",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entity = parseLine(scanner, group);

    expect(entity.type).toBe("LINE");
    expect(entity.layer).toBe("Layer1");
    expect(entity.colorIndex).toBe(5);
  });
});

// =============================================================================
// CIRCLE
// =============================================================================
describe("parseCircle", () => {
  it("parses a basic circle with center, radius, and layer", () => {
    const { scanner, group } = createScannerAt(
      "0", "CIRCLE",
      "8", "Geometry",
      "10", "5.0",
      "20", "10.0",
      "40", "2.5",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entity = parseCircle(scanner, group);

    expect(entity.type).toBe("CIRCLE");
    expect(entity.layer).toBe("Geometry");
    expect(entity.center).toEqual({ x: 5, y: 10 });
    expect(entity.radius).toBe(2.5);
  });

  it("parses common properties such as colorIndex", () => {
    const { scanner, group } = createScannerAt(
      "0", "CIRCLE",
      "62", "3",
      "10", "0.0",
      "20", "0.0",
      "40", "1.0",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entity = parseCircle(scanner, group);

    expect(entity.type).toBe("CIRCLE");
    expect(entity.colorIndex).toBe(3);
  });
});

// =============================================================================
// ARC
// =============================================================================
describe("parseArc", () => {
  it("parses a basic arc and converts degrees to radians", () => {
    const { scanner, group } = createScannerAt(
      "0", "ARC",
      "8", "Layer1",
      "10", "5.0",
      "20", "5.0",
      "40", "3.0",
      "50", "0",
      "51", "90",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entity = parseArc(scanner, group);

    expect(entity.type).toBe("ARC");
    expect(entity.layer).toBe("Layer1");
    expect(entity.center).toEqual({ x: 5, y: 5 });
    expect(entity.radius).toBe(3);
    // 0 degrees -> 0 radians
    expect(entity.startAngle).toBe(0);
    // 90 degrees -> PI/2 radians
    expect(entity.endAngle).toBeCloseTo(Math.PI / 2, 10);
  });

  it("parses an arc with extrusion direction", () => {
    const { scanner, group } = createScannerAt(
      "0", "ARC",
      "10", "0.0",
      "20", "0.0",
      "40", "1.0",
      "50", "0",
      "51", "180",
      "210", "0.0",
      "220", "0.0",
      "230", "-1.0",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entity = parseArc(scanner, group);

    expect(entity.type).toBe("ARC");
    expect(entity.extrusionDirection).toEqual({ x: 0, y: 0, z: -1 });
  });

  it("computes angleLength as endAngle minus startAngle", () => {
    const { scanner, group } = createScannerAt(
      "0", "ARC",
      "10", "0.0",
      "20", "0.0",
      "40", "1.0",
      "50", "45",
      "51", "270",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entity = parseArc(scanner, group);

    const expectedStart = (Math.PI / 180) * 45;
    const expectedEnd = (Math.PI / 180) * 270;
    expect(entity.startAngle).toBeCloseTo(expectedStart, 10);
    expect(entity.endAngle).toBeCloseTo(expectedEnd, 10);
    expect(entity.angleLength).toBeCloseTo(expectedEnd - expectedStart, 10);
  });
});

// =============================================================================
// POINT
// =============================================================================
describe("parsePoint (entity)", () => {
  it("parses a basic point with position", () => {
    const { scanner, group } = createScannerAt(
      "0", "POINT",
      "8", "Points",
      "10", "3.5",
      "20", "7.2",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entity = parsePoint(scanner, group);

    expect(entity.type).toBe("POINT");
    expect(entity.layer).toBe("Points");
    expect(entity.position).toEqual({ x: 3.5, y: 7.2 });
  });

  it("parses a point with thickness", () => {
    const { scanner, group } = createScannerAt(
      "0", "POINT",
      "10", "1.0",
      "20", "2.0",
      "30", "3.0",
      "39", "0.5",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entity = parsePoint(scanner, group);

    expect(entity.type).toBe("POINT");
    expect(entity.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(entity.thickness).toBe(0.5);
  });
});

// =============================================================================
// ELLIPSE
// =============================================================================
describe("parseEllipse", () => {
  it("parses a full ellipse (startAngle=0, endAngle=2*PI)", () => {
    const { scanner, group } = createScannerAt(
      "0", "ELLIPSE",
      "8", "Layer1",
      "10", "10.0",
      "20", "20.0",
      "11", "5.0",
      "21", "0.0",
      "40", "0.5",
      "41", "0.0",
      "42", "6.283185307",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entity = parseEllipse(scanner, group);

    expect(entity.type).toBe("ELLIPSE");
    expect(entity.layer).toBe("Layer1");
    expect(entity.center).toEqual({ x: 10, y: 20 });
    expect(entity.majorAxisEndPoint).toEqual({ x: 5, y: 0 });
    expect(entity.axisRatio).toBe(0.5);
    expect(entity.startAngle).toBe(0);
    expect(entity.endAngle).toBeCloseTo(2 * Math.PI, 5);
  });

  it("parses a partial ellipse with all properties", () => {
    const { scanner, group } = createScannerAt(
      "0", "ELLIPSE",
      "62", "1",
      "10", "0.0",
      "20", "0.0",
      "30", "0.0",
      "11", "10.0",
      "21", "0.0",
      "31", "0.0",
      "40", "0.3",
      "41", "0.785398",
      "42", "3.141593",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entity = parseEllipse(scanner, group);

    expect(entity.type).toBe("ELLIPSE");
    expect(entity.colorIndex).toBe(1);
    expect(entity.center).toEqual({ x: 0, y: 0, z: 0 });
    expect(entity.majorAxisEndPoint).toEqual({ x: 10, y: 0, z: 0 });
    expect(entity.axisRatio).toBe(0.3);
    expect(entity.startAngle).toBeCloseTo(0.785398, 5);
    expect(entity.endAngle).toBeCloseTo(Math.PI, 5);
  });
});

// =============================================================================
// SOLID
// =============================================================================
describe("parseSolid", () => {
  it("parses a solid with 4 corner points", () => {
    const { scanner, group } = createScannerAt(
      "0", "SOLID",
      "8", "Layer1",
      "10", "0.0",
      "20", "0.0",
      "11", "10.0",
      "21", "0.0",
      "12", "10.0",
      "22", "5.0",
      "13", "0.0",
      "23", "5.0",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entity = parseSolid(scanner, group);

    expect(entity.type).toBe("SOLID");
    expect(entity.layer).toBe("Layer1");
    expect(entity.points).toHaveLength(4);
    expect(entity.points[0]).toEqual({ x: 0, y: 0 });
    expect(entity.points[1]).toEqual({ x: 10, y: 0 });
    expect(entity.points[2]).toEqual({ x: 10, y: 5 });
    expect(entity.points[3]).toEqual({ x: 0, y: 5 });
  });

  it("parses a solid with extrusion direction", () => {
    const { scanner, group } = createScannerAt(
      "0", "SOLID",
      "10", "0.0",
      "20", "0.0",
      "11", "1.0",
      "21", "0.0",
      "12", "1.0",
      "22", "1.0",
      "13", "0.0",
      "23", "1.0",
      "210", "0.0",
      "220", "0.0",
      "230", "1.0",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entity = parseSolid(scanner, group);

    expect(entity.type).toBe("SOLID");
    expect(entity.extrusionDirection).toEqual({ x: 0, y: 0, z: 1 });
  });
});

// =============================================================================
// 3DFACE
// =============================================================================
describe("parse3DFace", () => {
  it("parses a 3DFACE with 4 vertices", () => {
    const { scanner, group } = createScannerAt(
      "0", "3DFACE",
      "8", "Faces",
      "10", "0.0",
      "20", "0.0",
      "30", "0.0",
      "11", "10.0",
      "21", "0.0",
      "31", "0.0",
      "12", "10.0",
      "22", "10.0",
      "32", "0.0",
      "13", "0.0",
      "23", "10.0",
      "33", "0.0",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entity = parse3DFace(scanner, group);

    expect(entity.type).toBe("3DFACE");
    expect(entity.layer).toBe("Faces");
    expect(entity.vertices).toHaveLength(4);
    expect(entity.vertices[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(entity.vertices[1]).toEqual({ x: 10, y: 0, z: 0 });
    expect(entity.vertices[2]).toEqual({ x: 10, y: 10, z: 0 });
    expect(entity.vertices[3]).toEqual({ x: 0, y: 10, z: 0 });
  });

  it("parses shape flag bits correctly", () => {
    const { scanner, group } = createScannerAt(
      "0", "3DFACE",
      "70", "129",
      "10", "0.0",
      "20", "0.0",
      "30", "0.0",
      "11", "1.0",
      "21", "0.0",
      "31", "0.0",
      "12", "1.0",
      "22", "1.0",
      "32", "0.0",
      "13", "0.0",
      "23", "1.0",
      "33", "0.0",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entity = parse3DFace(scanner, group);

    expect(entity.type).toBe("3DFACE");
    // 129 = 0b10000001 -> bit 1 (shape) = true, bit 128 (continuous) = true
    expect(entity.shape).toBe(true);
    expect(entity.hasContinuousLinetypePattern).toBe(true);
  });

  it("handles fewer than 4 vertices when non-vertex code interrupts", () => {
    // The vertex parser returns early via its default branch when it encounters
    // a code that is not a vertex coordinate (10-13, 20-23, 30-33).
    // The early return happens BEFORE the current vertex is pushed, so only
    // previously completed vertices are included in the result.
    const { scanner, group } = createScannerAt(
      "0", "3DFACE",
      "10", "0.0",
      "20", "0.0",
      "30", "0.0",
      "11", "5.0",
      "21", "5.0",
      "31", "5.0",
      "8", "Layer1",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entity = parse3DFace(scanner, group);

    expect(entity.type).toBe("3DFACE");
    // The vertex parser completes vertex 0, then starts vertex 1 but hits
    // code 8 (layer) before finishing it, so it returns with only vertex 0.
    expect(entity.vertices).toHaveLength(1);
    expect(entity.vertices[0]).toEqual({ x: 0, y: 0, z: 0 });
  });
});
