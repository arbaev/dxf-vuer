import { describe, it, expect } from "vitest";
import {
  formatDimNumber,
  cleanDimensionMText,
  extractDimensionData,
  intersectLines2D,
  normalizeAngle,
  isAngleInSweep,
} from "../dimensions";
import type { DxfDimensionEntity } from "@/types/dxf";

// Helper to build minimal DxfDimensionEntity objects for testing
const makeDimEntity = (
  overrides: Partial<DxfDimensionEntity> = {},
): DxfDimensionEntity =>
  ({
    type: "DIMENSION" as const,
    ...overrides,
  }) as DxfDimensionEntity;

// =====================================================================
// formatDimNumber
// =====================================================================

describe("formatDimNumber", () => {
  it("formats an integer without trailing zeros", () => {
    expect(formatDimNumber(28)).toBe("28");
  });

  it("formats a number with meaningful decimals", () => {
    expect(formatDimNumber(28.28)).toBe("28.28");
  });

  it("strips trailing zeros after the decimal point", () => {
    expect(formatDimNumber(28.1)).toBe("28.1");
  });

  it("preserves up to 4 decimal places", () => {
    expect(formatDimNumber(0.0001)).toBe("0.0001");
  });

  it("formats zero as '0'", () => {
    expect(formatDimNumber(0)).toBe("0");
  });

  it("strips trailing zeros from mixed decimals", () => {
    expect(formatDimNumber(100.5)).toBe("100.5");
  });

  it("keeps all 4 significant decimal digits for large numbers", () => {
    expect(formatDimNumber(12345.6789)).toBe("12345.6789");
  });

  it("rounds very small values beyond 4 decimal places to zero", () => {
    expect(formatDimNumber(0.00001)).toBe("0");
  });
});

// =====================================================================
// cleanDimensionMText
// =====================================================================

describe("cleanDimensionMText", () => {
  it("returns plain text unchanged", () => {
    expect(cleanDimensionMText("25.40")).toBe("25.40");
  });

  it("removes alignment codes (\\A1;)", () => {
    expect(cleanDimensionMText("\\A1;25.40")).toBe("25.40");
  });

  it("removes font codes (\\fArial|b0|i0;)", () => {
    expect(cleanDimensionMText("\\fArial|b0|i0;Hello")).toBe("Hello");
  });

  it("removes color codes (\\c1; and \\C1;)", () => {
    expect(cleanDimensionMText("\\c1;Red")).toBe("Red");
    expect(cleanDimensionMText("\\C5;Blue")).toBe("Blue");
  });

  it("removes height codes (\\H2.5; and \\h2.5;)", () => {
    expect(cleanDimensionMText("\\H2.5;Text")).toBe("Text");
    expect(cleanDimensionMText("\\h3.0;Text")).toBe("Text");
  });

  it("removes underline/overline/strikethrough toggles (\\L, \\O, \\K)", () => {
    expect(cleanDimensionMText("\\LUnderlined\\L")).toBe("Underlined");
    expect(cleanDimensionMText("\\OOverlined\\O")).toBe("Overlined");
    expect(cleanDimensionMText("\\KStrikethrough\\K")).toBe("Strikethrough");
  });

  it("replaces \\P (paragraph break) with space", () => {
    expect(cleanDimensionMText("Line1\\PLine2")).toBe("Line1 Line2");
  });

  it("removes curly braces", () => {
    expect(cleanDimensionMText("{25.40}")).toBe("25.40");
  });

  it("converts Unicode escape sequences (\\U+XXXX)", () => {
    // U+0041 = 'A', U+00B0 = degree sign
    expect(cleanDimensionMText("\\U+0041")).toBe("A");
    expect(cleanDimensionMText("45\\U+00B0")).toBe("45\u00B0");
  });

  it("converts special character codes (%%d -> deg, %%p -> plus/minus, %%c -> diameter)", () => {
    expect(cleanDimensionMText("90%%d")).toBe("90\u00B0");
    expect(cleanDimensionMText("%%p0.01")).toBe("\u00B10.01");
    expect(cleanDimensionMText("%%c25")).toBe("\u00D825");
  });

  it("restores escaped backslash, braces", () => {
    expect(cleanDimensionMText("\\\\path")).toBe("\\path");
    expect(cleanDimensionMText("\\{brace\\}")).toBe("{brace}");
  });

  it("handles combined formatting codes", () => {
    expect(cleanDimensionMText("{\\fArial;\\H2.5;\\C1;25.40}")).toBe("25.40");
  });
});

