import { describe, it, expect } from "vitest";
import {
  scalePattern,
  applyLinetypePattern,
  resolveEntityLinetype,
} from "../linetypeResolver";
import type { DxfEntity, DxfLayer, DxfLineType } from "@/types/dxf";

// ── scalePattern ────────────────────────────────────────────────────

describe("scalePattern", () => {
  it("returns empty for empty or undefined pattern", () => {
    expect(scalePattern([])).toEqual([]);
    expect(scalePattern(undefined as unknown as number[])).toEqual([]);
  });

  it("scales all elements by entityScale * globalLtScale", () => {
    expect(scalePattern([10, -5, 0, -5], 2, 3)).toEqual([60, -30, 0, -30]);
  });

  it("preserves zero elements (dots)", () => {
    expect(scalePattern([0, -5], 2)).toEqual([0, -10]);
  });

  it("defaults scales to 1", () => {
    expect(scalePattern([10, -5])).toEqual([10, -5]);
  });
});

// ── applyLinetypePattern ────────────────────────────────────────────

describe("applyLinetypePattern", () => {
  it("returns empty for less than 2 points", () => {
    const r1 = applyLinetypePattern([{ x: 0, y: 0 }], [10, -5]);
    expect(r1.segments).toEqual([]);
    expect(r1.dots).toEqual([]);
    const r2 = applyLinetypePattern([], [10, -5]);
    expect(r2.segments).toEqual([]);
  });

  it("returns empty for empty pattern", () => {
    const r = applyLinetypePattern([{ x: 0, y: 0 }, { x: 10, y: 0 }], []);
    expect(r.segments).toEqual([]);
  });

  it("returns empty for pattern without gaps (solid)", () => {
    const r = applyLinetypePattern([{ x: 0, y: 0 }, { x: 10, y: 0 }], [5]);
    expect(r.segments).toEqual([]);
  });

  it("creates correct segments for simple dash-gap on horizontal line", () => {
    // Pattern: dash 4, gap 2 on a line of length 10
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    const { segments } = applyLinetypePattern(points, [4, -2]);

    expect(segments.length).toBe(12); // 2 segments × 6 coords
    // First dash: (0,0,0) → (4,0,0)
    expect(segments[0]).toBeCloseTo(0);
    expect(segments[1]).toBeCloseTo(0);
    expect(segments[3]).toBeCloseTo(4);
    // Second dash: (6,0,0) → (10,0,0)
    expect(segments[6]).toBeCloseTo(6);
    expect(segments[9]).toBeCloseTo(10);
  });

  it("handles pattern longer than polyline", () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    const { segments } = applyLinetypePattern(points, [20, -5]);

    expect(segments.length).toBe(6); // 1 segment
    expect(segments[0]).toBeCloseTo(0);
    expect(segments[3]).toBeCloseTo(10);
  });

  it("handles multi-segment polyline", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 6 },
    ];
    const { segments } = applyLinetypePattern(points, [4, -2]);

    expect(segments.length).toBe(12); // 2 segments × 6 coords
    // First dash: (0,0) → (4,0)
    expect(segments[0]).toBeCloseTo(0);
    expect(segments[3]).toBeCloseTo(4);
    // Second dash: (6,0,0) → (6,4,0)
    expect(segments[6]).toBeCloseTo(6);
    expect(segments[7]).toBeCloseTo(0);
    expect(segments[9]).toBeCloseTo(6);
    expect(segments[10]).toBeCloseTo(4);
  });

  it("handles CENTER pattern (long-short dash)", () => {
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const { segments } = applyLinetypePattern(points, [31.75, -6.35, 6.35, -6.35]);

    const segmentCount = segments.length / 6;
    expect(segmentCount).toBeGreaterThanOrEqual(4);

    // First dash should be long: 0 → 31.75
    expect(segments[0]).toBeCloseTo(0);
    expect(segments[3]).toBeCloseTo(31.75);

    // Second dash should be short: 38.1 → 44.45
    expect(segments[6]).toBeCloseTo(38.1);
    expect(segments[9]).toBeCloseTo(44.45);
  });

  it("handles DOT pattern — dots are returned as point positions", () => {
    // DOT: [0, -5] — dot every 5 units
    const points = [{ x: 0, y: 0 }, { x: 15, y: 0 }];
    const { segments, dots } = applyLinetypePattern(points, [0, -5]);

    // No line segments in a DOT-only pattern
    expect(segments.length).toBe(0);

    // Dots at positions 0, 5, 10, 15 (4 dots × 3 coords)
    expect(dots.length).toBe(12);
    expect(dots[0]).toBeCloseTo(0);  // dot 1 at x=0
    expect(dots[3]).toBeCloseTo(5);  // dot 2 at x=5
    expect(dots[6]).toBeCloseTo(10); // dot 3 at x=10
    expect(dots[9]).toBeCloseTo(15); // dot 4 at x=15
  });

  it("handles DASHDOT pattern — dashes and dots together", () => {
    // DASHDOT: [10, -3, 0, -3] on a line of length 32
    // Cycle: dash 10, gap 3, dot, gap 3 (total 16)
    const points = [{ x: 0, y: 0 }, { x: 32, y: 0 }];
    const { segments, dots } = applyLinetypePattern(points, [10, -3, 0, -3]);

    // 2 full cycles: 2 dashes
    const segmentCount = segments.length / 6;
    expect(segmentCount).toBe(2);

    // First dash: 0→10
    expect(segments[0]).toBeCloseTo(0);
    expect(segments[3]).toBeCloseTo(10);

    // Dots at positions 13 and 29
    expect(dots.length).toBeGreaterThanOrEqual(3); // at least 1 dot
    expect(dots[0]).toBeCloseTo(13); // first dot after gap
  });

  it("handles diagonal line", () => {
    const points = [{ x: 0, y: 0 }, { x: 3, y: 4 }]; // length 5
    const { segments } = applyLinetypePattern(points, [3, -2]);

    expect(segments.length).toBe(6); // 1 segment
    expect(segments[3]).toBeCloseTo(3 * 0.6); // x = 1.8
    expect(segments[4]).toBeCloseTo(3 * 0.8); // y = 2.4
  });

  it("handles 3D points", () => {
    const points = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ];
    const { segments } = applyLinetypePattern(points, [4, -2]);

    expect(segments.length).toBe(12);
    expect(segments[2]).toBe(0);
    expect(segments[5]).toBe(0);
  });

  it("skips zero-length polyline segments", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0, y: 0 }, // degenerate
      { x: 10, y: 0 },
    ];
    const { segments } = applyLinetypePattern(points, [4, -2]);

    expect(segments.length).toBe(12);
  });
});

