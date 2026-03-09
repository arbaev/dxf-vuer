import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  pointInPolygon2D,
  clipSegmentToPolygon,
  isPointInsideHatch,
  clipSegmentToPolygons,
  generateHatchPattern,
  boundaryPathToPoint2DArray,
  addBoundaryPathToShapePath,
  buildSolidHatchShapes,
} from "../hatch";
import type { Point2D } from "../hatch";
import type { HatchPatternLine, HatchBoundaryPath } from "@/types/dxf";

// ── pointInPolygon2D ──────────────────────────────────────────────────

describe("pointInPolygon2D", () => {
  // Unit square polygon (10x10) for basic tests
  const square: Point2D[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  describe("square polygon", () => {
    it("returns true for a point clearly inside the polygon", () => {
      expect(pointInPolygon2D(5, 5, square)).toBe(true);
    });

    it("returns false for a point to the right of the polygon", () => {
      expect(pointInPolygon2D(15, 5, square)).toBe(false);
    });

    it("returns false for a point below and to the left of the polygon", () => {
      expect(pointInPolygon2D(-1, -1, square)).toBe(false);
    });

    it("returns false for a point just outside the right edge", () => {
      expect(pointInPolygon2D(11, 5, square)).toBe(false);
    });
  });

  describe("triangle polygon", () => {
    const triangle: Point2D[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ];

    it("returns true for a point inside the triangle", () => {
      expect(pointInPolygon2D(5, 3, triangle)).toBe(true);
    });

    it("returns false for a point outside the triangle (top-left corner area)", () => {
      expect(pointInPolygon2D(0, 10, triangle)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("documents behavior for a point on the bottom edge of the square", () => {
      // Point on the bottom edge (y=0, between x=0 and x=10).
      // Ray casting behavior on edges is implementation-dependent.
      // This implementation considers the point on the bottom edge as inside,
      // because the ray cast from (5,0) crosses the left vertical edge (x=0)
      // where one vertex has y=0 (not > py) and the other has y=10 (> py),
      // triggering a single crossing, resulting in "inside".
      const result = pointInPolygon2D(5, 0, square);
      expect(result).toBe(true);
    });

    it("documents behavior for a point at a vertex of the polygon", () => {
      // Point exactly at vertex (0,0).
      // Ray casting at a vertex is implementation-dependent.
      // This implementation considers the origin vertex as inside due to
      // the left-edge crossing logic: the edge from (0,10) to (0,0) triggers
      // a crossing because (10 > 0) !== (0 > 0) is true, and px=0 is not
      // strictly less than the x-intercept (also 0), so no crossing there,
      // but the edge from (10,10) to (0,10) with the wrap-around path
      // produces one net crossing.
      const result = pointInPolygon2D(0, 0, square);
      expect(result).toBe(true);
    });

    it("returns false for a degenerate polygon with only 2 points", () => {
      const degenerate: Point2D[] = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ];
      // A 2-point polygon has no area; the ray should never cross it in a meaningful way.
      expect(pointInPolygon2D(5, 5, degenerate)).toBe(false);
    });
  });
});

// ── clipSegmentToPolygon ──────────────────────────────────────────────

describe("clipSegmentToPolygon", () => {
  // Unit square polygon (10x10) used for all clipping tests
  const square: Point2D[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("returns the full segment when it is entirely inside the polygon", () => {
    const result = clipSegmentToPolygon(2, 2, 8, 8, square);
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBeCloseTo(2);
    expect(result[0][1]).toBeCloseTo(2);
    expect(result[0][2]).toBeCloseTo(8);
    expect(result[0][3]).toBeCloseTo(8);
  });

  it("returns an empty array when the segment is entirely outside the polygon", () => {
    const result = clipSegmentToPolygon(12, 12, 15, 15, square);
    expect(result).toHaveLength(0);
  });

  it("clips a horizontal line that crosses through the entire polygon", () => {
    const result = clipSegmentToPolygon(-5, 5, 15, 5, square);
    expect(result).toHaveLength(1);
    // The clipped segment should run from x=0 to x=10, y=5
    expect(result[0][0]).toBeCloseTo(0);
    expect(result[0][1]).toBeCloseTo(5);
    expect(result[0][2]).toBeCloseTo(10);
    expect(result[0][3]).toBeCloseTo(5);
  });

  it("clips a segment that starts inside and ends outside to the right", () => {
    const result = clipSegmentToPolygon(5, 5, 15, 5, square);
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBeCloseTo(5);
    expect(result[0][1]).toBeCloseTo(5);
    expect(result[0][2]).toBeCloseTo(10);
    expect(result[0][3]).toBeCloseTo(5);
  });

  it("clips a segment that starts outside to the left and ends inside", () => {
    const result = clipSegmentToPolygon(-5, 5, 5, 5, square);
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBeCloseTo(0);
    expect(result[0][1]).toBeCloseTo(5);
    expect(result[0][2]).toBeCloseTo(5);
    expect(result[0][3]).toBeCloseTo(5);
  });

  it("clips a diagonal line passing through both sides of the polygon", () => {
    // Diagonal from (-5,0) to (15,10) crosses the left edge at (0, 2.5)
    // and the right edge at (10, 7.5).
    const result = clipSegmentToPolygon(-5, 0, 15, 10, square);
    expect(result).toHaveLength(1);
    const seg = result[0];
    expect(seg[0]).toBeCloseTo(0);
    expect(seg[1]).toBeCloseTo(2.5);
    expect(seg[2]).toBeCloseTo(10);
    expect(seg[3]).toBeCloseTo(7.5);
  });

  it("clips a line passing through polygon vertices (corner-to-corner diagonal)", () => {
    // Line from (-5,-5) to (15,15) passes through vertices (0,0) and (10,10).
    // Each vertex is shared by two polygon edges — must not double-toggle inside/outside.
    const result = clipSegmentToPolygon(-5, -5, 15, 15, square);
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBeCloseTo(0);
    expect(result[0][1]).toBeCloseTo(0);
    expect(result[0][2]).toBeCloseTo(10);
    expect(result[0][3]).toBeCloseTo(10);
  });

  it("produces no segments for tangential vertex touch on adjacent polygon", () => {
    // ANSI32 polygon (10-20, 0-10) shares vertex (10,10) with ANSI31 polygon.
    // A 45° line through (0,0) passes through (10,10) tangentially —
    // it touches the vertex but doesn't enter the polygon interior.
    const poly2: Point2D[] = [
      { x: 20, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ];
    const result = clipSegmentToPolygon(-20, -20, 25, 25, poly2);
    // Line only touches vertex (10,10) — should produce NO segments
    expect(result).toHaveLength(0);
  });
});

// ── isPointInsideHatch (multi-boundary even-odd) ────────────────────

describe("isPointInsideHatch", () => {
  const outer: Point2D[] = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ];
  const inner: Point2D[] = [
    { x: 5, y: 5 },
    { x: 15, y: 5 },
    { x: 15, y: 15 },
    { x: 5, y: 15 },
  ];

  it("returns true for a point inside the outer polygon only", () => {
    expect(isPointInsideHatch(2, 2, [outer, inner])).toBe(true);
  });

  it("returns false for a point inside both polygons (even-odd hole)", () => {
    expect(isPointInsideHatch(10, 10, [outer, inner])).toBe(false);
  });

  it("returns false for a point outside all polygons", () => {
    expect(isPointInsideHatch(25, 25, [outer, inner])).toBe(false);
  });

  it("returns true for single polygon case", () => {
    expect(isPointInsideHatch(10, 10, [outer])).toBe(true);
  });
});

// ── clipSegmentToPolygons ───────────────────────────────────────────

describe("clipSegmentToPolygons", () => {
  const outer: Point2D[] = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ];
  const inner: Point2D[] = [
    { x: 5, y: 5 },
    { x: 15, y: 5 },
    { x: 15, y: 15 },
    { x: 5, y: 15 },
  ];

  it("clips horizontal line through donut — excludes inner region", () => {
    // Line y=10 from x=-5 to x=25 through donut
    const result = clipSegmentToPolygons(-5, 10, 25, 10, [outer, inner]);
    // Should produce 2 segments: x=0..5 and x=15..20
    expect(result).toHaveLength(2);
    expect(result[0][0]).toBeCloseTo(0);
    expect(result[0][2]).toBeCloseTo(5);
    expect(result[1][0]).toBeCloseTo(15);
    expect(result[1][2]).toBeCloseTo(20);
  });

  it("falls back to single-polygon clipping for one boundary", () => {
    const result = clipSegmentToPolygons(-5, 10, 25, 10, [outer]);
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBeCloseTo(0);
    expect(result[0][2]).toBeCloseTo(20);
  });
});

// ── generateHatchPattern ────────────────────────────────────────────

describe("generateHatchPattern", () => {
  const square: Point2D[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("returns segments for a solid pattern line", () => {
    const lines: HatchPatternLine[] = [
      { angle: 0, basePoint: { x: 0, y: 0 }, offset: { x: 0, y: 2 }, dashes: [] },
    ];
    const result = generateHatchPattern(lines, [square]);
    expect(result.segmentVertices.length).toBeGreaterThan(0);
    expect(result.dotPositions).toHaveLength(0);
  });

  it("returns dots for dash=0 elements", () => {
    // Pattern: short dash, gap, dot
    const lines: HatchPatternLine[] = [
      { angle: 0, basePoint: { x: 0, y: 0 }, offset: { x: 0, y: 2 }, dashes: [1, -1, 0] },
    ];
    const result = generateHatchPattern(lines, [square]);
    expect(result.segmentVertices.length).toBeGreaterThan(0);
    expect(result.dotPositions.length).toBeGreaterThan(0);
  });

  it("applies pattern scale to spacing and dashes", () => {
    const lines: HatchPatternLine[] = [
      { angle: 0, basePoint: { x: 0, y: 0 }, offset: { x: 0, y: 1 }, dashes: [] },
    ];
    const result1 = generateHatchPattern(lines, [square], 1);
    const result2 = generateHatchPattern(lines, [square], 2);
    // With scale=2, spacing doubles, so half as many lines → fewer segment vertices
    expect(result2.segmentVertices.length).toBeLessThan(result1.segmentVertices.length);
  });

  it("applies pattern angle rotation", () => {
    const lines: HatchPatternLine[] = [
      { angle: 0, basePoint: { x: 0, y: 0 }, offset: { x: 0, y: 2 }, dashes: [] },
    ];
    const result0 = generateHatchPattern(lines, [square], 1, 0);
    const result45 = generateHatchPattern(lines, [square], 1, 45);
    // Both should produce segments but with different angles
    expect(result0.segmentVertices.length).toBeGreaterThan(0);
    expect(result45.segmentVertices.length).toBeGreaterThan(0);
  });

  it("keeps all segments within polygon bounds (ANSI31 scenario)", () => {
    // Exact ANSI31 parameters from ansi_pattern.dxf
    const poly1: Point2D[] = [
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const lines: HatchPatternLine[] = [
      {
        angle: 45,
        basePoint: { x: 0, y: 0 },
        offset: { x: -0.0883883476483184, y: 0.0883883476483185 },
        dashes: [],
      },
    ];
    const result = generateHatchPattern(lines, [poly1]);
    expect(result.segmentVertices.length).toBeGreaterThan(0);
    // Verify all segment vertices are within polygon bbox [0,10] × [0,10]
    for (let i = 0; i < result.segmentVertices.length; i += 3) {
      expect(result.segmentVertices[i]).toBeGreaterThanOrEqual(-0.001);
      expect(result.segmentVertices[i]).toBeLessThanOrEqual(10.001);
      expect(result.segmentVertices[i + 1]).toBeGreaterThanOrEqual(-0.001);
      expect(result.segmentVertices[i + 1]).toBeLessThanOrEqual(10.001);
    }
  });

  it("keeps all segments within polygon bounds (ANSI32 scenario)", () => {
    // Exact ANSI32 parameters from ansi_pattern.dxf
    const poly2: Point2D[] = [
      { x: 20, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ];
    const lines: HatchPatternLine[] = [
      {
        angle: 45,
        basePoint: { x: 0, y: 0 },
        offset: { x: -0.2651650429449553, y: 0.2651650429449553 },
        dashes: [],
      },
      {
        angle: 45,
        basePoint: { x: 0.176776695, y: 0 },
        offset: { x: -0.2651650429449553, y: 0.2651650429449553 },
        dashes: [],
      },
    ];
    const result = generateHatchPattern(lines, [poly2]);
    expect(result.segmentVertices.length).toBeGreaterThan(0);
    // Verify all segment vertices are within polygon bbox [10,20] × [0,10]
    for (let i = 0; i < result.segmentVertices.length; i += 3) {
      expect(result.segmentVertices[i]).toBeGreaterThanOrEqual(10 - 0.001);
      expect(result.segmentVertices[i]).toBeLessThanOrEqual(20.001);
      expect(result.segmentVertices[i + 1]).toBeGreaterThanOrEqual(-0.001);
      expect(result.segmentVertices[i + 1]).toBeLessThanOrEqual(10.001);
    }
  });

  it("clips pattern to donut shape (multi-boundary)", () => {
    const outer: Point2D[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];
    const inner: Point2D[] = [
      { x: 5, y: 5 },
      { x: 15, y: 5 },
      { x: 15, y: 15 },
      { x: 5, y: 15 },
    ];

    const lines: HatchPatternLine[] = [
      { angle: 0, basePoint: { x: 0, y: 0 }, offset: { x: 0, y: 2 }, dashes: [] },
    ];

    const resultSingle = generateHatchPattern(lines, [outer]);
    const resultDonut = generateHatchPattern(lines, [outer, inner]);

    // Donut should have more segment vertex pairs (each line split into 2)
    // segmentVertices / 6 = number of segment pairs
    expect(resultDonut.segmentVertices.length / 6).toBeGreaterThan(resultSingle.segmentVertices.length / 6);
  });
});

// ── addBoundaryPathToShapePath (solid fill donut) ──────────────────

describe("addBoundaryPathToShapePath", () => {
  it("adds a polyline boundary as a subpath", () => {
    const shapePath = new THREE.ShapePath();
    const bp: HatchBoundaryPath = {
      polylineVertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 0, y: 0 },
      ],
    };
    expect(addBoundaryPathToShapePath(shapePath, bp)).toBe(true);
    expect(shapePath.subPaths.length).toBe(1);
  });

  it("returns false for empty boundary", () => {
    const shapePath = new THREE.ShapePath();
    expect(addBoundaryPathToShapePath(shapePath, {})).toBe(false);
    expect(shapePath.subPaths.length).toBe(0);
  });

  it("adds edge-based boundary as a subpath", () => {
    const shapePath = new THREE.ShapePath();
    const bp: HatchBoundaryPath = {
      edges: [{
        type: "arc" as const,
        center: { x: 0, y: 0 },
        radius: 10,
        startAngle: 0,
        endAngle: 360,
        ccw: true,
      }],
    };
    expect(addBoundaryPathToShapePath(shapePath, bp)).toBe(true);
    expect(shapePath.subPaths.length).toBe(1);
  });
});

// ── buildSolidHatchShapes ─────────────────────────────────────────

describe("buildSolidHatchShapes", () => {
  it("returns single shape for single boundary", () => {
    const bp: HatchBoundaryPath = {
      polylineVertices: [
        { x: 0, y: 0 }, { x: 10, y: 0 },
        { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 },
      ],
    };
    const shapes = buildSolidHatchShapes([bp]);
    expect(shapes.length).toBe(1);
    expect(shapes[0].extractPoints(12).holes.length).toBe(0);
  });

  it("returns empty array for empty boundary paths", () => {
    expect(buildSolidHatchShapes([])).toHaveLength(0);
  });

  it("builds donut from two concentric circles with same winding (both CCW)", () => {
    // Real DXF scenario: both arcs are CCW 0°→360°, but inner should be a hole
    const outerBp: HatchBoundaryPath = {
      edges: [{
        type: "arc" as const,
        center: { x: 0, y: 0 },
        radius: 10,
        startAngle: 0,
        endAngle: 360,
        ccw: true,
      }],
    };
    const innerBp: HatchBoundaryPath = {
      edges: [{
        type: "arc" as const,
        center: { x: 0, y: 0 },
        radius: 5,
        startAngle: 0,
        endAngle: 360,
        ccw: true,
      }],
    };

    const shapes = buildSolidHatchShapes([outerBp, innerBp]);
    expect(shapes.length).toBe(1);

    const extracted = shapes[0].extractPoints(12);
    expect(extracted.holes.length).toBe(1);
  });

  it("builds donut from two concentric circles with opposite winding", () => {
    const outerBp: HatchBoundaryPath = {
      edges: [{
        type: "arc" as const,
        center: { x: 0, y: 0 },
        radius: 10,
        startAngle: 0,
        endAngle: 360,
        ccw: true,
      }],
    };
    const innerBp: HatchBoundaryPath = {
      edges: [{
        type: "arc" as const,
        center: { x: 0, y: 0 },
        radius: 5,
        startAngle: 360,
        endAngle: 0,
        ccw: false,
      }],
    };

    const shapes = buildSolidHatchShapes([outerBp, innerBp]);
    expect(shapes.length).toBe(1);
    expect(shapes[0].extractPoints(12).holes.length).toBe(1);
  });

  it("handles nested even-odd: 3 concentric squares", () => {
    const outer: HatchBoundaryPath = {
      polylineVertices: [
        { x: 0, y: 0 }, { x: 30, y: 0 },
        { x: 30, y: 30 }, { x: 0, y: 30 }, { x: 0, y: 0 },
      ],
    };
    const middle: HatchBoundaryPath = {
      polylineVertices: [
        { x: 5, y: 5 }, { x: 25, y: 5 },
        { x: 25, y: 25 }, { x: 5, y: 25 }, { x: 5, y: 5 },
      ],
    };
    const inner: HatchBoundaryPath = {
      polylineVertices: [
        { x: 10, y: 10 }, { x: 20, y: 10 },
        { x: 20, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 10 },
      ],
    };

    const shapes = buildSolidHatchShapes([outer, middle, inner]);
    // outer = shape, middle = hole of outer, inner = new outer shape
    expect(shapes.length).toBe(2);
  });
});

// ── boundaryPathToPoint2DArray ──────────────────────────────────────

describe("boundaryPathToPoint2DArray", () => {
  it("converts line edges to Point2D array", () => {
    const bp: HatchBoundaryPath = {
      edges: [
        { type: "line" as const, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
        { type: "line" as const, start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
        { type: "line" as const, start: { x: 10, y: 10 }, end: { x: 0, y: 0 } },
      ],
    };
    const pts = boundaryPathToPoint2DArray(bp);
    expect(pts.length).toBe(4); // start + 3 ends
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[1]).toEqual({ x: 10, y: 0 });
    expect(pts[2]).toEqual({ x: 10, y: 10 });
    expect(pts[3]).toEqual({ x: 0, y: 0 });
  });

  it("converts polyline vertices to Point2D array", () => {
    const bp: HatchBoundaryPath = {
      polylineVertices: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
        { x: 0, y: 5 },
        { x: 0, y: 0 },
      ],
    };
    const pts = boundaryPathToPoint2DArray(bp);
    expect(pts.length).toBe(5);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[4]).toEqual({ x: 0, y: 0 });
  });

  it("returns empty array for empty boundary path", () => {
    const bp: HatchBoundaryPath = {};
    const pts = boundaryPathToPoint2DArray(bp);
    expect(pts).toHaveLength(0);
  });
});
