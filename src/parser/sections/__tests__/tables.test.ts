import { describe, it, expect } from "vitest";
import { createScanner } from "../../__tests__/test-helpers";
import { parseTables } from "../tables";
import type { ILayer, ILineType, IStyle, IBlockRecord, IDimStyle } from "../tables";

describe("parseTables", () => {
  // ── Layers ──────────────────────────────────────────────────────────

  describe("parseLayers", () => {
    it("parses a single visible layer with color", () => {
      // Scanner starts after "0 SECTION / 2 TABLES" has been consumed.
      // parseTables calls scanner.next() itself.
      const scanner = createScanner(
        "0", "TABLE",
        "2", "LAYER",
        "70", "1",          // table max entries (skipped by parseTable)
        "0", "LAYER",       // first LAYER record
        "2", "MyLayer",
        "62", "7",          // positive = visible, color index 7
        "70", "0",          // not frozen
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "EOF",
      );

      const tables = parseTables(scanner);

      expect(tables).toHaveProperty("layer");
      const layers = tables.layer.layers as Record<string, ILayer>;
      expect(layers).toHaveProperty("MyLayer");
      expect(layers.MyLayer.name).toBe("MyLayer");
      expect(layers.MyLayer.visible).toBe(true);
      expect(layers.MyLayer.colorIndex).toBe(7);
      expect(layers.MyLayer.frozen).toBe(false);
    });

    it("marks layer as invisible when colorIndex is negative", () => {
      const scanner = createScanner(
        "0", "TABLE",
        "2", "LAYER",
        "70", "1",
        "0", "LAYER",
        "2", "HiddenLayer",
        "62", "-3",         // negative = invisible, actual index is 3
        "70", "0",
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "EOF",
      );

      const tables = parseTables(scanner);

      const layers = tables.layer.layers as Record<string, ILayer>;
      expect(layers.HiddenLayer.visible).toBe(false);
      expect(layers.HiddenLayer.colorIndex).toBe(3);
    });

    it("marks layer as frozen when bit 1 is set in code 70", () => {
      const scanner = createScanner(
        "0", "TABLE",
        "2", "LAYER",
        "70", "1",
        "0", "LAYER",
        "2", "FrozenLayer",
        "62", "5",
        "70", "1",          // bit 1 = frozen
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "EOF",
      );

      const tables = parseTables(scanner);

      const layers = tables.layer.layers as Record<string, ILayer>;
      expect(layers.FrozenLayer.frozen).toBe(true);
    });

    it("marks layer as locked when bit 4 is set in code 70", () => {
      const scanner = createScanner(
        "0", "TABLE",
        "2", "LAYER",
        "70", "1",
        "0", "LAYER",
        "2", "LockedLayer",
        "62", "5",
        "70", "4",          // bit 4 = locked
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "EOF",
      );

      const tables = parseTables(scanner);

      const layers = tables.layer.layers as Record<string, ILayer>;
      expect(layers.LockedLayer.locked).toBe(true);
      expect(layers.LockedLayer.frozen).toBe(false);
    });

    it("marks layer as both frozen and locked when bits 1+4 are set in code 70", () => {
      const scanner = createScanner(
        "0", "TABLE",
        "2", "LAYER",
        "70", "1",
        "0", "LAYER",
        "2", "FrozenLocked",
        "62", "5",
        "70", "5",          // bit 1 (frozen) + bit 4 (locked) = 5
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "EOF",
      );

      const tables = parseTables(scanner);

      const layers = tables.layer.layers as Record<string, ILayer>;
      expect(layers.FrozenLocked.frozen).toBe(true);
      expect(layers.FrozenLocked.locked).toBe(true);
    });

    it("sets locked=false for a normal layer (code 70 = 0)", () => {
      const scanner = createScanner(
        "0", "TABLE",
        "2", "LAYER",
        "70", "1",
        "0", "LAYER",
        "2", "NormalLayer",
        "62", "5",
        "70", "0",          // no flags
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "EOF",
      );

      const tables = parseTables(scanner);

      const layers = tables.layer.layers as Record<string, ILayer>;
      expect(layers.NormalLayer.locked).toBe(false);
      expect(layers.NormalLayer.frozen).toBe(false);
    });

    it("parses layer lineType (code 6)", () => {
      const scanner = createScanner(
        "0", "TABLE",
        "2", "LAYER",
        "70", "1",
        "0", "LAYER",
        "2", "DashedLayer",
        "6", "DASHED",
        "62", "5",
        "70", "0",
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "EOF",
      );

      const tables = parseTables(scanner);

      const layers = tables.layer.layers as Record<string, ILayer>;
      expect(layers.DashedLayer.lineType).toBe("DASHED");
    });

    it("parses multiple layers in sequence", () => {
      const scanner = createScanner(
        "0", "TABLE",
        "2", "LAYER",
        "70", "3",
        "0", "LAYER",
        "2", "Layer0",
        "62", "7",
        "70", "0",
        "0", "LAYER",
        "2", "Layer1",
        "62", "1",
        "70", "0",
        "0", "LAYER",
        "2", "Layer2",
        "62", "-5",
        "70", "2",          // bit 2 = frozen by default in new viewports
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "EOF",
      );

      const tables = parseTables(scanner);

      const layers = tables.layer.layers as Record<string, ILayer>;
      expect(Object.keys(layers)).toHaveLength(3);

      expect(layers.Layer0.visible).toBe(true);
      expect(layers.Layer0.colorIndex).toBe(7);
      expect(layers.Layer0.frozen).toBe(false);

      expect(layers.Layer1.visible).toBe(true);
      expect(layers.Layer1.colorIndex).toBe(1);

      expect(layers.Layer2.visible).toBe(false);
      expect(layers.Layer2.colorIndex).toBe(5);
      expect(layers.Layer2.frozen).toBe(true);
    });
  });

  // ── Line Types ──────────────────────────────────────────────────────

  describe("parseLineTypes", () => {
    it("parses a line type with dash-dot pattern", () => {
      const scanner = createScanner(
        "0", "TABLE",
        "2", "LTYPE",
        "70", "1",
        "0", "LTYPE",       // first LTYPE record
        "2", "DASHDOT",
        "3", "Dash dot __ . __ . __ .",
        "73", "4",          // 4 elements in pattern
        "40", "1.6",        // pattern length
        "49", "1.0",        // dash
        "49", "-0.2",       // gap
        "49", "0.0",        // dot
        "49", "-0.2",       // gap
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "EOF",
      );

      const tables = parseTables(scanner);

      expect(tables).toHaveProperty("lineType");
      const ltypes = tables.lineType.lineTypes as Record<string, ILineType>;
      expect(ltypes).toHaveProperty("DASHDOT");
      expect(ltypes.DASHDOT.name).toBe("DASHDOT");
      expect(ltypes.DASHDOT.description).toBe("Dash dot __ . __ . __ .");
      expect(ltypes.DASHDOT.patternLength).toBe(1.6);
      expect(ltypes.DASHDOT.pattern).toHaveLength(4);
      expect(ltypes.DASHDOT.pattern[0]).toBe(1.0);
      expect(ltypes.DASHDOT.pattern[1]).toBe(-0.2);
      expect(ltypes.DASHDOT.pattern[2]).toBe(0.0);
      expect(ltypes.DASHDOT.pattern[3]).toBe(-0.2);
    });

    it("parses a line type without pattern (CONTINUOUS)", () => {
      const scanner = createScanner(
        "0", "TABLE",
        "2", "LTYPE",
        "70", "1",
        "0", "LTYPE",
        "2", "CONTINUOUS",
        "3", "Solid line",
        "73", "0",           // 0 elements = no pattern
        "40", "0.0",
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "EOF",
      );

      const tables = parseTables(scanner);

      const ltypes = tables.lineType.lineTypes as Record<string, ILineType>;
      expect(ltypes.CONTINUOUS.name).toBe("CONTINUOUS");
      expect(ltypes.CONTINUOUS.description).toBe("Solid line");
      expect(ltypes.CONTINUOUS.patternLength).toBe(0.0);
      // pattern array is not created when length is 0
      expect(ltypes.CONTINUOUS.pattern).toBeUndefined();
    });
  });

  // ── Viewport Records ────────────────────────────────────────────────

  describe("parseViewPortRecords", () => {
    it("parses a single viewport record", () => {
      const scanner = createScanner(
        "0", "TABLE",
        "2", "VPORT",
        "70", "1",
        "0", "VPORT",        // first VPORT record
        "2", "*ACTIVE",
        "10", "0.0",         // lowerLeftCorner.x
        "20", "0.0",         // lowerLeftCorner.y
        "11", "1.0",         // upperRightCorner.x
        "21", "1.0",         // upperRightCorner.y
        "12", "5.0",         // center.x
        "22", "3.0",         // center.y
        "45", "10.0",        // viewHeight
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "EOF",
      );

      const tables = parseTables(scanner);

      expect(tables).toHaveProperty("viewPort");
      const viewPorts = tables.viewPort.viewPorts as Record<string, unknown>[];
      expect(viewPorts).toHaveLength(1);

      const vp = viewPorts[0];
      expect(vp.name).toBe("*ACTIVE");
      expect(vp.viewHeight).toBe(10.0);

      const lower = vp.lowerLeftCorner as { x: number; y: number };
      expect(lower.x).toBe(0.0);
      expect(lower.y).toBe(0.0);

      const upper = vp.upperRightCorner as { x: number; y: number };
      expect(upper.x).toBe(1.0);
      expect(upper.y).toBe(1.0);

      const center = vp.center as { x: number; y: number };
      expect(center.x).toBe(5.0);
      expect(center.y).toBe(3.0);
    });
  });

  // ── Styles ──────────────────────────────────────────────────────────

  describe("parseStyles", () => {
    it("parses a single STYLE with Arial font", () => {
      const scanner = createScanner(
        "0", "TABLE",
        "2", "STYLE",
        "70", "1",
        "0", "STYLE",
        "2", "Standard",
        "3", "arial.ttf",
        "40", "0.0",
        "41", "1.0",
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "EOF",
      );

      const tables = parseTables(scanner);

      expect(tables).toHaveProperty("style");
      const styles = tables.style.styles as Record<string, IStyle>;
      expect(styles).toHaveProperty("Standard");
      expect(styles.Standard.name).toBe("Standard");
      expect(styles.Standard.fontFile).toBe("arial.ttf");
      expect(styles.Standard.fixedHeight).toBe(0.0);
      expect(styles.Standard.widthFactor).toBe(1.0);
    });

    it("parses STYLE with txt.shx font", () => {
      const scanner = createScanner(
        "0", "TABLE",
        "2", "STYLE",
        "70", "1",
        "0", "STYLE",
        "2", "Notes",
        "3", "txt.shx",
        "4", "bigfont.shx",
        "40", "2.5",
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "EOF",
      );

      const tables = parseTables(scanner);

      const styles = tables.style.styles as Record<string, IStyle>;
      expect(styles.Notes.fontFile).toBe("txt.shx");
      expect(styles.Notes.bigFont).toBe("bigfont.shx");
      expect(styles.Notes.fixedHeight).toBe(2.5);
    });

    it("parses multiple styles", () => {
      const scanner = createScanner(
        "0", "TABLE",
        "2", "STYLE",
        "70", "2",
        "0", "STYLE",
        "2", "Standard",
        "3", "arial.ttf",
        "40", "0.0",
        "41", "1.0",
        "0", "STYLE",
        "2", "Heading",
        "3", "times.ttf",
        "40", "5.0",
        "41", "0.8",
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "EOF",
      );

      const tables = parseTables(scanner);

      const styles = tables.style.styles as Record<string, IStyle>;
      expect(Object.keys(styles)).toHaveLength(2);
      expect(styles.Standard.fontFile).toBe("arial.ttf");
      expect(styles.Heading.fontFile).toBe("times.ttf");
      expect(styles.Heading.fixedHeight).toBe(5.0);
      expect(styles.Heading.widthFactor).toBe(0.8);
    });
  });

  // ── STYLE alongside other tables ──────────────────────────────────

  it("parses STYLE table alongside LAYER table", () => {
    const scanner = createScanner(
      "0", "TABLE",
      "2", "STYLE",
      "70", "1",
      "0", "STYLE",
      "2", "Standard",
      "3", "arial.ttf",
      "40", "0.0",
      "0", "ENDTAB",
      "0", "TABLE",
      "2", "LAYER",
      "70", "1",
      "0", "LAYER",
      "2", "Layer0",
      "62", "7",
      "70", "0",
      "0", "ENDTAB",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const tables = parseTables(scanner);

    expect(tables).toHaveProperty("style");
    expect(tables).toHaveProperty("layer");
    const styles = tables.style.styles as Record<string, IStyle>;
    expect(styles).toHaveProperty("Standard");
    const layers = tables.layer.layers as Record<string, ILayer>;
    expect(layers).toHaveProperty("Layer0");
  });

  // ── Block Records ──────────────────────────────────────────────────

  describe("parseBlockRecords", () => {
    it("parses BLOCK_RECORD with units", () => {
      const scanner = createScanner(
        "0", "TABLE",
        "2", "BLOCK_RECORD",
        "70", "3",               // max entries (skipped)
        "0", "BLOCK_RECORD",     // first record
        "2", "*Model_Space",
        "70", "0",               // Unitless
        "0", "BLOCK_RECORD",
        "2", "*Paper_Space",
        "70", "0",
        "0", "BLOCK_RECORD",
        "2", "MyBlock",
        "70", "4",               // Millimeters
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "EOF",
      );

      const tables = parseTables(scanner);

      expect(tables).toHaveProperty("blockRecord");
      const records = tables.blockRecord.blockRecords as Record<string, IBlockRecord>;
      expect(records).toHaveProperty("*Model_Space");
      expect(records["*Model_Space"].units).toBe(0);
      expect(records).toHaveProperty("MyBlock");
      expect(records.MyBlock.name).toBe("MyBlock");
      expect(records.MyBlock.units).toBe(4);
    });

    it("parses BLOCK_RECORD with inches units", () => {
      const scanner = createScanner(
        "0", "TABLE",
        "2", "BLOCK_RECORD",
        "70", "1",
        "0", "BLOCK_RECORD",
        "2", "InchBlock",
        "70", "1",               // Inches
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "EOF",
      );

      const tables = parseTables(scanner);

      const records = tables.blockRecord.blockRecords as Record<string, IBlockRecord>;
      expect(records.InchBlock.units).toBe(1);
    });
  });

  // ── DIMSTYLE ────────────────────────────────────────────────────────

  describe("parseDimStyles", () => {
    it("parses DIMSTYLE with dimtsz (code 142)", () => {
      const scanner = createScanner(
        "0", "TABLE",
        "2", "DIMSTYLE",
        "70", "1",
        "0", "DIMSTYLE",
        "2", "Arch",
        "142", "2.5",        // DIMTSZ — tick size
        "277", "4",           // DIMLUNIT — architectural
        "78", "0",            // DIMZIN
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "EOF",
      );

      const tables = parseTables(scanner);

      expect(tables).toHaveProperty("dimStyle");
      const dimStyles = tables.dimStyle.dimStyles as Record<string, IDimStyle>;
      expect(dimStyles).toHaveProperty("Arch");
      expect(dimStyles.Arch.dimtsz).toBe(2.5);
      expect(dimStyles.Arch.dimlunit).toBe(4);
    });

    it("parses DIMSTYLE with dimscale, dimasz, dimtxt, dimclrt", () => {
      const scanner = createScanner(
        "0", "TABLE",
        "2", "DIMSTYLE",
        "70", "1",
        "0", "DIMSTYLE",
        "2", "ARCHARR",
        "40", "32",            // DIMSCALE
        "41", "0.15625",       // DIMASZ — arrow size
        "140", "0.1875",       // DIMTXT — text height
        "178", "1",            // DIMCLRT — text color (red)
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "EOF",
      );

      const tables = parseTables(scanner);

      const dimStyles = tables.dimStyle.dimStyles as Record<string, IDimStyle>;
      expect(dimStyles).toHaveProperty("ARCHARR");
      expect(dimStyles.ARCHARR.dimscale).toBe(32);
      expect(dimStyles.ARCHARR.dimasz).toBe(0.15625);
      expect(dimStyles.ARCHARR.dimtxt).toBe(0.1875);
      expect(dimStyles.ARCHARR.dimclrt).toBe(1);
    });
  });

  // ── Empty TABLES section ────────────────────────────────────────────

  it("returns an empty object for an empty TABLES section (immediate ENDSEC)", () => {
    const scanner = createScanner(
      "0", "ENDSEC",
      "0", "EOF",
    );

    const tables = parseTables(scanner);

    expect(tables).toEqual({});
  });
});
