import { describe, it, expect } from "vitest";
import { parseDxf } from "../index";

// Helper: builds a DXF string from code/value pairs joined by newlines.
function buildDxf(...pairs: string[]): string {
  return pairs.join("\n");
}

describe("parseDxf", () => {
  // ── 1. Empty string → "Empty file" error ─────────────────────────────

  it("throws 'Empty file' when given an empty string", () => {
    expect(() => parseDxf("")).toThrow("Empty file");
  });

  // ── 2. Minimal valid DXF (EOF only) ──────────────────────────────────

  it("returns DxfData with empty entities for a minimal DXF containing only EOF", () => {
    const dxfText = buildDxf("0", "EOF");
    const result = parseDxf(dxfText);

    expect(result).toBeDefined();
    expect(result.entities).toEqual([]);
  });

  // ── 3. DXF with HEADER section ($ACADVER) ────────────────────────────

  it("parses HEADER section and extracts $ACADVER variable", () => {
    const dxfText = buildDxf(
      "0", "SECTION",
      "2", "HEADER",
      "9", "$ACADVER",
      "1", "AC1027",
      "0", "ENDSEC",
      "0", "EOF",
    );
    const result = parseDxf(dxfText);

    expect(result.header).toBeDefined();
    expect(result.header!.$ACADVER).toBe("AC1027");
    expect(result.entities).toEqual([]);
  });

  // ── 4. DXF with ENTITIES section (single LINE) ──────────────────────

  it("parses ENTITIES section with a single LINE entity", () => {
    const dxfText = buildDxf(
      "0", "SECTION",
      "2", "ENTITIES",
      "0", "LINE",
      "8", "Layer1",
      "10", "0.0",
      "20", "0.0",
      "11", "100.0",
      "21", "50.0",
      "0", "ENDSEC",
      "0", "EOF",
    );
    const result = parseDxf(dxfText);

    expect(result.entities).toHaveLength(1);

    const line = result.entities[0];
    expect(line.type).toBe("LINE");
    expect(line.layer).toBe("Layer1");

    // LINE entity has two vertices: start (code 10/20) and end (code 11/21)
    const lineEntity = line as { type: string; vertices: Array<{ x: number; y: number }> };
    expect(lineEntity.vertices).toHaveLength(2);
    // Start point (code 10/20)
    expect(lineEntity.vertices[0]).toMatchObject({ x: 0.0, y: 0.0 });
    // End point (code 11/21)
    expect(lineEntity.vertices[1]).toMatchObject({ x: 100.0, y: 50.0 });
  });

  // ── 5. Multiple entities (LINE + CIRCLE) ─────────────────────────────

  it("parses multiple entities (LINE + CIRCLE) in ENTITIES section", () => {
    const dxfText = buildDxf(
      "0", "SECTION",
      "2", "ENTITIES",
      // LINE entity
      "0", "LINE",
      "8", "Layer1",
      "10", "0.0",
      "20", "0.0",
      "11", "10.0",
      "21", "10.0",
      // CIRCLE entity
      "0", "CIRCLE",
      "8", "Layer2",
      "10", "5.0",
      "20", "5.0",
      "40", "2.5",
      "0", "ENDSEC",
      "0", "EOF",
    );
    const result = parseDxf(dxfText);

    expect(result.entities).toHaveLength(2);
    expect(result.entities[0].type).toBe("LINE");
    expect(result.entities[1].type).toBe("CIRCLE");

    // Verify CIRCLE properties
    const circle = result.entities[1];
    if (circle.type === "CIRCLE") {
      expect(circle.center).toMatchObject({ x: 5.0, y: 5.0 });
      expect(circle.radius).toBe(2.5);
      expect(circle.layer).toBe("Layer2");
    }
  });

  // ── 6. DXF with TABLES section (one LAYER) ──────────────────────────

  it("parses TABLES section with a LAYER table", () => {
    const dxfText = buildDxf(
      "0", "SECTION",
      "2", "TABLES",
      "0", "TABLE",
      "2", "LAYER",
      "70", "1",
      // Layer record
      "0", "LAYER",
      "2", "MyLayer",
      "62", "7",
      "70", "0",
      "0", "ENDTAB",
      "0", "ENDSEC",
      "0", "EOF",
    );
    const result = parseDxf(dxfText);

    expect(result.tables).toBeDefined();
    // parseTables() stores LAYER table under "layer" key
    const layerTable = result.tables!.layer;
    expect(layerTable).toBeDefined();
    // Layers are stored in "layers" property inside the table
    const layers = (layerTable as Record<string, unknown>).layers as Record<string, unknown>;
    expect(layers).toBeDefined();
    expect(layers["MyLayer"]).toBeDefined();
    // Verify layer properties
    const myLayer = layers["MyLayer"] as Record<string, unknown>;
    expect(myLayer.name).toBe("MyLayer");
    expect(myLayer.colorIndex).toBe(7);
    expect(myLayer.visible).toBe(true);
    expect(myLayer.frozen).toBe(false);
  });

  // ── 7. DXF with all sections (HEADER + TABLES + ENTITIES) ───────────

  it("parses DXF with all sections: HEADER, TABLES, and ENTITIES", () => {
    const dxfText = buildDxf(
      // HEADER
      "0", "SECTION",
      "2", "HEADER",
      "9", "$ACADVER",
      "1", "AC1032",
      "0", "ENDSEC",
      // TABLES
      "0", "SECTION",
      "2", "TABLES",
      "0", "TABLE",
      "2", "LAYER",
      "70", "1",
      "0", "LAYER",
      "2", "DefaultLayer",
      "62", "1",
      "70", "0",
      "0", "ENDTAB",
      "0", "ENDSEC",
      // ENTITIES
      "0", "SECTION",
      "2", "ENTITIES",
      "0", "LINE",
      "8", "DefaultLayer",
      "10", "0.0",
      "20", "0.0",
      "11", "50.0",
      "21", "25.0",
      "0", "ENDSEC",
      "0", "EOF",
    );
    const result = parseDxf(dxfText);

    // HEADER should be populated
    expect(result.header).toBeDefined();
    expect(result.header!.$ACADVER).toBe("AC1032");

    // TABLES should be populated
    expect(result.tables).toBeDefined();
    const layerTable = result.tables!.layer as Record<string, unknown>;
    expect(layerTable).toBeDefined();
    const layers = layerTable.layers as Record<string, unknown>;
    expect(layers["DefaultLayer"]).toBeDefined();

    // ENTITIES should be populated
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].type).toBe("LINE");
    expect(result.entities[0].layer).toBe("DefaultLayer");
  });

  // ── 8. Unknown section → silently skipped ────────────────────────────

  it("silently skips unknown sections without throwing errors", () => {
    const dxfText = buildDxf(
      // Unknown section
      "0", "SECTION",
      "2", "OBJECTS",
      "0", "DICTIONARY",
      "5", "C",
      "0", "ENDSEC",
      // ENTITIES section after the unknown one
      "0", "SECTION",
      "2", "ENTITIES",
      "0", "LINE",
      "8", "Layer1",
      "10", "0.0",
      "20", "0.0",
      "11", "1.0",
      "21", "1.0",
      "0", "ENDSEC",
      "0", "EOF",
    );

    // Should not throw
    const result = parseDxf(dxfText);

    // ENTITIES section after the unknown one should still be parsed
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].type).toBe("LINE");
  });

  // ── 9. Section with code != 2 after SECTION → skipped ───────────────

  it("skips a section where the group after SECTION has code != 2", () => {
    const dxfText = buildDxf(
      // Malformed section: code 5 follows "0 SECTION" instead of code 2
      "0", "SECTION",
      "5", "DEADBEEF",
      "0", "ENDSEC",
      // Valid ENTITIES section
      "0", "SECTION",
      "2", "ENTITIES",
      "0", "CIRCLE",
      "10", "10.0",
      "20", "20.0",
      "40", "5.0",
      "0", "ENDSEC",
      "0", "EOF",
    );
    const result = parseDxf(dxfText);

    // Malformed section should be skipped
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].type).toBe("CIRCLE");
  });

  // ── 10. Different line endings (\r\n, \r, \n) ───────────────────────

  describe("handles different line endings", () => {
    const pairs = [
      "0", "SECTION",
      "2", "ENTITIES",
      "0", "LINE",
      "8", "L1",
      "10", "1.0",
      "20", "2.0",
      "11", "3.0",
      "21", "4.0",
      "0", "ENDSEC",
      "0", "EOF",
    ];

    it("parses correctly with Unix line endings (\\n)", () => {
      const dxfText = pairs.join("\n");
      const result = parseDxf(dxfText);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].type).toBe("LINE");
    });

    it("parses correctly with Windows line endings (\\r\\n)", () => {
      const dxfText = pairs.join("\r\n");
      const result = parseDxf(dxfText);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].type).toBe("LINE");
    });

    it("parses correctly with old Mac line endings (\\r)", () => {
      const dxfText = pairs.join("\r");
      const result = parseDxf(dxfText);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].type).toBe("LINE");
    });
  });
});
