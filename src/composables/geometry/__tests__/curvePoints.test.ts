import { describe, it, expect } from "vitest";
import {
  generateCirclePoints,
  generateArcPoints,
  generateEllipsePoints,
} from "../curvePoints";
import { CIRCLE_SEGMENTS, MIN_ARC_SEGMENTS } from "@/constants";

// ── generateCirclePoints ──────────────────────────────────────────────

describe("generateCirclePoints", () => {
  it("returns CIRCLE_SEGMENTS + 1 points by default", () => {
    const pts = generateCirclePoints(0, 0, 0, 10);
    expect(pts).toHaveLength(CIRCLE_SEGMENTS + 1);
  });

  it("returns custom segment count + 1 when specified", () => {
    const pts = generateCirclePoints(0, 0, 0, 10, 16);
    expect(pts).toHaveLength(17);
  });

  it("first and last point are at the same position (closed loop)", () => {
    const pts = generateCirclePoints(5, 3, 1, 10);
    const first = pts[0];
    const last = pts[pts.length - 1];
    expect(first.x).toBeCloseTo(last.x, 10);
    expect(first.y).toBeCloseTo(last.y, 10);
    expect(first.z).toBeCloseTo(last.z, 10);
  });

  it("all points are at the specified radius from center", () => {
    const cx = 5, cy = -3, cz = 2, r = 7;
    const pts = generateCirclePoints(cx, cy, cz, r);
    for (const p of pts) {
      const dist = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
      expect(dist).toBeCloseTo(r, 10);
    }
  });

  it("all points have the specified Z coordinate", () => {
    const pts = generateCirclePoints(0, 0, 42, 10);
    for (const p of pts) {
      expect(p.z).toBe(42);
    }
  });

  it("first point starts at angle 0 (rightmost point)", () => {
    const pts = generateCirclePoints(0, 0, 0, 10);
    expect(pts[0].x).toBeCloseTo(10, 10);
    expect(pts[0].y).toBeCloseTo(0, 10);
  });
});

// ── generateArcPoints ─────────────────────────────────────────────────

describe("generateArcPoints", () => {
  it("returns at least MIN_ARC_SEGMENTS + 1 points for a small arc", () => {
    // 10-degree arc -- very small sweep
    const start = 0;
    const end = (10 * Math.PI) / 180;
    const pts = generateArcPoints(0, 0, 0, 10, start, end);
    expect(pts.length).toBeGreaterThanOrEqual(MIN_ARC_SEGMENTS + 1);
  });

  it("produces correct segment count for a quarter arc", () => {
    const start = 0;
    const end = Math.PI / 2;
    const pts = generateArcPoints(0, 0, 0, 10, start, end);
    // sweep = pi/2, segments = max(8, floor(pi/2 * 64 / 2pi)) = max(8, 16) = 16
    expect(pts).toHaveLength(17);
  });

  it("all points are at the specified radius from center", () => {
    const cx = 3, cy = -5, cz = 1, r = 12;
    const pts = generateArcPoints(cx, cy, cz, r, 0, Math.PI);
    for (const p of pts) {
      const dist = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
      expect(dist).toBeCloseTo(r, 10);
    }
  });

  it("wraps correctly when endAngle <= startAngle", () => {
    // Arc from 350 degrees to 10 degrees (crossing 0)
    const start = (350 * Math.PI) / 180;
    const end = (10 * Math.PI) / 180;
    const pts = generateArcPoints(0, 0, 0, 10, start, end);
    // sweep = 20 degrees after wrapping
    // First point should be at 350 degrees
    expect(pts[0].x).toBeCloseTo(10 * Math.cos(start), 8);
    expect(pts[0].y).toBeCloseTo(10 * Math.sin(start), 8);
    // Last point should be at 10 degrees
    const last = pts[pts.length - 1];
    expect(last.x).toBeCloseTo(10 * Math.cos(end), 8);
    expect(last.y).toBeCloseTo(10 * Math.sin(end), 8);
  });

  it("semicircle has correct first and last points", () => {
    const pts = generateArcPoints(0, 0, 0, 5, 0, Math.PI);
    expect(pts[0].x).toBeCloseTo(5, 10);
    expect(pts[0].y).toBeCloseTo(0, 10);
    const last = pts[pts.length - 1];
    expect(last.x).toBeCloseTo(-5, 10);
    expect(last.y).toBeCloseTo(0, 10);
  });

  it("preserves Z coordinate", () => {
    const pts = generateArcPoints(0, 0, 99, 10, 0, Math.PI);
    for (const p of pts) {
      expect(p.z).toBe(99);
    }
  });
});

// ── generateEllipsePoints ─────────────────────────────────────────────

