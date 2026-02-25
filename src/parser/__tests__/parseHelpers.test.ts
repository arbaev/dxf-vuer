import { describe, it, expect } from "vitest";
import { createScanner, createScannerAt } from "./test-helpers";
import {
  getAcadColor,
  parsePoint,
  parsePointInline,
  checkCommonEntityProperties,
  type IEntityBase,
} from "../parseHelpers";

// ---------------------------------------------------------------------------
// getAcadColor
// ---------------------------------------------------------------------------
describe("getAcadColor", () => {
  it("returns 0 for index 0 (ByBlock reserved)", () => {
    expect(getAcadColor(0)).toBe(0);
  });

  it("returns red (0xFF0000 = 16711680) for index 1", () => {
    expect(getAcadColor(1)).toBe(0xff0000);
  });

  it("returns white (0xFFFFFF = 16777215) for index 7", () => {
    expect(getAcadColor(7)).toBe(0xffffff);
  });

  it("returns white (0xFFFFFF = 16777215) for index 255", () => {
    expect(getAcadColor(255)).toBe(0xffffff);
  });

  it("returns undefined for an out-of-range index", () => {
    expect(getAcadColor(999)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parsePoint
// ---------------------------------------------------------------------------
describe("parsePoint", () => {
  it("parses a full 3D point from codes 10/20/30", () => {
    // parsePoint calls rewind() then next(), so scanner must already be
    // positioned at (past) the X group. createScannerAt advances to the
    // first group, which is the X code.
    const { scanner } = createScannerAt(
      "10", "1.5",
      "20", "2.5",
      "30", "3.5",
      "0", "EOF",
    );

    const point = parsePoint(scanner);
    expect(point.x).toBe(1.5);
    expect(point.y).toBe(2.5);
    expect(point.z).toBe(3.5);
  });

  it("parses a 2D point when the Z code is absent and rewinds the scanner", () => {
    const { scanner } = createScannerAt(
      "10", "4.0",
      "20", "5.0",
      "8", "Layer1",   // not code 30 -- should trigger rewind
      "0", "EOF",
    );

    const point = parsePoint(scanner);
    expect(point.x).toBe(4.0);
    expect(point.y).toBe(5.0);
    expect(point.z).toBeUndefined();

    // After rewind the scanner should re-read the group that was not Z
    const nextGroup = scanner.next();
    expect(nextGroup.code).toBe(8);
    expect(nextGroup.value).toBe("Layer1");
  });

  it("works with a different code base (codes 11/21/31)", () => {
    const { scanner } = createScannerAt(
      "11", "10.0",
      "21", "20.0",
      "31", "30.0",
      "0", "EOF",
    );

    const point = parsePoint(scanner);
    expect(point.x).toBe(10.0);
    expect(point.y).toBe(20.0);
    expect(point.z).toBe(30.0);
  });

  it("throws an error when the Y code does not follow the expected pattern", () => {
    // X code is 10, so expected Y code is 20. We provide 99 instead.
    const { scanner } = createScannerAt(
      "10", "1.0",
      "99", "2.0",
      "0", "EOF",
    );

    expect(() => parsePoint(scanner)).toThrow(
      "Expected code for point value to be 20 but got 99",
    );
  });
});

// ---------------------------------------------------------------------------
// parsePointInline
// ---------------------------------------------------------------------------
describe("parsePointInline", () => {
  it("parses a full 3D point (X + Y + Z)", () => {
    const { scanner, group } = createScannerAt(
      "10", "1.0",
      "20", "2.0",
      "30", "3.0",
      "0", "EOF",
    );

    const point = parsePointInline(scanner, group);
    expect(point.x).toBe(1.0);
    expect(point.y).toBe(2.0);
    expect(point.z).toBe(3.0);
  });

  it("parses a 2D point when Z code is absent and rewinds scanner", () => {
    const { scanner, group } = createScannerAt(
      "10", "1.0",
      "20", "2.0",
      "8", "Layer1",   // not code 30
      "0", "EOF",
    );

    const point = parsePointInline(scanner, group);
    expect(point.x).toBe(1.0);
    expect(point.y).toBe(2.0);
    expect(point.z).toBeUndefined();

    // Scanner should have been rewound to the non-Z group
    const nextGroup = scanner.next();
    expect(nextGroup.code).toBe(8);
    expect(nextGroup.value).toBe("Layer1");
  });

  it("returns only X when the Y code does not match and rewinds scanner", () => {
    const { scanner, group } = createScannerAt(
      "10", "7.0",
      "8", "Layer1",   // not code 20
      "0", "EOF",
    );

    const point = parsePointInline(scanner, group);
    expect(point.x).toBe(7.0);
    expect(point.y).toBeUndefined();
    expect(point.z).toBeUndefined();

    // Scanner should have been rewound to the non-Y group
    const nextGroup = scanner.next();
    expect(nextGroup.code).toBe(8);
    expect(nextGroup.value).toBe("Layer1");
  });

  it("works with a different code base (codes 11/21/31)", () => {
    const { scanner, group } = createScannerAt(
      "11", "100.0",
      "21", "200.0",
      "31", "300.0",
      "0", "EOF",
    );

    const point = parsePointInline(scanner, group);
    expect(point.x).toBe(100.0);
    expect(point.y).toBe(200.0);
    expect(point.z).toBe(300.0);
  });
});

// ---------------------------------------------------------------------------
// checkCommonEntityProperties
// ---------------------------------------------------------------------------
describe("checkCommonEntityProperties", () => {
  function makeEntity(): IEntityBase {
    return { type: "" } as IEntityBase;
  }

  // Dummy scanner -- most cases do not actually use the scanner argument,
  // so we provide a minimal one that won't be consumed.
  function dummyScanner() {
    return createScanner("0", "EOF");
  }

  it("code 0 sets entity.type and returns true", () => {
    const entity = makeEntity();
    const result = checkCommonEntityProperties(
      entity,
      { code: 0, value: "LINE" },
      dummyScanner(),
    );
    expect(result).toBe(true);
    expect(entity.type).toBe("LINE");
  });

  it("code 5 sets entity.handle and returns true", () => {
    const entity = makeEntity();
    const result = checkCommonEntityProperties(
      entity,
      { code: 5, value: "A1" },
      dummyScanner(),
    );
    expect(result).toBe(true);
    expect(entity.handle).toBe("A1");
  });

  it("code 6 sets entity.lineType and returns true", () => {
    const entity = makeEntity();
    const result = checkCommonEntityProperties(
      entity,
      { code: 6, value: "DASHED" },
      dummyScanner(),
    );
    expect(result).toBe(true);
    expect(entity.lineType).toBe("DASHED");
  });

  it("code 8 sets entity.layer and returns true", () => {
    const entity = makeEntity();
    const result = checkCommonEntityProperties(
      entity,
      { code: 8, value: "Walls" },
      dummyScanner(),
    );
    expect(result).toBe(true);
    expect(entity.layer).toBe("Walls");
  });

  it("code 48 sets entity.lineTypeScale and returns true", () => {
    const entity = makeEntity();
    const result = checkCommonEntityProperties(
      entity,
      { code: 48, value: 2.5 },
      dummyScanner(),
    );
    expect(result).toBe(true);
    expect(entity.lineTypeScale).toBe(2.5);
  });

  it("code 60 with value 0 sets entity.visible to true", () => {
    const entity = makeEntity();
    const result = checkCommonEntityProperties(
      entity,
      { code: 60, value: 0 },
      dummyScanner(),
    );
    expect(result).toBe(true);
    expect(entity.visible).toBe(true);
  });

  it("code 60 with value 1 sets entity.visible to false", () => {
    const entity = makeEntity();
    const result = checkCommonEntityProperties(
      entity,
      { code: 60, value: 1 },
      dummyScanner(),
    );
    expect(result).toBe(true);
    expect(entity.visible).toBe(false);
  });

  it("code 62 sets entity.colorIndex and returns true", () => {
    const entity = makeEntity();
    const result = checkCommonEntityProperties(
      entity,
      { code: 62, value: 5 },
      dummyScanner(),
    );
    expect(result).toBe(true);
    expect(entity.colorIndex).toBe(5);
  });

  it("code 67 with value 0 sets entity.inPaperSpace to false", () => {
    const entity = makeEntity();
    const result = checkCommonEntityProperties(
      entity,
      { code: 67, value: 0 },
      dummyScanner(),
    );
    expect(result).toBe(true);
    expect(entity.inPaperSpace).toBe(false);
  });

  it("code 67 with value 1 sets entity.inPaperSpace to true", () => {
    const entity = makeEntity();
    const result = checkCommonEntityProperties(
      entity,
      { code: 67, value: 1 },
      dummyScanner(),
    );
    expect(result).toBe(true);
    expect(entity.inPaperSpace).toBe(true);
  });

  it("code 100 is handled (returns true) with no side effects", () => {
    const entity = makeEntity();
    const result = checkCommonEntityProperties(
      entity,
      { code: 100, value: "AcDbEntity" },
      dummyScanner(),
    );
    expect(result).toBe(true);
    // No property should be set beyond the initial type
    expect(entity).toEqual({ type: "" });
  });

  it("code 101 skips embedded object data until code 0, then rewinds", () => {
    // The scanner is consumed inside checkCommonEntityProperties for code 101.
    // It reads forward until it finds code 0, then rewinds so that code 0
    // can be re-read by the caller.
    const scanner = createScanner(
      "101", "Embedded Object",
      "300", "SomeData",
      "301", "MoreData",
      "0", "ENDSEC",
      "0", "EOF",
    );
    // Advance past the first group (code 101) -- the function receives curr
    const curr = scanner.next();

    const entity = makeEntity();
    const result = checkCommonEntityProperties(entity, curr, scanner);
    expect(result).toBe(true);

    // After the rewind, the next read should yield code 0 "ENDSEC"
    const nextGroup = scanner.next();
    expect(nextGroup.code).toBe(0);
    expect(nextGroup.value).toBe("ENDSEC");
  });

  it("code 330 sets entity.ownerHandle and returns true", () => {
    const entity = makeEntity();
    const result = checkCommonEntityProperties(
      entity,
      { code: 330, value: "1F" },
      dummyScanner(),
    );
    expect(result).toBe(true);
    expect(entity.ownerHandle).toBe("1F");
  });

  it("code 347 sets entity.materialObjectHandle and returns true", () => {
    const entity = makeEntity();
    const result = checkCommonEntityProperties(
      entity,
      { code: 347, value: 42 },
      dummyScanner(),
    );
    expect(result).toBe(true);
    expect(entity.materialObjectHandle).toBe(42);
  });

  it("code 370 sets entity.lineweight and returns true", () => {
    const entity = makeEntity();
    const result = checkCommonEntityProperties(
      entity,
      { code: 370, value: 50 },
      dummyScanner(),
    );
    expect(result).toBe(true);
    expect(entity.lineweight).toBe(50);
  });

  it("code 420 sets entity.color (truecolor) and returns true", () => {
    const entity = makeEntity();
    const result = checkCommonEntityProperties(
      entity,
      { code: 420, value: 16711680 },
      dummyScanner(),
    );
    expect(result).toBe(true);
    expect(entity.color).toBe(16711680);
  });

  it("code 1000 pushes value to extendedData.customStrings array", () => {
    const entity = makeEntity();

    // First call -- creates extendedData and customStrings
    checkCommonEntityProperties(
      entity,
      { code: 1000, value: "first" },
      dummyScanner(),
    );
    expect(entity.extendedData).toBeDefined();
    expect(
      (entity.extendedData as Record<string, unknown>).customStrings,
    ).toEqual(["first"]);

    // Second call -- pushes to existing array
    checkCommonEntityProperties(
      entity,
      { code: 1000, value: "second" },
      dummyScanner(),
    );
    expect(
      (entity.extendedData as Record<string, unknown>).customStrings,
    ).toEqual(["first", "second"]);
  });

  it("code 1001 sets extendedData.applicationName", () => {
    const entity = makeEntity();
    const result = checkCommonEntityProperties(
      entity,
      { code: 1001, value: "ACAD" },
      dummyScanner(),
    );
    expect(result).toBe(true);
    expect(entity.extendedData).toBeDefined();
    expect(
      (entity.extendedData as Record<string, unknown>).applicationName,
    ).toBe("ACAD");
  });

  it("returns false for an unknown/unhandled code", () => {
    const entity = makeEntity();
    const result = checkCommonEntityProperties(
      entity,
      { code: 999, value: "anything" },
      dummyScanner(),
    );
    expect(result).toBe(false);
  });
});
