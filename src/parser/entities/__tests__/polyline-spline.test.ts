import { describe, it, expect } from "vitest";
import { createScannerAt } from "../../__tests__/test-helpers";
import { parsePolyline, type IPolylineEntity } from "../polyline";
import { parseLWPolyline, type ILWPolylineEntity } from "../lwpolyline";
import { parseSpline, type ISplineEntity } from "../spline";
import { parseEntities } from "../../sections/entities";
import { createScanner, wrapInEntitiesSection } from "../../__tests__/test-helpers";

// =============================================================================
// POLYLINE
// =============================================================================
describe("parsePolyline", () => {
  // -- Basic polyline with 2 vertices -----------------------------------------

  it("parses a basic polyline with 2 vertices", () => {
    const { scanner, group } = createScannerAt(
      "0", "POLYLINE",
      "8", "Layer1",
      "70", "0",
      "0", "VERTEX",
      "10", "0.0",
      "20", "0.0",
      "0", "VERTEX",
      "10", "10.0",
      "20", "5.0",
      "0", "SEQEND",
      "0", "EOF",
    );

    const entity = parsePolyline(scanner, group) as IPolylineEntity;

    expect(entity.type).toBe("POLYLINE");
    expect(entity.layer).toBe("Layer1");
    expect(entity.vertices).toHaveLength(2);
    expect(entity.vertices[0].x).toBe(0);
    expect(entity.vertices[0].y).toBe(0);
    expect(entity.vertices[1].x).toBe(10);
    expect(entity.vertices[1].y).toBe(5);
    expect(entity.shape).toBe(false);
  });

  // -- Polyline with shape flag -----------------------------------------------

  it("parses polyline with shape flag (code 70 = 1)", () => {
    const { scanner, group } = createScannerAt(
      "0", "POLYLINE",
      "8", "Layer1",
      "70", "1",
      "0", "VERTEX",
      "10", "0.0",
      "20", "0.0",
      "0", "VERTEX",
      "10", "5.0",
      "20", "5.0",
      "0", "SEQEND",
      "0", "EOF",
    );

    const entity = parsePolyline(scanner, group) as IPolylineEntity;

    expect(entity.shape).toBe(true);
    expect(entity.includesCurveFitVertices).toBe(false);
    expect(entity.includesSplineFitVertices).toBe(false);
    expect(entity.is3dPolyline).toBe(false);
    expect(entity.is3dPolygonMesh).toBe(false);
    expect(entity.is3dPolygonMeshClosed).toBe(false);
    expect(entity.isPolyfaceMesh).toBe(false);
    expect(entity.hasContinuousLinetypePattern).toBe(false);
  });

  // -- Vertex with bulge ------------------------------------------------------

  it("parses vertex with bulge value (code 42 = 0.5)", () => {
    const { scanner, group } = createScannerAt(
      "0", "POLYLINE",
      "8", "Layer1",
      "0", "VERTEX",
      "10", "0.0",
      "20", "0.0",
      "42", "0.5",
      "0", "VERTEX",
      "10", "10.0",
      "20", "0.0",
      "42", "0",
      "0", "SEQEND",
      "0", "EOF",
    );

    const entity = parsePolyline(scanner, group) as IPolylineEntity;

    expect(entity.vertices).toHaveLength(2);
    expect(entity.vertices[0].bulge).toBe(0.5);
    // bulge of 0 is ignored per the implementation
    expect(entity.vertices[1].bulge).toBeUndefined();
  });

  // -- 3D polyline with Z coordinates -----------------------------------------

  it("parses 3D polyline (code 70 = 8) with Z coordinates on vertices", () => {
    const { scanner, group } = createScannerAt(
      "0", "POLYLINE",
      "8", "Layer1",
      "70", "8",
      "0", "VERTEX",
      "10", "0.0",
      "20", "0.0",
      "30", "1.0",
      "0", "VERTEX",
      "10", "10.0",
      "20", "5.0",
      "30", "2.0",
      "0", "SEQEND",
      "0", "EOF",
    );

    const entity = parsePolyline(scanner, group) as IPolylineEntity;

    expect(entity.is3dPolyline).toBe(true);
    expect(entity.shape).toBe(false);
    expect(entity.vertices).toHaveLength(2);
    expect(entity.vertices[0].z).toBe(1);
    expect(entity.vertices[1].z).toBe(2);
  });

  // -- Polyline with thickness ------------------------------------------------

  it("parses polyline with thickness (code 39)", () => {
    const { scanner, group } = createScannerAt(
      "0", "POLYLINE",
      "8", "Layer1",
      "39", "2.5",
      "0", "VERTEX",
      "10", "0.0",
      "20", "0.0",
      "0", "SEQEND",
      "0", "EOF",
    );

    const entity = parsePolyline(scanner, group) as IPolylineEntity;

    expect(entity.thickness).toBe(2.5);
    expect(entity.vertices).toHaveLength(1);
  });
});

