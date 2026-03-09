import { describe, it, expect } from "vitest";
import {
  formatDimNumber,
  formatArchitectural,
  cleanDimensionMText,
  extractDimensionData,
  intersectLines2D,
  normalizeAngle,
  isAngleInSweep,
  resolveDimVarsFromHeader,
  applyDimStyleVars,
  mergeEntityDimVars,
  DEFAULT_DIM_VARS,
} from "../dimensions";
import type { DxfDimensionEntity, DxfDimStyle } from "@/types/dxf";

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
    expect(cleanDimensionMText("%%c25")).toBe("\u230025");
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
    const result = intersectLines2D({ x1: -1, y1: 0, x2: 1, y2: 0 }, { x1: 0, y1: -1, x2: 0, y2: 1 });
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(0, 6);
    expect(result!.y).toBeCloseTo(0, 6);
  });

  it("returns null for parallel lines", () => {
    // Two horizontal lines: y=0 and y=1
    const result = intersectLines2D({ x1: 0, y1: 0, x2: 1, y2: 0 }, { x1: 0, y1: 1, x2: 1, y2: 1 });
    expect(result).toBeNull();
  });

  it("finds intersection of lines crossing at an arbitrary point", () => {
    // Line 1: (0,0) -> (2,2) -- slope 1
    // Line 2: (0,2) -> (2,0) -- slope -1
    // Intersection at (1,1)
    const result = intersectLines2D({ x1: 0, y1: 0, x2: 2, y2: 2 }, { x1: 0, y1: 2, x2: 2, y2: 0 });
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(1, 6);
    expect(result!.y).toBeCloseTo(1, 6);
  });

  it("returns null for coincident (overlapping) lines", () => {
    // Same line defined by different points
    const result = intersectLines2D({ x1: 0, y1: 0, x2: 2, y2: 2 }, { x1: 1, y1: 1, x2: 3, y2: 3 });
    expect(result).toBeNull();
  });

  it("finds intersection of diagonal lines", () => {
    // Line 1: (0,0) -> (4,2) -- slope 0.5
    // Line 2: (0,3) -> (6,0) -- slope -0.5
    // y = 0.5x and y = 3 - 0.5x => x = 3, y = 1.5
    const result = intersectLines2D({ x1: 0, y1: 0, x2: 4, y2: 2 }, { x1: 0, y1: 3, x2: 6, y2: 0 });
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

// =====================================================================
// resolveDimVarsFromHeader
// =====================================================================

describe("resolveDimVarsFromHeader", () => {
  it("returns defaults when header is undefined", () => {
    const dv = resolveDimVarsFromHeader(undefined);
    expect(dv).toEqual(DEFAULT_DIM_VARS);
  });

  it("returns defaults when header has no DIM variables", () => {
    const dv = resolveDimVarsFromHeader({});
    expect(dv.arrowSize).toBe(DEFAULT_DIM_VARS.arrowSize);
    expect(dv.textHeight).toBe(DEFAULT_DIM_VARS.textHeight);
  });

  it("scales $DIMASZ by $DIMSCALE", () => {
    const dv = resolveDimVarsFromHeader({ "$DIMSCALE": 2, "$DIMASZ": 2.5 });
    expect(dv.arrowSize).toBe(5);
  });

  it("scales $DIMTXT by $DIMSCALE", () => {
    const dv = resolveDimVarsFromHeader({ "$DIMSCALE": 3, "$DIMTXT": 2 });
    expect(dv.textHeight).toBe(6);
  });

  it("uses $DIMSCALE=1 by default", () => {
    const dv = resolveDimVarsFromHeader({ "$DIMASZ": 4 });
    expect(dv.arrowSize).toBe(4);
  });

  it("handles $DIMSCALE=0 (treats as 1)", () => {
    const dv = resolveDimVarsFromHeader({ "$DIMSCALE": 0, "$DIMASZ": 4 });
    expect(dv.arrowSize).toBe(4);
  });

  it("scales extension line dash/gap by $DIMSCALE", () => {
    const dv = resolveDimVarsFromHeader({ "$DIMSCALE": 5 });
    expect(dv.extLineDash).toBe(10); // 2 * 5
    expect(dv.extLineGap).toBe(5);  // 1 * 5
  });

  it("sets useTicks=true when $DIMTSZ > 0", () => {
    const dv = resolveDimVarsFromHeader({ "$DIMTSZ": 2.5 });
    expect(dv.useTicks).toBe(true);
    expect(dv.tickSize).toBe(2.5);
  });

  it("sets useTicks=false when $DIMTSZ is 0", () => {
    const dv = resolveDimVarsFromHeader({ "$DIMTSZ": 0 });
    expect(dv.useTicks).toBe(false);
    expect(dv.tickSize).toBe(0);
  });

  it("sets useTicks=false when $DIMTSZ is absent", () => {
    const dv = resolveDimVarsFromHeader({});
    expect(dv.useTicks).toBe(false);
    expect(dv.tickSize).toBe(0);
  });

  it("scales $DIMTSZ by $DIMSCALE", () => {
    const dv = resolveDimVarsFromHeader({ "$DIMTSZ": 1.5, "$DIMSCALE": 4 });
    expect(dv.useTicks).toBe(true);
    expect(dv.tickSize).toBe(6);
  });
});

// =====================================================================
// applyDimStyleVars
// =====================================================================

describe("applyDimStyleVars", () => {
  const makeStyle = (overrides: Partial<DxfDimStyle> = {}): DxfDimStyle => ({
    name: "TEST",
    ...overrides,
  });

  it("returns base unchanged when DIMSTYLE has no overrides", () => {
    const base = resolveDimVarsFromHeader({ "$DIMSCALE": 1, "$DIMTXT": 3, "$DIMASZ": 3 });
    const result = applyDimStyleVars(base, makeStyle());
    expect(result.textHeight).toBe(3);
    expect(result.arrowSize).toBe(3);
  });

  it("applies DIMSTYLE DIMTXT × DIMSCALE", () => {
    const base = resolveDimVarsFromHeader({ "$DIMSCALE": 1, "$DIMTXT": 3, "$DIMASZ": 3 });
    const result = applyDimStyleVars(base, makeStyle({ dimscale: 32, dimtxt: 0.1875 }), {
      "$DIMSCALE": 1, "$DIMTXT": 3, "$DIMASZ": 3,
    });
    expect(result.textHeight).toBe(6); // 0.1875 × 32
  });

  it("applies DIMSTYLE DIMASZ × DIMSCALE", () => {
    const base = resolveDimVarsFromHeader({ "$DIMSCALE": 1, "$DIMTXT": 3, "$DIMASZ": 3 });
    const result = applyDimStyleVars(base, makeStyle({ dimscale: 32, dimasz: 0.15625 }), {
      "$DIMSCALE": 1, "$DIMTXT": 3, "$DIMASZ": 3,
    });
    expect(result.arrowSize).toBe(5); // 0.15625 × 32
  });

  it("re-scales header values when only DIMSCALE differs", () => {
    const header = { "$DIMSCALE": 1, "$DIMTXT": 3, "$DIMASZ": 2 };
    const base = resolveDimVarsFromHeader(header);
    const result = applyDimStyleVars(base, makeStyle({ dimscale: 4 }), header);
    expect(result.textHeight).toBe(12); // 3 × 4
    expect(result.arrowSize).toBe(8);   // 2 × 4
  });

  it("uses header DIMSCALE when DIMSTYLE has no dimscale", () => {
    const header = { "$DIMSCALE": 2, "$DIMTXT": 3, "$DIMASZ": 3 };
    const base = resolveDimVarsFromHeader(header);
    // DIMSTYLE overrides only DIMTXT, uses header DIMSCALE (2)
    const result = applyDimStyleVars(base, makeStyle({ dimtxt: 5 }), header);
    expect(result.textHeight).toBe(10); // 5 × 2
  });

  it("does not modify the base object", () => {
    const base = { ...DEFAULT_DIM_VARS };
    applyDimStyleVars(base, makeStyle({ dimscale: 10, dimtxt: 1 }));
    expect(base.textHeight).toBe(DEFAULT_DIM_VARS.textHeight);
  });

  it("re-scales extension line geometry with new DIMSCALE", () => {
    const header = { "$DIMSCALE": 1 };
    const base = resolveDimVarsFromHeader(header);
    const result = applyDimStyleVars(base, makeStyle({ dimscale: 5 }), header);
    expect(result.extLineDash).toBe(10); // 2 × 5
    expect(result.extLineGap).toBe(5);   // 1 × 5
  });
});

// =====================================================================
// mergeEntityDimVars
// =====================================================================

describe("mergeEntityDimVars", () => {
  it("returns base when entity has no overrides", () => {
    const entity = makeDimEntity({});
    const result = mergeEntityDimVars(DEFAULT_DIM_VARS, entity);
    expect(result).toEqual(DEFAULT_DIM_VARS);
  });

  it("uses entity textHeight and recomputes textGap", () => {
    const entity = makeDimEntity({ textHeight: 10 });
    const result = mergeEntityDimVars(DEFAULT_DIM_VARS, entity);
    expect(result.textHeight).toBe(10);
    expect(result.textGap).toBe(15); // 10 * 1.5
  });

  it("uses entity arrowSize with dimScale", () => {
    const entity = makeDimEntity({ arrowSize: 3, dimScale: 2 });
    const result = mergeEntityDimVars(DEFAULT_DIM_VARS, entity);
    expect(result.arrowSize).toBe(6);
  });

  it("uses entity arrowSize without dimScale (scale=1)", () => {
    const entity = makeDimEntity({ arrowSize: 4 });
    const result = mergeEntityDimVars(DEFAULT_DIM_VARS, entity);
    expect(result.arrowSize).toBe(4);
  });

  it("does not modify base object", () => {
    const base = { ...DEFAULT_DIM_VARS };
    const entity = makeDimEntity({ textHeight: 99 });
    mergeEntityDimVars(base, entity);
    expect(base.textHeight).toBe(DEFAULT_DIM_VARS.textHeight);
  });
});

// =====================================================================
// extractDimensionData with DimVars
// =====================================================================

describe("extractDimensionData with DimVars", () => {
  it("uses DimVars textHeight as fallback when entity has none", () => {
    const entity = makeDimEntity({
      linearOrAngularPoint1: { x: 0, y: 0, z: 0 },
      linearOrAngularPoint2: { x: 10, y: 0, z: 0 },
      anchorPoint: { x: 0, y: 5, z: 0 },
      actualMeasurement: 10,
    });
    const dv = { ...DEFAULT_DIM_VARS, textHeight: 8 };
    const data = extractDimensionData(entity, dv);
    expect(data).not.toBeNull();
    expect(data!.textHeight).toBe(8);
  });

  it("entity textHeight takes priority over DimVars", () => {
    const entity = makeDimEntity({
      linearOrAngularPoint1: { x: 0, y: 0, z: 0 },
      linearOrAngularPoint2: { x: 10, y: 0, z: 0 },
      anchorPoint: { x: 0, y: 5, z: 0 },
      actualMeasurement: 10,
      textHeight: 3,
    });
    const dv = { ...DEFAULT_DIM_VARS, textHeight: 8 };
    const data = extractDimensionData(entity, dv);
    expect(data).not.toBeNull();
    expect(data!.textHeight).toBe(3);
  });
});

// =====================================================================
// formatArchitectural
// =====================================================================

describe("formatArchitectural", () => {
  it("converts 172 inches to 14'-4\"", () => {
    expect(formatArchitectural(172)).toBe("14'-4\"");
  });

  it("converts 88 inches to 7'-4\"", () => {
    expect(formatArchitectural(88)).toBe("7'-4\"");
  });

  it("converts 84 inches to 7'", () => {
    expect(formatArchitectural(84)).toBe("7'");
  });

  it("converts 696 inches to 58'", () => {
    expect(formatArchitectural(696)).toBe("58'");
  });

  it("converts 0 inches to 0\"", () => {
    expect(formatArchitectural(0)).toBe("0\"");
  });

  it("converts 4 inches to 4\"", () => {
    expect(formatArchitectural(4)).toBe("4\"");
  });

  it("converts 12 inches to 1'", () => {
    expect(formatArchitectural(12)).toBe("1'");
  });

  it("converts 24 inches to 2'", () => {
    expect(formatArchitectural(24)).toBe("2'");
  });

  it("handles negative values", () => {
    expect(formatArchitectural(-172)).toBe("-14'-4\"");
  });

  it("dimzin=0 suppresses zero feet and zero inches (default)", () => {
    expect(formatArchitectural(4, 0)).toBe("4\"");
    expect(formatArchitectural(12, 0)).toBe("1'");
  });

  it("dimzin=12 includes both zero feet and zero inches", () => {
    // bits 2+3 NOT set, so no zero-part suppression; bits 2+3 are 4+8=12 for suppression
    // Actually dimzin=12 means bit 2 (4) + bit 3 (8) are set: suppress 0 feet AND 0 inches
    expect(formatArchitectural(4, 12)).toBe("4\"");
    expect(formatArchitectural(12, 12)).toBe("1'");
  });

  it("dimzin with no suppression flags shows full format", () => {
    // dimzin=3 (bits 0+1 only) — no feet/inch zero suppression
    expect(formatArchitectural(4, 3)).toBe("0'-4\"");
    expect(formatArchitectural(12, 3)).toBe("1'-0\"");
    expect(formatArchitectural(0, 3)).toBe("0'-0\"");
  });

  // Fractional inches — stacked fraction notation
  it("formats 9.5 inches as 9\\S1/2;\" (half inch)", () => {
    expect(formatArchitectural(9.5)).toBe("9\\S1/2;\"");
  });

  it("formats 9.49999 (≈9.5) as 9\\S1/2;\"", () => {
    expect(formatArchitectural(9.49999999994543)).toBe("9\\S1/2;\"");
  });

  it("formats 9.506 (≈9.5) as 9\\S1/2;\"", () => {
    expect(formatArchitectural(9.506632848266236)).toBe("9\\S1/2;\"");
  });

  it("formats 6.25 inches as 6\\S1/4;\" (quarter inch)", () => {
    expect(formatArchitectural(6.25)).toBe("6\\S1/4;\"");
  });

  it("formats 6.75 inches as 6\\S3/4;\" (three quarters)", () => {
    expect(formatArchitectural(6.75)).toBe("6\\S3/4;\"");
  });

  it("formats 0.5 inches as \\S1/2;\" (fraction only)", () => {
    expect(formatArchitectural(0.5)).toBe("\\S1/2;\"");
  });

  it("formats 114.5 inches as 9'-6\\S1/2;\" (feet + inches + fraction)", () => {
    expect(formatArchitectural(114.5)).toBe("9'-6\\S1/2;\"");
  });

  it("formats 12.125 inches as 1'-\\S1/8;\" (feet + fraction, no whole inches)", () => {
    expect(formatArchitectural(12.125)).toBe("1'-\\S1/8;\"");
  });

  it("rounds up fraction that exceeds denominator", () => {
    // 11.97 inches → fraction rounds to 16/16 = 1 → carry to 12 → 1'
    expect(formatArchitectural(11.97)).toBe("1'");
  });

  it("handles negative fractional value", () => {
    expect(formatArchitectural(-6.5)).toBe("-6\\S1/2;\"");
  });
});

// =====================================================================
// extractDimensionData with DIMLUNIT=4 (Architectural)
// =====================================================================

describe("extractDimensionData with DIMLUNIT=4", () => {
  it("formats measurement as architectural when dimlunit=4", () => {
    const entity = makeDimEntity({
      linearOrAngularPoint1: { x: 0, y: 0, z: 0 },
      linearOrAngularPoint2: { x: 10, y: 0, z: 0 },
      anchorPoint: { x: 0, y: 5, z: 0 },
      actualMeasurement: 172,
    });
    const data = extractDimensionData(entity, DEFAULT_DIM_VARS, { dimlunit: 4 });
    expect(data).not.toBeNull();
    expect(data!.dimensionText).toBe("14'-4\"");
  });

  it("formats with dimzin=3 (no zero suppression)", () => {
    const entity = makeDimEntity({
      linearOrAngularPoint1: { x: 0, y: 0, z: 0 },
      linearOrAngularPoint2: { x: 10, y: 0, z: 0 },
      anchorPoint: { x: 0, y: 5, z: 0 },
      actualMeasurement: 84,
    });
    const data = extractDimensionData(entity, DEFAULT_DIM_VARS, { dimlunit: 4, dimzin: 3 });
    expect(data).not.toBeNull();
    expect(data!.dimensionText).toBe("7'-0\"");
  });

  it("replaces <> placeholder with architectural format", () => {
    const entity = makeDimEntity({
      linearOrAngularPoint1: { x: 0, y: 0, z: 0 },
      linearOrAngularPoint2: { x: 10, y: 0, z: 0 },
      anchorPoint: { x: 0, y: 5, z: 0 },
      text: "Length: <>",
      actualMeasurement: 88,
    });
    const data = extractDimensionData(entity, DEFAULT_DIM_VARS, { dimlunit: 4 });
    expect(data).not.toBeNull();
    expect(data!.dimensionText).toBe("Length: 7'-4\"");
  });

  it("does not re-format explicit text when dimlunit=4", () => {
    const entity = makeDimEntity({
      linearOrAngularPoint1: { x: 0, y: 0, z: 0 },
      linearOrAngularPoint2: { x: 10, y: 0, z: 0 },
      anchorPoint: { x: 0, y: 5, z: 0 },
      text: "custom",
      actualMeasurement: 172,
    });
    const data = extractDimensionData(entity, DEFAULT_DIM_VARS, { dimlunit: 4 });
    expect(data).not.toBeNull();
    expect(data!.dimensionText).toBe("custom");
  });
});

// =====================================================================
// Angular dimension sector selection (regression: 240° arc instead of 60°)
// =====================================================================

describe("angular dimension sector selection", () => {
  it("selects correct 60° sector when farthest endpoint is on the opposite side", () => {
    // Real data from American Farmhouse DXF, handle 3855
    // Two lines through vertex create 4 sectors; the arc should be in the 60° sector
    // containing arcPoint (p16), not the 240° complementary sector.
    const vertex = { x: 1111.59, y: 3737.71 };
    const p13 = { x: 1132.52, y: 3773.96 }; // line 1, far from vertex, at ~60°
    const p14 = { x: 1112.02, y: 3738.46 }; // line 1, near vertex, at ~60°
    const p15 = { x: 1092.03, y: 3737.71 }; // line 2, far from vertex, at 180°
    const p10 = { x: 1120.78, y: 3737.71 }; // line 2, near vertex, at 0°
    const p16 = { x: 1122.34, y: 3741.63 }; // arcPoint at ~20°

    const pts = [p13, p14, p15, p10];
    const lines = [1, 1, 2, 2];
    const rays = pts.map((pt, i) => ({
      angle: Math.atan2(pt.y - vertex.y, pt.x - vertex.x),
      line: lines[i],
      dist: Math.sqrt((pt.x - vertex.x) ** 2 + (pt.y - vertex.y) ** 2),
    }));

    const arcAngle = Math.atan2(p16.y - vertex.y, p16.x - vertex.x);

    // Filter out degenerate rays and find sector
    const { startAngle, endAngle } = findArcSector(rays, arcAngle);
    const sweep = normalizeAngle(endAngle - startAngle);

    // Should be ~60° (π/3), not 240° (4π/3)
    expect(sweep).toBeCloseTo(Math.PI / 3, 1);

    // Arc start should be at x≈1123 (right of vertex), not x≈1100 (left)
    const radius = Math.sqrt((p16.x - vertex.x) ** 2 + (p16.y - vertex.y) ** 2);
    const arcStartX = vertex.x + radius * Math.cos(startAngle);
    expect(arcStartX).toBeCloseTo(1123, 0);
  });

  it("handles coincident vertex (p14 = p15) without producing full circle", () => {
    // Entity from entities.dxf handle 187: p14 = p15 = vertex = (20, 10)
    // Without filtering degenerate rays, both zero-length rays at 0° create
    // a false sector match → sweep = 2π (full circle) instead of ~75°
    const vertex = { x: 20, y: 10 };
    const p13 = { x: 10, y: 80 };  // line 1, far, at ~98°
    const p14 = { x: 20, y: 10 };  // line 1, AT vertex
    const p15 = { x: 20, y: 10 };  // line 2, AT vertex
    const p10 = { x: 90, y: 40 };  // line 2, far, at ~23°
    const p16 = { x: 35.39, y: 27.20 }; // arcPoint at ~48°

    const rays = [
      { angle: Math.atan2(p13.y - vertex.y, p13.x - vertex.x), line: 1, dist: Math.sqrt((p13.x - vertex.x) ** 2 + (p13.y - vertex.y) ** 2) },
      { angle: Math.atan2(p14.y - vertex.y, p14.x - vertex.x), line: 1, dist: Math.sqrt((p14.x - vertex.x) ** 2 + (p14.y - vertex.y) ** 2) },
      { angle: Math.atan2(p15.y - vertex.y, p15.x - vertex.x), line: 2, dist: Math.sqrt((p15.x - vertex.x) ** 2 + (p15.y - vertex.y) ** 2) },
      { angle: Math.atan2(p10.y - vertex.y, p10.x - vertex.x), line: 2, dist: Math.sqrt((p10.x - vertex.x) ** 2 + (p10.y - vertex.y) ** 2) },
    ];

    const arcAngle = Math.atan2(p16.y - vertex.y, p16.x - vertex.x);
    const { startAngle, endAngle } = findArcSector(rays, arcAngle);
    const sweep = normalizeAngle(endAngle - startAngle);

    // Should be ~75° (1.308 rad), NOT 2π (full circle)
    expect(sweep).toBeCloseTo(1.308, 1);
    expect(sweep).toBeLessThan(Math.PI);
  });
});

/** Helper: replicate the sector-finding algorithm from createAngularDimension */
function findArcSector(
  rays: { angle: number; line: number; dist: number }[],
  arcAngle: number,
): { startAngle: number; endAngle: number } {
  const EPSILON = 1e-10;
  const validRays = rays.filter(r => r.dist > EPSILON);
  const sorted = validRays
    .map(r => ({ ...r, normAngle: normalizeAngle(r.angle) }))
    .sort((a, b) => a.normAngle - b.normAngle);
  const n = sorted.length;
  for (let i = 0; i < n; i++) {
    const r1 = sorted[i];
    const r2 = sorted[(i + 1) % n];
    if (r1.line === r2.line) continue;
    if (isAngleInSweep(r1.angle, r2.angle, arcAngle)) {
      return { startAngle: r1.angle, endAngle: r2.angle };
    }
  }
  return { startAngle: 0, endAngle: 0 };
}
