import { describe, it, expect } from "vitest";
import { pointInPolygon2D, clipSegmentToPolygon } from "../hatch";
import type { Point2D } from "../hatch";

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
});
