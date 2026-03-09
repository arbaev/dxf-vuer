import { describe, it, expect } from "vitest";
import { computePointDisplaySize } from "@/composables/geometry/collectors";
import { POINT_SYMBOL_DEFAULT_SIZE } from "@/constants";

describe("computePointDisplaySize", () => {
  it("returns default size for undefined header", () => {
    expect(computePointDisplaySize(undefined)).toBe(POINT_SYMBOL_DEFAULT_SIZE);
  });

  it("returns default size when $PDSIZE is missing", () => {
    expect(computePointDisplaySize({})).toBe(POINT_SYMBOL_DEFAULT_SIZE);
  });

  it("returns positive $PDSIZE as-is", () => {
    expect(computePointDisplaySize({ "$PDSIZE": 5 })).toBe(5);
  });

  it("returns absolute value for negative $PDSIZE", () => {
    expect(computePointDisplaySize({ "$PDSIZE": -3 })).toBe(3);
  });

  it("computes 5% of drawing height when $PDSIZE=0 and extents are valid", () => {
    const header = {
      "$PDSIZE": 0,
      "$EXTMIN": { x: 0, y: 0, z: 0 },
      "$EXTMAX": { x: 100, y: 200, z: 0 },
    };
    // 5% of 200 = 10
    expect(computePointDisplaySize(header)).toBe(10);
  });

  it("returns default when $PDSIZE=0 and extents are missing", () => {
    expect(computePointDisplaySize({ "$PDSIZE": 0 })).toBe(POINT_SYMBOL_DEFAULT_SIZE);
  });

  it("returns default when $PDSIZE=0 and extents are equal (zero-size)", () => {
    const header = {
      "$PDSIZE": 0,
      "$EXTMIN": { x: 0, y: 0, z: 0 },
      "$EXTMAX": { x: 0, y: 0, z: 0 },
    };
    expect(computePointDisplaySize(header)).toBe(POINT_SYMBOL_DEFAULT_SIZE);
  });

  it("returns default when $PDSIZE=0 and extents are inverted", () => {
    const header = {
      "$PDSIZE": 0,
      "$EXTMIN": { x: 1e20, y: 1e20, z: 1e20 },
      "$EXTMAX": { x: -1e20, y: -1e20, z: -1e20 },
    };
    expect(computePointDisplaySize(header)).toBe(POINT_SYMBOL_DEFAULT_SIZE);
  });
});