// =====================================================================
// extractDimensionData
// =====================================================================

describe("extractDimensionData", () => {
  it("returns null when point1, point2 are missing and no radial fallback", () => {
    const entity = makeDimEntity({
      anchorPoint: { x: 0, y: 0 },
      actualMeasurement: 10,
    });
    expect(extractDimensionData(entity)).toBeNull();
  });

  it("returns null when anchorPoint is missing", () => {
    const entity = makeDimEntity({
      linearOrAngularPoint1: { x: 0, y: 0 },
      linearOrAngularPoint2: { x: 10, y: 0 },
      actualMeasurement: 10,
    });
    expect(extractDimensionData(entity)).toBeNull();
  });

  it("returns data with text computed from actualMeasurement", () => {
    const entity = makeDimEntity({
      linearOrAngularPoint1: { x: 0, y: 0 },
      linearOrAngularPoint2: { x: 10, y: 0 },
      anchorPoint: { x: 5, y: 5 },
      actualMeasurement: 28.5,
    });
    const result = extractDimensionData(entity);
    expect(result).not.toBeNull();
    expect(result!.dimensionText).toBe("28.5");
    expect(result!.isRadial).toBe(false);
  });

  it("replaces <> placeholder with formatted measurement", () => {
    const entity = makeDimEntity({
      linearOrAngularPoint1: { x: 0, y: 0 },
      linearOrAngularPoint2: { x: 10, y: 0 },
      anchorPoint: { x: 5, y: 5 },
      text: "Length: <>",
      actualMeasurement: 42.1,
    });
    const result = extractDimensionData(entity);
    expect(result).not.toBeNull();
    expect(result!.dimensionText).toBe("Length: 42.1");
  });

  it("detects radial dimension and adds 'R' prefix", () => {
    const entity = makeDimEntity({
      diameterOrRadiusPoint: { x: 10, y: 0 },
      anchorPoint: { x: 0, y: 0 },
      actualMeasurement: 10,
    });
    const result = extractDimensionData(entity);
    expect(result).not.toBeNull();
    expect(result!.isRadial).toBe(true);
    expect(result!.dimensionText).toBe("R10");
  });

  it("computes measurement from coordinates when no text or actualMeasurement", () => {
    const entity = makeDimEntity({
      linearOrAngularPoint1: { x: 0, y: 0 },
      linearOrAngularPoint2: { x: 3, y: 4 },
      anchorPoint: { x: 1, y: 5 },
    });
    const result = extractDimensionData(entity);
    expect(result).not.toBeNull();
    // distance = sqrt(9+16) = 5
    expect(result!.dimensionText).toBe("5");
  });

  it("uses entity.textHeight when provided", () => {
    const entity = makeDimEntity({
      linearOrAngularPoint1: { x: 0, y: 0 },
      linearOrAngularPoint2: { x: 10, y: 0 },
      anchorPoint: { x: 5, y: 5 },
      actualMeasurement: 10,
      textHeight: 3.5,
    });
    const result = extractDimensionData(entity);
    expect(result).not.toBeNull();
    expect(result!.textHeight).toBe(3.5);
  });

  it("falls back to DIM_TEXT_HEIGHT (5) when textHeight is not set", () => {
    const entity = makeDimEntity({
      linearOrAngularPoint1: { x: 0, y: 0 },
      linearOrAngularPoint2: { x: 10, y: 0 },
      anchorPoint: { x: 5, y: 5 },
      actualMeasurement: 10,
    });
    const result = extractDimensionData(entity);
    expect(result).not.toBeNull();
    expect(result!.textHeight).toBe(5);
  });

  it("replaces <> in radial dimension text with R-prefixed measurement", () => {
    const entity = makeDimEntity({
      diameterOrRadiusPoint: { x: 5, y: 0 },
      anchorPoint: { x: 0, y: 0 },
      text: "<>",
      actualMeasurement: 5,
    });
    const result = extractDimensionData(entity);
    expect(result).not.toBeNull();
    expect(result!.dimensionText).toBe("R5");
  });
});