describe("generateEllipsePoints", () => {
  describe("full ellipse", () => {
    it("returns correct number of points for full ellipse (0 to 2PI)", () => {
      const pts = generateEllipsePoints(0, 0, 0, 10, 0, 0.5, 0, 2 * Math.PI);
      // segments = max(8, floor(2pi * 64 / 2pi)) = 64
      expect(pts).toHaveLength(CIRCLE_SEGMENTS + 1);
    });

    it("returns correct number of points for full ellipse (0 to 0)", () => {
      const pts = generateEllipsePoints(0, 0, 0, 10, 0, 0.5, 0, 0);
      expect(pts).toHaveLength(CIRCLE_SEGMENTS + 1);
    });

    it("first and last point are the same for full ellipse", () => {
      const pts = generateEllipsePoints(0, 0, 0, 10, 0, 0.5, 0, 2 * Math.PI);
      const first = pts[0];
      const last = pts[pts.length - 1];
      expect(first.x).toBeCloseTo(last.x, 8);
      expect(first.y).toBeCloseTo(last.y, 8);
    });

    it("produces points along both major and minor axes", () => {
      // Major axis along X (10,0), axisRatio=0.5 -> minor axis length = 5
      const pts = generateEllipsePoints(0, 0, 0, 10, 0, 0.5, 0, 2 * Math.PI);
      // First point at angle 0: (majorLength, 0) = (10, 0)
      expect(pts[0].x).toBeCloseTo(10, 6);
      expect(pts[0].y).toBeCloseTo(0, 6);
      // Quarter point at angle PI/2: (0, minorLength) = (0, 5)
      const quarterIdx = Math.round(CIRCLE_SEGMENTS / 4);
      expect(pts[quarterIdx].x).toBeCloseTo(0, 6);
      expect(pts[quarterIdx].y).toBeCloseTo(5, 6);
    });
  });

  describe("elliptical arc", () => {
    it("produces a CCW arc by default", () => {
      // Quarter arc from 0 to PI/2
      const pts = generateEllipsePoints(0, 0, 0, 10, 0, 0.5, 0, Math.PI / 2);
      // First point at (10, 0)
      expect(pts[0].x).toBeCloseTo(10, 6);
      expect(pts[0].y).toBeCloseTo(0, 6);
      // Last point at (0, 5) -- minor axis at PI/2
      const last = pts[pts.length - 1];
      expect(last.x).toBeCloseTo(0, 6);
      expect(last.y).toBeCloseTo(5, 6);
    });

    it("produces a CW arc when ccw=false", () => {
      // From 0 to PI/2, but CW -> sweeps the long way (3PI/2 CW = -3PI/2)
      const pts = generateEllipsePoints(0, 0, 0, 10, 0, 0.5, 0, Math.PI / 2, false);
      // First point at (10, 0)
      expect(pts[0].x).toBeCloseTo(10, 6);
      // Last point at (0, 5)
      const last = pts[pts.length - 1];
      expect(last.x).toBeCloseTo(0, 6);
      expect(last.y).toBeCloseTo(5, 6);
      // CW arc goes through negative Y, so should have more points than a quarter arc
      // sweep = PI/2 - 2*PI = -3PI/2, segments = floor(3/4 * 64) = 48
      expect(pts.length).toBeGreaterThan(20);
    });
  });

  describe("rotated ellipse", () => {
    it("rotates points according to major axis direction", () => {
      // Major axis at 45 degrees: majorX=7.07, majorY=7.07 (length~10)
      const len = 10;
      const angle = Math.PI / 4;
      const mx = len * Math.cos(angle);
      const my = len * Math.sin(angle);
      const pts = generateEllipsePoints(0, 0, 0, mx, my, 0.5, 0, 2 * Math.PI);
      // First point at angle 0 in local coords = major axis direction = (mx, my) = (7.07, 7.07)
      expect(pts[0].x).toBeCloseTo(mx, 4);
      expect(pts[0].y).toBeCloseTo(my, 4);
    });
  });

  describe("degenerate cases", () => {
    it("returns empty array for zero-length major axis", () => {
      const pts = generateEllipsePoints(0, 0, 0, 0, 0, 0.5, 0, 2 * Math.PI);
      expect(pts).toHaveLength(0);
    });

    it("returns empty array for very small major axis", () => {
      const pts = generateEllipsePoints(0, 0, 0, 0.00001, 0, 0.5, 0, 2 * Math.PI);
      expect(pts).toHaveLength(0);
    });
  });

  describe("segmentOverride", () => {
    it("uses the provided segment count override", () => {
      const pts = generateEllipsePoints(0, 0, 0, 10, 0, 0.5, 0, 2 * Math.PI, true, 8);
      expect(pts).toHaveLength(9); // 8 segments + 1
    });
  });

  describe("center offset", () => {
    it("offsets all points by center coordinates", () => {
      const cx = 100, cy = 200, cz = 50;
      const pts = generateEllipsePoints(cx, cy, cz, 10, 0, 1, 0, 2 * Math.PI);
      // For a circle (axisRatio=1), all points should be at radius 10 from center
      for (const p of pts) {
        const dist = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
        expect(dist).toBeCloseTo(10, 6);
        expect(p.z).toBe(cz);
      }
    });
  });
});
