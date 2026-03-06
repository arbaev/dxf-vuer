import { describe, it, expect } from "vitest";
import { parseXline, type IXlineEntity } from "../xline";
import { createScannerAt } from "../../__tests__/test-helpers";

describe("parseXline", () => {
  it("parses XLINE with basePoint and direction", () => {
    const { scanner, group } = createScannerAt(
      "0", "XLINE",
      "8", "Construction",
      "10", "5.0",
      "20", "10.0",
      "30", "0.0",
      "11", "0.707",
      "21", "0.707",
      "31", "0.0",
      "0", "EOF",
    );
    const entity = parseXline(scanner, group) as IXlineEntity;
    expect(entity.type).toBe("XLINE");
    expect(entity.layer).toBe("Construction");
    expect(entity.basePoint).toEqual({ x: 5, y: 10, z: 0 });
    expect(entity.direction.x).toBeCloseTo(0.707);
    expect(entity.direction.y).toBeCloseTo(0.707);
    expect(entity.direction.z).toBeCloseTo(0);
  });

  it("parses RAY with basePoint and direction", () => {
    const { scanner, group } = createScannerAt(
      "0", "RAY",
      "10", "0.0",
      "20", "0.0",
      "30", "0.0",
      "11", "1.0",
      "21", "0.0",
      "31", "0.0",
      "0", "EOF",
    );
    const entity = parseXline(scanner, group) as IXlineEntity;
    expect(entity.type).toBe("RAY");
    expect(entity.basePoint).toEqual({ x: 0, y: 0, z: 0 });
    expect(entity.direction).toEqual({ x: 1, y: 0, z: 0 });
  });

  it("parses color and layer", () => {
    const { scanner, group } = createScannerAt(
      "0", "XLINE",
      "8", "Layer1",
      "62", "3",
      "10", "1.0",
      "20", "2.0",
      "11", "0.0",
      "21", "1.0",
      "0", "EOF",
    );
    const entity = parseXline(scanner, group) as IXlineEntity;
    expect(entity.layer).toBe("Layer1");
    expect(entity.colorIndex).toBe(3);
  });
});