// =====================================================================
// intersectLines2D
// =====================================================================

describe("intersectLines2D", () => {
  it("finds intersection of perpendicular lines at origin", () => {
    // Horizontal line y=0: (−1,0)→(1,0)
    // Vertical line x=0: (0,−1)→(0,1)
    const result = intersectLines2D(-1, 0, 1, 0, 0, -1, 0, 1);
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(0, 6);
    expect(result!.y).toBeCloseTo(0, 6);
  });

  it("returns null for parallel lines", () => {
    // Two horizontal lines: y=0 and y=1
    const result = intersectLines2D(0, 0, 1, 0, 0, 1, 1, 1);
    expect(result).toBeNull();
  });

  it("finds intersection of lines crossing at an arbitrary point", () => {
    // Line 1: (0,0) -> (2,2) -- slope 1
    // Line 2: (0,2) -> (2,0) -- slope -1
    // Intersection at (1,1)
    const result = intersectLines2D(0, 0, 2, 2, 0, 2, 2, 0);
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(1, 6);
    expect(result!.y).toBeCloseTo(1, 6);
  });

  it("returns null for coincident (overlapping) lines", () => {
    // Same line defined by different points
    const result = intersectLines2D(0, 0, 2, 2, 1, 1, 3, 3);
    expect(result).toBeNull();
  });

  it("finds intersection of diagonal lines", () => {
    // Line 1: (0,0) -> (4,2) -- slope 0.5
    // Line 2: (0,3) -> (6,0) -- slope -0.5
    // y = 0.5x and y = 3 - 0.5x => x = 3, y = 1.5
    const result = intersectLines2D(0, 0, 4, 2, 0, 3, 6, 0);
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(3, 6);
    expect(result!.y).toBeCloseTo(1.5, 6);
  });
});

// =====================================================================
// normalizeAngle
// =====================================================================

describe("normalizeAngle", () => {
  it("returns 0 for input 0", () => {
    expect(normalizeAngle(0)).toBeCloseTo(0, 10);
  });

  it("returns pi for input pi", () => {
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI, 10);
  });

  it("normalizes 2*pi to 0 (or very close)", () => {
    expect(normalizeAngle(Math.PI * 2)).toBeCloseTo(0, 10);
  });

  it("normalizes 3*pi to pi", () => {
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 10);
  });

  it("normalizes -pi to pi", () => {
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI, 10);
  });

  it("normalizes -2*pi to 0", () => {
    expect(normalizeAngle(-Math.PI * 2)).toBeCloseTo(0, 10);
  });

  it("normalizes large positive multiples of 2*pi to approximately 0", () => {
    expect(normalizeAngle(Math.PI * 20)).toBeCloseTo(0, 10);
  });
});

// =====================================================================
// isAngleInSweep
// =====================================================================

describe("isAngleInSweep", () => {
  it("returns true when testAngle is between start and end (no wrap)", () => {
    // Arc from 0 to pi, test at pi/2
    expect(isAngleInSweep(0, Math.PI, Math.PI / 2)).toBe(true);
  });

  it("returns false when testAngle is outside the arc (no wrap)", () => {
    // Arc from 0 to pi, test at 3*pi/2
    expect(isAngleInSweep(0, Math.PI, (3 * Math.PI) / 2)).toBe(false);
  });

  it("returns true for an arc crossing 0 when test is in the sweep", () => {
    // Arc from 5.5 to 0.5 (crossing 0), test at 6.0 (between 5.5 and 2*pi)
    expect(isAngleInSweep(5.5, 0.5, 6.0)).toBe(true);
  });

  it("returns false for an arc crossing 0 when test is in the gap", () => {
    // Arc from 5.5 to 0.5 (crossing 0), test at 3.0 (in the gap between 0.5 and 5.5)
    expect(isAngleInSweep(5.5, 0.5, 3.0)).toBe(false);
  });

  it("returns true when testAngle equals startAngle", () => {
    expect(isAngleInSweep(1.0, 2.0, 1.0)).toBe(true);
  });

  it("returns true when testAngle equals endAngle", () => {
    expect(isAngleInSweep(1.0, 2.0, 2.0)).toBe(true);
  });
});