// ── resolveEntityLinetype ───────────────────────────────────────────

describe("resolveEntityLinetype", () => {
  const lineTypes: Record<string, DxfLineType> = {
    DASHED: {
      name: "DASHED",
      description: "Dashed __ __ __",
      pattern: [12.7, -6.35],
      patternLength: 19.05,
    },
    HIDDEN: {
      name: "HIDDEN",
      description: "Hidden _ _ _ _",
      pattern: [6.35, -3.175],
      patternLength: 9.525,
    },
    CENTER: {
      name: "CENTER",
      description: "Center ____ _ ____ _",
      pattern: [31.75, -6.35, 6.35, -6.35],
      patternLength: 50.8,
    },
    CONTINUOUS: {
      name: "CONTINUOUS",
      description: "Solid line",
      pattern: [],
      patternLength: 0,
    },
  };

  const layers: Record<string, DxfLayer> = {
    "0": { name: "0", visible: true, colorIndex: 7, color: 0xffffff, frozen: false },
    Walls: {
      name: "Walls",
      visible: true,
      colorIndex: 1,
      color: 0xff0000,
      frozen: false,
      lineType: "HIDDEN",
    },
    Axes: {
      name: "Axes",
      visible: true,
      colorIndex: 3,
      color: 0x00ff00,
      frozen: false,
      lineType: "CENTER",
    },
    Solid: {
      name: "Solid",
      visible: true,
      colorIndex: 5,
      color: 0x0000ff,
      frozen: false,
      lineType: "CONTINUOUS",
    },
  };

  it("returns null for entity without lineType on layer without lineType", () => {
    const entity = { type: "LINE", layer: "0", vertices: [] } as unknown as DxfEntity;
    expect(resolveEntityLinetype(entity, layers, lineTypes)).toBeNull();
  });

  it("returns null for CONTINUOUS lineType", () => {
    const entity = {
      type: "LINE", layer: "0", lineType: "CONTINUOUS", vertices: [],
    } as unknown as DxfEntity;
    expect(resolveEntityLinetype(entity, layers, lineTypes)).toBeNull();
  });

  it("resolves entity-level lineType and returns full pattern", () => {
    const entity = {
      type: "LINE", layer: "0", lineType: "DASHED", vertices: [],
    } as unknown as DxfEntity;
    const result = resolveEntityLinetype(entity, layers, lineTypes);
    expect(result).not.toBeNull();
    expect(result!.pattern).toEqual([12.7, -6.35]);
  });

  it("resolves CENTER linetype with full 4-element pattern", () => {
    const entity = {
      type: "LINE", layer: "0", lineType: "CENTER", vertices: [],
    } as unknown as DxfEntity;
    const result = resolveEntityLinetype(entity, layers, lineTypes);
    expect(result).not.toBeNull();
    expect(result!.pattern).toEqual([31.75, -6.35, 6.35, -6.35]);
  });

  it("resolves lineType from layer (BYLAYER)", () => {
    const entity = { type: "LINE", layer: "Walls", vertices: [] } as unknown as DxfEntity;
    const result = resolveEntityLinetype(entity, layers, lineTypes);
    expect(result).not.toBeNull();
    expect(result!.pattern).toEqual([6.35, -3.175]);
  });

  it("resolves lineType from layer when entity has explicit BYLAYER", () => {
    const entity = {
      type: "LINE", layer: "Axes", lineType: "BYLAYER", vertices: [],
    } as unknown as DxfEntity;
    const result = resolveEntityLinetype(entity, layers, lineTypes);
    expect(result).not.toBeNull();
    expect(result!.pattern).toEqual([31.75, -6.35, 6.35, -6.35]);
  });

  it("resolves BYBLOCK using blockLineType", () => {
    const entity = {
      type: "LINE", layer: "0", lineType: "BYBLOCK", vertices: [],
    } as unknown as DxfEntity;
    const result = resolveEntityLinetype(entity, layers, lineTypes, 1, "DASHED");
    expect(result).not.toBeNull();
    expect(result!.pattern).toEqual([12.7, -6.35]);
  });

  it("returns null for BYBLOCK when no blockLineType is set", () => {
    const entity = {
      type: "LINE", layer: "0", lineType: "BYBLOCK", vertices: [],
    } as unknown as DxfEntity;
    expect(resolveEntityLinetype(entity, layers, lineTypes)).toBeNull();
  });

  it("returns null for layer with CONTINUOUS lineType", () => {
    const entity = { type: "LINE", layer: "Solid", vertices: [] } as unknown as DxfEntity;
    expect(resolveEntityLinetype(entity, layers, lineTypes)).toBeNull();
  });

  it("applies entity lineTypeScale to pattern", () => {
    const entity = {
      type: "LINE", layer: "0", lineType: "DASHED", lineTypeScale: 2, vertices: [],
    } as unknown as DxfEntity;
    const result = resolveEntityLinetype(entity, layers, lineTypes);
    expect(result).not.toBeNull();
    expect(result!.pattern).toEqual([25.4, -12.7]);
  });

  it("applies global LTSCALE to pattern", () => {
    const entity = {
      type: "LINE", layer: "0", lineType: "DASHED", vertices: [],
    } as unknown as DxfEntity;
    const result = resolveEntityLinetype(entity, layers, lineTypes, 0.5);
    expect(result).not.toBeNull();
    expect(result!.pattern).toEqual([6.35, -3.175]);
  });

  it("is case-insensitive for lineType lookup", () => {
    const entity = {
      type: "LINE", layer: "0", lineType: "dashed", vertices: [],
    } as unknown as DxfEntity;
    const result = resolveEntityLinetype(entity, layers, lineTypes);
    expect(result).not.toBeNull();
    expect(result!.pattern).toEqual([12.7, -6.35]);
  });

  it("returns null for unknown lineType name", () => {
    const entity = {
      type: "LINE", layer: "0", lineType: "NONEXISTENT", vertices: [],
    } as unknown as DxfEntity;
    expect(resolveEntityLinetype(entity, layers, lineTypes)).toBeNull();
  });
});
