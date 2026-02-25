import { describe, it, expect } from "vitest";
import { createScanner } from "../../__tests__/test-helpers";
import { parseHeader } from "../header";

describe("parseHeader", () => {
  // ── Simple scalar variable ──────────────────────────────────────────

  it("parses a simple scalar variable ($ACADVER)", () => {
    // Scanner starts after "0 SECTION / 2 HEADER" has been consumed.
    // parseHeader calls scanner.next() itself to get the first group.
    const scanner = createScanner(
      "9", "$ACADVER",
      "1", "AC1032",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const header = parseHeader(scanner);

    expect(header).toHaveProperty("$ACADVER", "AC1032");
  });

  // ── 3D point variable ───────────────────────────────────────────────

  it("parses a 3D point variable ($INSBASE with codes 10/20/30)", () => {
    const scanner = createScanner(
      "9", "$INSBASE",
      "10", "1.0",
      "20", "2.0",
      "30", "3.0",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const header = parseHeader(scanner);

    expect(header).toHaveProperty("$INSBASE");
    const point = header["$INSBASE"] as { x: number; y: number; z: number };
    expect(point.x).toBe(1.0);
    expect(point.y).toBe(2.0);
    expect(point.z).toBe(3.0);
  });

  // ── Multiple variables ──────────────────────────────────────────────

  it("parses multiple variables in sequence", () => {
    const scanner = createScanner(
      "9", "$ACADVER",
      "1", "AC1032",
      "9", "$INSBASE",
      "10", "0.0",
      "20", "0.0",
      "30", "0.0",
      "9", "$MEASUREMENT",
      "70", "1",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const header = parseHeader(scanner);

    expect(header["$ACADVER"]).toBe("AC1032");
    const point = header["$INSBASE"] as { x: number; y: number; z: number };
    expect(point.x).toBe(0.0);
    expect(point.y).toBe(0.0);
    expect(point.z).toBe(0.0);
    // Code 70 is in range 60-99 => parseInt
    expect(header["$MEASUREMENT"]).toBe(1);
  });

  // ── Empty HEADER section ────────────────────────────────────────────

  it("returns an empty object for an empty HEADER section (immediate ENDSEC)", () => {
    const scanner = createScanner(
      "0", "ENDSEC",
      "0", "EOF",
    );

    const header = parseHeader(scanner);

    expect(header).toEqual({});
  });

  // ── 2D point (codes 10/20 only, no 30) ─────────────────────────────

  it("parses a 2D point when code 30 is absent", () => {
    const scanner = createScanner(
      "9", "$LIMMIN",
      "10", "0.0",
      "20", "0.0",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const header = parseHeader(scanner);

    expect(header).toHaveProperty("$LIMMIN");
    const point = header["$LIMMIN"] as { x: number; y?: number; z?: number };
    expect(point.x).toBe(0.0);
    expect(point.y).toBe(0.0);
    expect(point.z).toBeUndefined();
  });
});