// =============================================================================
// LWPOLYLINE
// =============================================================================
describe("parseLWPolyline", () => {
  // -- Basic lwpolyline with 3 vertices ---------------------------------------

  it("parses a basic lwpolyline with 3 vertices", () => {
    const { scanner, group } = createScannerAt(
      "0", "LWPOLYLINE",
      "8", "Layer1",
      "90", "3",
      "70", "0",
      "10", "0.0",
      "20", "0.0",
      "10", "5.0",
      "20", "5.0",
      "10", "10.0",
      "20", "0.0",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entity = parseLWPolyline(scanner, group) as ILWPolylineEntity;

    expect(entity.type).toBe("LWPOLYLINE");
    expect(entity.layer).toBe("Layer1");
    expect(entity.vertices).toHaveLength(3);
    expect(entity.vertices[0].x).toBe(0);
    expect(entity.vertices[0].y).toBe(0);
    expect(entity.vertices[1].x).toBe(5);
    expect(entity.vertices[1].y).toBe(5);
    expect(entity.vertices[2].x).toBe(10);
    expect(entity.vertices[2].y).toBe(0);
    expect(entity.shape).toBe(false);
  });

  // -- Closed lwpolyline ------------------------------------------------------

  it("parses closed lwpolyline (code 70 = 1, shape=true)", () => {
    const { scanner, group } = createScannerAt(
      "0", "LWPOLYLINE",
      "8", "Layer1",
      "90", "3",
      "70", "1",
      "10", "0.0",
      "20", "0.0",
      "10", "10.0",
      "20", "0.0",
      "10", "5.0",
      "20", "8.66",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entity = parseLWPolyline(scanner, group) as ILWPolylineEntity;

    expect(entity.shape).toBe(true);
    expect(entity.hasContinuousLinetypePattern).toBe(false);
    expect(entity.vertices).toHaveLength(3);
  });

  // -- Vertices with bulge ----------------------------------------------------

  it("parses vertices with bulge (code 42)", () => {
    const { scanner, group } = createScannerAt(
      "0", "LWPOLYLINE",
      "8", "Layer1",
      "90", "2",
      "70", "0",
      "10", "0.0",
      "20", "0.0",
      "42", "1.0",
      "10", "10.0",
      "20", "0.0",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entity = parseLWPolyline(scanner, group) as ILWPolylineEntity;

    expect(entity.vertices).toHaveLength(2);
    expect(entity.vertices[0].bulge).toBe(1.0);
    expect(entity.vertices[1].bulge).toBeUndefined();
  });

  // -- With elevation ---------------------------------------------------------

  it("parses lwpolyline with elevation (code 38)", () => {
    const { scanner, group } = createScannerAt(
      "0", "LWPOLYLINE",
      "8", "Layer1",
      "90", "2",
      "70", "0",
      "38", "5.0",
      "10", "0.0",
      "20", "0.0",
      "10", "10.0",
      "20", "10.0",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entity = parseLWPolyline(scanner, group) as ILWPolylineEntity;

    expect(entity.elevation).toBe(5.0);
    expect(entity.vertices).toHaveLength(2);
  });
});

// =============================================================================
// SPLINE
// =============================================================================
describe("parseSpline", () => {
  // -- Basic spline with control points and knot values -----------------------

  it("parses a basic spline with control points and knot values", () => {
    const { scanner, group } = createScannerAt(
      "0", "SPLINE",
      "8", "Layer1",
      "70", "8",
      "71", "3",
      "72", "4",
      "73", "2",
      "40", "0.0",
      "40", "0.0",
      "40", "1.0",
      "40", "1.0",
      "10", "0.0",
      "20", "0.0",
      "30", "0.0",
      "10", "10.0",
      "20", "5.0",
      "30", "0.0",
      "0", "EOF",
    );

    const entity = parseSpline(scanner, group) as ISplineEntity;

    expect(entity.type).toBe("SPLINE");
    expect(entity.layer).toBe("Layer1");
    expect(entity.degreeOfSplineCurve).toBe(3);
    expect(entity.numberOfKnots).toBe(4);
    expect(entity.numberOfControlPoints).toBe(2);
    expect(entity.planar).toBe(true);

    expect(entity.knotValues).toHaveLength(4);
    expect(entity.knotValues).toEqual([0, 0, 1, 1]);

    expect(entity.controlPoints).toHaveLength(2);
    expect(entity.controlPoints![0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(entity.controlPoints![1]).toEqual({ x: 10, y: 5, z: 0 });
  });

  // -- Spline with fit points ------------------------------------------------

  it("parses a spline with fit points (code 11)", () => {
    const { scanner, group } = createScannerAt(
      "0", "SPLINE",
      "8", "Layer1",
      "70", "8",
      "71", "3",
      "74", "3",
      "11", "0.0",
      "21", "0.0",
      "31", "0.0",
      "11", "5.0",
      "21", "10.0",
      "31", "0.0",
      "11", "10.0",
      "21", "0.0",
      "31", "0.0",
      "0", "EOF",
    );

    const entity = parseSpline(scanner, group) as ISplineEntity;

    expect(entity.numberOfFitPoints).toBe(3);
    expect(entity.fitPoints).toHaveLength(3);
    expect(entity.fitPoints![0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(entity.fitPoints![1]).toEqual({ x: 5, y: 10, z: 0 });
    expect(entity.fitPoints![2]).toEqual({ x: 10, y: 0, z: 0 });
    // No control points defined
    expect(entity.controlPoints).toBeUndefined();
  });

  // -- Closed and periodic flags ----------------------------------------------

  it("parses closed + periodic flags (code 70 = 3)", () => {
    const { scanner, group } = createScannerAt(
      "0", "SPLINE",
      "8", "Layer1",
      "70", "3",
      "71", "3",
      "72", "4",
      "73", "2",
      "40", "0.0",
      "40", "0.0",
      "40", "1.0",
      "40", "1.0",
      "10", "0.0",
      "20", "0.0",
      "30", "0.0",
      "10", "10.0",
      "20", "10.0",
      "30", "0.0",
      "0", "EOF",
    );

    const entity = parseSpline(scanner, group) as ISplineEntity;

    expect(entity.closed).toBe(true);
    expect(entity.periodic).toBe(true);
    expect(entity.rational).toBeUndefined();
    expect(entity.planar).toBeUndefined();
    expect(entity.linear).toBeUndefined();
  });

  // -- Rational spline with weights ------------------------------------------

  it("parses a rational spline with weights (code 70 = 4, code 41)", () => {
    const { scanner, group } = createScannerAt(
      "0", "SPLINE",
      "8", "Layer1",
      "70", "4",
      "71", "2",
      "72", "5",
      "73", "3",
      "40", "0.0",
      "40", "0.0",
      "40", "0.5",
      "40", "1.0",
      "40", "1.0",
      "41", "1.0",
      "41", "0.707",
      "41", "1.0",
      "10", "0.0",
      "20", "0.0",
      "30", "0.0",
      "10", "5.0",
      "20", "5.0",
      "30", "0.0",
      "10", "10.0",
      "20", "0.0",
      "30", "0.0",
      "0", "EOF",
    );

    const entity = parseSpline(scanner, group) as ISplineEntity;

    expect(entity.rational).toBe(true);
    expect(entity.closed).toBeUndefined();
    expect(entity.periodic).toBeUndefined();

    expect(entity.weights).toHaveLength(3);
    expect(entity.weights).toEqual([1.0, 0.707, 1.0]);

    expect(entity.knotValues).toHaveLength(5);
    expect(entity.controlPoints).toHaveLength(3);
  });
});

// =============================================================================
// HELIX (parsed as SPLINE)
// =============================================================================
describe("HELIX entity", () => {
  /**
   * Helper: parse entities from a HELIX wrapped in an ENTITIES section.
   * Skips the SECTION/ENTITIES header (2 groups) so parseEntities can work.
   */
  function parseHelixEntity(...helixDataLines: string[]): ISplineEntity {
    const pairs = wrapInEntitiesSection("0", "HELIX", ...helixDataLines);
    const scanner = createScanner(...pairs);
    scanner.next(); // skip "0 SECTION"
    scanner.next(); // skip "2 ENTITIES"
    const entities = parseEntities(scanner, false);
    expect(entities).toHaveLength(1);
    return entities[0] as ISplineEntity;
  }

  it("parses HELIX as SPLINE type", () => {
    const entity = parseHelixEntity(
      "8", "Layer1",
      "100", "AcDbEntity",
      "100", "AcDbSpline",
      "70", "0",
      "71", "3",
      "72", "4",
      "73", "2",
      "74", "0",
      "40", "0.0",
      "40", "0.0",
      "40", "1.0",
      "40", "1.0",
      "10", "0.0",
      "20", "0.0",
      "30", "0.0",
      "10", "10.0",
      "20", "5.0",
      "30", "0.0",
      "100", "AcDbHelix",
      "90", "31",
      "91", "0",
      "10", "5.0",
      "20", "5.0",
      "30", "0.0",
      "40", "2.5",
      "41", "3.0",
    );

    expect(entity.type).toBe("SPLINE");
    expect(entity.layer).toBe("Layer1");
    expect(entity.degreeOfSplineCurve).toBe(3);
  });

  it("trims AcDbHelix pollution from control points and knots", () => {
    const entity = parseHelixEntity(
      "8", "0",
      "100", "AcDbSpline",
      "70", "0",
      "71", "3",
      "72", "4",
      "73", "2",
      "74", "0",
      "40", "0.0",
      "40", "0.0",
      "40", "1.0",
      "40", "1.0",
      "10", "1.0",
      "20", "2.0",
      "30", "0.0",
      "10", "3.0",
      "20", "4.0",
      "30", "0.0",
      // AcDbHelix section pollutes arrays
      "100", "AcDbHelix",
      "90", "31",
      "91", "0",
      "10", "99.0",   // would add extra control point
      "20", "99.0",
      "30", "0.0",
      "11", "88.0",   // would add extra fit point
      "21", "88.0",
      "31", "0.0",
      "40", "2.5",    // would add extra knot
      "41", "3.0",    // would add extra weight
    );

    // Control points trimmed to 2 (not 3)
    expect(entity.controlPoints).toHaveLength(2);
    expect(entity.controlPoints![0]).toEqual({ x: 1, y: 2, z: 0 });
    expect(entity.controlPoints![1]).toEqual({ x: 3, y: 4, z: 0 });

    // Knot values trimmed to 4 (not 5)
    expect(entity.knotValues).toHaveLength(4);
    expect(entity.knotValues).toEqual([0, 0, 1, 1]);

    // Fit points trimmed to 0 (AcDbHelix code 11 was removed)
    expect(entity.fitPoints).toHaveLength(0);
  });
});
