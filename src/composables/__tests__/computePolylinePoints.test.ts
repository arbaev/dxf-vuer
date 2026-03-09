import { describe, it, expect } from "vitest";
import { computePolylinePoints } from "@/composables/geometry/collectors";
import type { DxfEntity, DxfVertex } from "@/types/dxf";

function makePolyEntity(
  vertices: DxfVertex[],
  shape: boolean,
): DxfEntity & { vertices: DxfVertex[]; shape?: boolean } {
  return { type: "LWPOLYLINE", vertices, shape } as DxfEntity & {
    vertices: DxfVertex[];
    shape?: boolean;
  };
}

describe("computePolylinePoints", () => {
  it("2-vertex closed polyline with bulge=1 produces a full circle (donut)", () => {
    // Two vertices with bulge=1 → two semicircles → full circle
    const entity = makePolyEntity(
      [
        { x: 9.5, y: 17.5, bulge: 1.0 },
        { x: 10.5, y: 17.5, bulge: 1.0 },
      ],
      true,
    );
    const points = computePolylinePoints(entity);

    // First point should be the start vertex
    expect(points[0].x).toBeCloseTo(9.5);
    expect(points[0].y).toBeCloseTo(17.5);

    // Last point should return close to the start (full circle)
    const last = points[points.length - 1];
    expect(last.x).toBeCloseTo(9.5, 1);
    expect(last.y).toBeCloseTo(17.5, 1);

    // Should have more than just 2 points (arc interpolation)
    expect(points.length).toBeGreaterThan(10);
  });

  it("2-vertex closed polyline without bulge produces a closed line", () => {
    const entity = makePolyEntity(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      true,
    );
    const points = computePolylinePoints(entity);

    // Should have 3 points: start → end → back to start
    expect(points.length).toBe(3);
    expect(points[0].x).toBeCloseTo(0);
    expect(points[0].y).toBeCloseTo(0);
    expect(points[1].x).toBeCloseTo(10);
    expect(points[1].y).toBeCloseTo(0);
    expect(points[2].x).toBeCloseTo(0);
    expect(points[2].y).toBeCloseTo(0);
  });

  it("3-vertex closed polyline with bulge still works (no regression)", () => {
    const entity = makePolyEntity(
      [
        { x: 0, y: 0, bulge: 0.5 },
        { x: 10, y: 0, bulge: 0.5 },
        { x: 5, y: 10, bulge: 0.5 },
      ],
      true,
    );
    const points = computePolylinePoints(entity);

    // First point is the start
    expect(points[0].x).toBeCloseTo(0);
    expect(points[0].y).toBeCloseTo(0);

    // Last point should close back near the start
    const last = points[points.length - 1];
    expect(last.x).toBeCloseTo(0, 1);
    expect(last.y).toBeCloseTo(0, 1);

    // Should have arc interpolation points
    expect(points.length).toBeGreaterThan(6);
  });
});
