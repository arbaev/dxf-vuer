import { describe, it, expect } from "vitest";
import { createScanner, createScannerAt } from "../../__tests__/test-helpers";
import { parseEntities } from "../entities";

describe("parseEntities", () => {
  // ── Single entity ────────────────────────────────────────────────────

  it("parses a single LINE entity and returns an array with one element", () => {
    const scanner = createScanner(
      // parseEntities will call scanner.next() to get the first group
      "0", "LINE",
      "8", "Layer1",
      "10", "0.0",
      "20", "0.0",
      "11", "100.0",
      "21", "50.0",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entities = parseEntities(scanner, false);

    expect(entities).toHaveLength(1);
    expect(entities[0].type).toBe("LINE");
  });

  // ── Multiple entities ────────────────────────────────────────────────

  it("parses multiple entities (LINE + CIRCLE) and preserves order", () => {
    const scanner = createScanner(
      "0", "LINE",
      "8", "Layer1",
      "10", "0.0",
      "20", "0.0",
      "11", "10.0",
      "21", "10.0",
      "0", "CIRCLE",
      "8", "Layer2",
      "10", "5.0",
      "20", "5.0",
      "40", "2.5",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entities = parseEntities(scanner, false);

    expect(entities).toHaveLength(2);
    expect(entities[0].type).toBe("LINE");
    expect(entities[1].type).toBe("CIRCLE");
  });

  // ── Unknown entity type ──────────────────────────────────────────────

  it("silently skips unknown entity types", () => {
    const scanner = createScanner(
      "0", "UNKNOWNENTITY",
      "8", "Layer1",
      "70", "1",
      "0", "LINE",
      "8", "Layer1",
      "10", "0.0",
      "20", "0.0",
      "11", "5.0",
      "21", "5.0",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entities = parseEntities(scanner, false);

    expect(entities).toHaveLength(1);
    expect(entities[0].type).toBe("LINE");
  });

  // ── forBlock=true stops at ENDBLK ────────────────────────────────────

  it("stops at ENDBLK when forBlock=true", () => {
    // For forBlock=true, parseEntities uses scanner.lastReadGroup
    // (scanner must already be on the first entity's code 0 group)
    const { scanner } = createScannerAt(
      "0", "LINE",
      "8", "Layer1",
      "10", "0.0",
      "20", "0.0",
      "11", "1.0",
      "21", "1.0",
      "0", "ENDBLK",
      "0", "EOF",
    );

    const entities = parseEntities(scanner, true);

    expect(entities).toHaveLength(1);
    expect(entities[0].type).toBe("LINE");
  });

  // ── forBlock=false stops at ENDSEC ───────────────────────────────────

  it("stops at ENDSEC when forBlock=false", () => {
    const scanner = createScanner(
      "0", "LINE",
      "8", "Layer1",
      "10", "0.0",
      "20", "0.0",
      "11", "10.0",
      "21", "10.0",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entities = parseEntities(scanner, false);

    expect(entities).toHaveLength(1);
    expect(entities[0].type).toBe("LINE");
  });

  // ── Handle auto-increment ────────────────────────────────────────────

  it("assigns auto-incrementing handles to entities without explicit handles", () => {
    const scanner = createScanner(
      "0", "POINT",
      "8", "Layer1",
      "10", "1.0",
      "20", "2.0",
      "0", "POINT",
      "8", "Layer1",
      "10", "3.0",
      "20", "4.0",
      "0", "POINT",
      "8", "Layer1",
      "10", "5.0",
      "20", "6.0",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entities = parseEntities(scanner, false);

    expect(entities).toHaveLength(3);
    expect(entities[0].handle).toBe(0);
    expect(entities[1].handle).toBe(1);
    expect(entities[2].handle).toBe(2);
  });

  // ── Empty ENTITIES section ───────────────────────────────────────────

  it("returns an empty array for an empty ENTITIES section", () => {
    const scanner = createScanner(
      "0", "ENDSEC",
      "0", "EOF",
    );

    const entities = parseEntities(scanner, false);

    expect(entities).toHaveLength(0);
    expect(entities).toEqual([]);
  });
});
