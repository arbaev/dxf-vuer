import { describe, it, expect } from "vitest";
import { createScannerAt } from "../../__tests__/test-helpers";
import { parseText } from "../text";
import { parseMText } from "../mtext";
import { parseAttdef } from "../attdef";
import { parseDimension } from "../dimension";
import { parseInsert } from "../insert";

// ══════════════════════════════════════════════════════════════════════════════
// TEXT entity handler
// ══════════════════════════════════════════════════════════════════════════════

describe("parseText", () => {
  it("parses basic text with startPoint and text content", () => {
    const { scanner, group } = createScannerAt(
      "0", "TEXT",
      "10", "5.0",
      "20", "10.0",
      "1", "Hello World",
      "0", "EOF",
    );

    const entity = parseText(scanner, group);

    expect(entity.type).toBe("TEXT");
    expect(entity.startPoint).toEqual({ x: 5.0, y: 10.0 });
    expect(entity.text).toBe("Hello World");
  });

  it("parses text with horizontal and vertical alignment", () => {
    const { scanner, group } = createScannerAt(
      "0", "TEXT",
      "10", "0.0",
      "20", "0.0",
      "11", "50.0",
      "21", "25.0",
      "1", "Aligned Text",
      "72", "1",
      "73", "2",
      "0", "EOF",
    );

    const entity = parseText(scanner, group);

    expect(entity.type).toBe("TEXT");
    expect(entity.startPoint).toEqual({ x: 0.0, y: 0.0 });
    expect(entity.endPoint).toEqual({ x: 50.0, y: 25.0 });
    expect(entity.text).toBe("Aligned Text");
    expect(entity.halign).toBe(1);
    expect(entity.valign).toBe(2);
  });

  it("parses text with rotation and height", () => {
    const { scanner, group } = createScannerAt(
      "0", "TEXT",
      "10", "1.0",
      "20", "2.0",
      "40", "3.5",
      "50", "45.0",
      "1", "Rotated",
      "0", "EOF",
    );

    const entity = parseText(scanner, group);

    expect(entity.type).toBe("TEXT");
    expect(entity.startPoint).toEqual({ x: 1.0, y: 2.0 });
    expect(entity.textHeight).toBe(3.5);
    expect(entity.rotation).toBe(45.0);
    expect(entity.text).toBe("Rotated");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// MTEXT entity handler
// ══════════════════════════════════════════════════════════════════════════════

describe("parseMText", () => {
  it("parses basic mtext with position and text", () => {
    const { scanner, group } = createScannerAt(
      "0", "MTEXT",
      "10", "10.0",
      "20", "20.0",
      "30", "0.0",
      "1", "Simple MTEXT",
      "0", "EOF",
    );

    const entity = parseMText(scanner, group);

    expect(entity.type).toBe("MTEXT");
    expect(entity.position).toEqual({ x: 10.0, y: 20.0, z: 0.0 });
    expect(entity.text).toBe("Simple MTEXT");
  });

  it("concatenates text from code 3 and code 1 chunks", () => {
    // The scanner trims values, so trailing spaces are removed.
    // Code 3 groups come first for long text, code 1 is the last chunk.
    const { scanner, group } = createScannerAt(
      "0", "MTEXT",
      "10", "0.0",
      "20", "0.0",
      "3", "First chunk",
      "3", "Second chunk",
      "1", "Final chunk",
      "0", "EOF",
    );

    const entity = parseMText(scanner, group);

    expect(entity.type).toBe("MTEXT");
    expect(entity.text).toBe("First chunkSecond chunkFinal chunk");
  });

  it("parses mtext with all properties", () => {
    const { scanner, group } = createScannerAt(
      "0", "MTEXT",
      "10", "5.0",
      "20", "15.0",
      "30", "0.0",
      "40", "2.5",
      "41", "100.0",
      "50", "90.0",
      "71", "1",
      "72", "5",
      "1", "Full MTEXT",
      "0", "EOF",
    );

    const entity = parseMText(scanner, group);

    expect(entity.type).toBe("MTEXT");
    expect(entity.position).toEqual({ x: 5.0, y: 15.0, z: 0.0 });
    expect(entity.height).toBe(2.5);
    expect(entity.width).toBe(100.0);
    expect(entity.rotation).toBe(90.0);
    expect(entity.attachmentPoint).toBe(1);
    expect(entity.drawingDirection).toBe(5);
    expect(entity.text).toBe("Full MTEXT");
  });

  it("parses mtext with direction vector", () => {
    const { scanner, group } = createScannerAt(
      "0", "MTEXT",
      "10", "0.0",
      "20", "0.0",
      "11", "1.0",
      "21", "0.0",
      "31", "0.0",
      "1", "Directed text",
      "0", "EOF",
    );

    const entity = parseMText(scanner, group);

    expect(entity.type).toBe("MTEXT");
    expect(entity.directionVector).toEqual({ x: 1.0, y: 0.0, z: 0.0 });
    expect(entity.text).toBe("Directed text");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ATTDEF entity handler
// ══════════════════════════════════════════════════════════════════════════════

describe("parseAttdef", () => {
  it("parses basic attdef with text, tag, and prompt", () => {
    const { scanner, group } = createScannerAt(
      "0", "ATTDEF",
      "10", "1.0",
      "20", "2.0",
      "40", "2.5",
      "1", "Default Value",
      "2", "ATTR_TAG",
      "3", "Enter value:",
      "0", "EOF",
    );

    const entity = parseAttdef(scanner, group);

    expect(entity.type).toBe("ATTDEF");
    expect(entity.startPoint).toEqual({ x: 1.0, y: 2.0 });
    expect(entity.textHeight).toBe(2.5);
    expect(entity.text).toBe("Default Value");
    expect(entity.tag).toBe("ATTR_TAG");
    expect(entity.prompt).toBe("Enter value:");
  });

  it("sets default values for scale and textStyle", () => {
    const { scanner, group } = createScannerAt(
      "0", "ATTDEF",
      "1", "Test",
      "2", "TAG",
      "0", "EOF",
    );

    const entity = parseAttdef(scanner, group);

    expect(entity.type).toBe("ATTDEF");
    expect(entity.scale).toBe(1);
    expect(entity.textStyle).toBe("STANDARD");
  });

  it("parses invisible and constant flags from code 70 value 3", () => {
    const { scanner, group } = createScannerAt(
      "0", "ATTDEF",
      "1", "Hidden",
      "2", "SECRET",
      "70", "3",
      "0", "EOF",
    );

    const entity = parseAttdef(scanner, group);

    expect(entity.type).toBe("ATTDEF");
    // Code 70 = 3 means bit 1 (invisible) + bit 2 (constant) are set
    expect(entity.invisible).toBe(true);
    expect(entity.constant).toBe(true);
    expect(entity.verificationRequired).toBe(false);
    expect(entity.preset).toBe(false);
  });

  it("parses backwards and mirrored flags from code 71 value 6", () => {
    const { scanner, group } = createScannerAt(
      "0", "ATTDEF",
      "1", "Mirror",
      "2", "TAG",
      "71", "6",
      "0", "EOF",
    );

    const entity = parseAttdef(scanner, group);

    expect(entity.type).toBe("ATTDEF");
    // Code 71 = 6 means bit 2 (backwards) + bit 4 (mirrored) are set
    expect(entity.backwards).toBe(true);
    expect(entity.mirrored).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DIMENSION entity handler
// ══════════════════════════════════════════════════════════════════════════════

describe("parseDimension", () => {
  it("parses linear dimension with anchor, text-middle, and linear points", () => {
    const { scanner, group } = createScannerAt(
      "0", "DIMENSION",
      "10", "50.0",
      "20", "30.0",
      "11", "25.0",
      "21", "35.0",
      "13", "0.0",
      "23", "0.0",
      "14", "50.0",
      "24", "0.0",
      "70", "0",
      "0", "EOF",
    );

    const entity = parseDimension(scanner, group);

    expect(entity.type).toBe("DIMENSION");
    expect(entity.anchorPoint).toEqual({ x: 50.0, y: 30.0 });
    expect(entity.middleOfText).toEqual({ x: 25.0, y: 35.0 });
    expect(entity.linearOrAngularPoint1).toEqual({ x: 0.0, y: 0.0 });
    expect(entity.linearOrAngularPoint2).toEqual({ x: 50.0, y: 0.0 });
    expect(entity.dimensionType).toBe(0);
  });

  it("parses dimension with actual measurement and text override", () => {
    const { scanner, group } = createScannerAt(
      "0", "DIMENSION",
      "10", "10.0",
      "20", "10.0",
      "42", "123.456",
      "1", "123.46",
      "140", "2.5",
      "0", "EOF",
    );

    const entity = parseDimension(scanner, group);

    expect(entity.type).toBe("DIMENSION");
    expect(entity.actualMeasurement).toBeCloseTo(123.456);
    expect(entity.text).toBe("123.46");
    expect(entity.textHeight).toBe(2.5);
  });

  it("parses dimension type, style name, and angle", () => {
    const { scanner, group } = createScannerAt(
      "0", "DIMENSION",
      "2", "*D5",
      "3", "STANDARD",
      "10", "0.0",
      "20", "0.0",
      "70", "1",
      "50", "45.0",
      "0", "EOF",
    );

    const entity = parseDimension(scanner, group);

    expect(entity.type).toBe("DIMENSION");
    expect(entity.block).toBe("*D5");
    expect(entity.styleName).toBe("STANDARD");
    expect(entity.dimensionType).toBe(1);
    expect(entity.angle).toBe(45.0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// INSERT entity handler
// ══════════════════════════════════════════════════════════════════════════════

describe("parseInsert", () => {
  it("parses basic insert with name and position", () => {
    const { scanner, group } = createScannerAt(
      "0", "INSERT",
      "2", "MyBlock",
      "10", "100.0",
      "20", "200.0",
      "30", "0.0",
      "0", "EOF",
    );

    const entity = parseInsert(scanner, group);

    expect(entity.type).toBe("INSERT");
    expect(entity.name).toBe("MyBlock");
    expect(entity.position).toEqual({ x: 100.0, y: 200.0, z: 0.0 });
  });

  it("parses insert with scale and rotation", () => {
    const { scanner, group } = createScannerAt(
      "0", "INSERT",
      "2", "ScaledBlock",
      "10", "0.0",
      "20", "0.0",
      "41", "2.0",
      "42", "3.0",
      "43", "1.5",
      "50", "90.0",
      "0", "EOF",
    );

    const entity = parseInsert(scanner, group);

    expect(entity.type).toBe("INSERT");
    expect(entity.name).toBe("ScaledBlock");
    expect(entity.xScale).toBe(2.0);
    expect(entity.yScale).toBe(3.0);
    expect(entity.zScale).toBe(1.5);
    expect(entity.rotation).toBe(90.0);
  });

  it("parses insert with column and row counts and spacing", () => {
    const { scanner, group } = createScannerAt(
      "0", "INSERT",
      "2", "ArrayBlock",
      "10", "0.0",
      "20", "0.0",
      "70", "3",
      "71", "4",
      "44", "10.0",
      "45", "15.0",
      "0", "EOF",
    );

    const entity = parseInsert(scanner, group);

    expect(entity.type).toBe("INSERT");
    expect(entity.name).toBe("ArrayBlock");
    expect(entity.columnCount).toBe(3);
    expect(entity.rowCount).toBe(4);
    expect(entity.columnSpacing).toBe(10.0);
    expect(entity.rowSpacing).toBe(15.0);
  });

  it("skips ATTRIB entities until SEQEND", () => {
    const { scanner, group } = createScannerAt(
      "0", "INSERT",
      "2", "BlockName",
      "10", "0.0",
      "20", "0.0",
      "0", "ATTRIB",
      "1", "SomeValue",
      "2", "SomeTag",
      "0", "SEQEND",
      "8", "Layer1",
      "0", "EOF",
    );

    const entity = parseInsert(scanner, group);

    expect(entity.type).toBe("INSERT");
    expect(entity.name).toBe("BlockName");
    expect(entity.position).toEqual({ x: 0.0, y: 0.0 });
    // Verify that ATTRIB content was not assigned to the INSERT entity
    expect((entity as Record<string, unknown>).text).toBeUndefined();
  });
});
