import { describe, it, expect } from "vitest";
import {
  replaceSpecialChars,
  parseTextWithUnderline,
  parseMTextContent,
  getMTextHAlign,
  getTextHAlign,
  getMTextVAlign,
  getTextVAlign,
} from "../text";

// ── replaceSpecialChars ──────────────────────────────────────────────────

describe("replaceSpecialChars", () => {
  it("replaces %%d with degree sign (U+00B0)", () => {
    expect(replaceSpecialChars("45%%d")).toBe("45\u00B0");
  });

  it("replaces %%D (uppercase) with degree sign", () => {
    expect(replaceSpecialChars("90%%D")).toBe("90\u00B0");
  });

  it("replaces %%p with plus-minus sign (U+00B1)", () => {
    expect(replaceSpecialChars("%%p0.5")).toBe("\u00B10.5");
  });

  it("replaces %%P (uppercase) with plus-minus sign", () => {
    expect(replaceSpecialChars("%%P0.1")).toBe("\u00B10.1");
  });

  it("replaces %%c with diameter sign (U+2300)", () => {
    expect(replaceSpecialChars("%%c20")).toBe("\u230020");
  });

  it("replaces %%C (uppercase) with diameter sign", () => {
    expect(replaceSpecialChars("%%C50")).toBe("\u230050");
  });

  it("removes underline/overline toggles (%%u, %%U, %%o, %%O)", () => {
    expect(replaceSpecialChars("%%uBold%%U")).toBe("Bold");
    expect(replaceSpecialChars("%%oline%%O")).toBe("line");
  });

  it("converts %%nnn (3-digit code) to character by code", () => {
    // 065 = 'A', 066 = 'B'
    expect(replaceSpecialChars("%%065%%066")).toBe("AB");
  });

  it("handles multiple different special chars in one string", () => {
    expect(replaceSpecialChars("%%c20%%p0.5%%d")).toBe(
      "\u230020\u00B10.5\u00B0",
    );
  });

  it("passes U+2300 (⌀ DIAMETER SIGN) through unchanged", () => {
    expect(replaceSpecialChars("\u230050")).toBe("\u230050");
  });

  it("passes U+2205 (∅ EMPTY SET) through unchanged", () => {
    expect(replaceSpecialChars("\u220530")).toBe("\u220530");
  });

  it("returns plain text unchanged when no special chars are present", () => {
    expect(replaceSpecialChars("Hello World")).toBe("Hello World");
  });

  it("returns empty string unchanged", () => {
    expect(replaceSpecialChars("")).toBe("");
  });

  it("replaces ^I (caret notation tab) with space", () => {
    expect(replaceSpecialChars("MARK^IITEM")).toBe("MARK ITEM");
    expect(replaceSpecialChars("X-00^I^IREFRIGERATOR")).toBe("X-00  REFRIGERATOR");
  });

  it("replaces ^^ with literal caret", () => {
    expect(replaceSpecialChars("100^^50")).toBe("100^50");
  });

  it("removes other caret notation control chars", () => {
    expect(replaceSpecialChars("text^Mmore")).toBe("textmore");
  });

  it("handles ^^ and ^I together", () => {
    expect(replaceSpecialChars("A^^B^IC")).toBe("A^B C");
  });
});

// ── parseTextWithUnderline ───────────────────────────────────────────────

describe("parseTextWithUnderline", () => {
  it("detects underline from %%u prefix", () => {
    const result = parseTextWithUnderline("%%uGREAT ROOM");
    expect(result.text).toBe("GREAT ROOM");
    expect(result.underline).toBe(true);
  });

  it("returns no underline for plain text", () => {
    const result = parseTextWithUnderline("Plain text");
    expect(result.text).toBe("Plain text");
    expect(result.underline).toBe(false);
  });

  it("detects underline with %%U (uppercase)", () => {
    const result = parseTextWithUnderline("%%UROOM NAME");
    expect(result.text).toBe("ROOM NAME");
    expect(result.underline).toBe(true);
  });

  it("replaces other special chars alongside %%u", () => {
    const result = parseTextWithUnderline("%%u45%%d");
    expect(result.text).toBe("45\u00B0");
    expect(result.underline).toBe(true);
  });
});

// ── parseMTextContent ────────────────────────────────────────────────────

describe("parseMTextContent", () => {
  it("parses plain text into a single MTextLine", () => {
    const result = parseMTextContent("Hello World");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Hello World");
    expect(result[0].color).toBeUndefined();
    expect(result[0].height).toBeUndefined();
  });

  it("splits text by \\P into multiple lines", () => {
    const result = parseMTextContent("Line 1\\PLine 2\\PLine 3");
    expect(result).toHaveLength(3);
    expect(result[0].text).toBe("Line 1");
    expect(result[1].text).toBe("Line 2");
    expect(result[2].text).toBe("Line 3");
  });

  it("sets ACI color with \\C<n>; (ACI 1 = red)", () => {
    const result = parseMTextContent("\\C1;Red text");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Red text");
    expect(result[0].color).toBe("#ff0000");
  });

  it("ACI color persists across lines", () => {
    const result = parseMTextContent("\\C5;Blue\\PStill blue");
    expect(result).toHaveLength(2);
    // ACI 5 = 255 = 0x0000FF = "#0000ff"
    expect(result[0].color).toBe("#0000ff");
    expect(result[1].color).toBe("#0000ff");
  });

  it("resets color to undefined with \\C0; (ByBlock)", () => {
    const result = parseMTextContent("\\C1;Red\\P\\C0;Default");
    expect(result).toHaveLength(2);
    expect(result[0].color).toBe("#ff0000");
    expect(result[1].color).toBeUndefined();
  });

  it("resets color to undefined with \\C256; (ByLayer)", () => {
    const result = parseMTextContent("\\C1;Red\\P\\C256;Default");
    expect(result).toHaveLength(2);
    expect(result[0].color).toBe("#ff0000");
    expect(result[1].color).toBeUndefined();
  });

  it("sets height with \\H<value>; (absolute)", () => {
    const result = parseMTextContent("\\H2.5;Big text");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Big text");
    expect(result[0].height).toBe(2.5);
  });

  it("sets height with \\H<value>x; (relative multiplier)", () => {
    const result = parseMTextContent("\\H1.5x;Title\\P\\H0.666667x;Body", 240);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("Title");
    expect(result[0].height).toBeCloseTo(360, 1); // 240 * 1.5
    expect(result[1].text).toBe("Body");
    expect(result[1].height).toBeCloseTo(240, 0); // 360 * 0.666667
  });

  it("relative \\Hx; without defaultHeight uses 1 as base", () => {
    const result = parseMTextContent("\\H2x;Double");
    expect(result).toHaveLength(1);
    expect(result[0].height).toBe(2); // 1 * 2
  });

  it("sets font, bold, and italic with \\f...;", () => {
    const result = parseMTextContent("\\fArial|b1|i1|c0|p0;Styled");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Styled");
    expect(result[0].fontFamily).toBe("Arial");
    expect(result[0].bold).toBe(true);
    expect(result[0].italic).toBe(true);
  });

  it("converts literal escape sequences: \\\\ -> \\, \\{ -> {, \\} -> }", () => {
    const result = parseMTextContent("A\\\\B\\{C\\}D");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("A\\B{C}D");
  });

  it("converts Unicode escapes \\U+XXXX to characters", () => {
    // U+0041 = 'A', U+00E9 = 'e with acute'
    const result = parseMTextContent("\\U+0041\\U+00E9");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("A\u00E9");
  });

  it("parses stacked text \\Stop^bottom;", () => {
    const result = parseMTextContent("\\S1^2;");
    expect(result).toHaveLength(1);
    expect(result[0].stackedTop).toBe("1");
    expect(result[0].stackedBottom).toBe("2");
  });

  it("renders \\S3#8; as inline flat fraction text '3/8'", () => {
    const result = parseMTextContent("\\S3#8;");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("3/8");
    expect(result[0].stackedTop).toBeUndefined();
    expect(result[0].stackedBottom).toBeUndefined();
  });

  it("brace-scoped \\H does not affect subsequent lines", () => {
    const result = parseMTextContent(
      "\\H0.5x;Normal\\P{\\H0.7x;\\S3#8;}rest\\PStill normal",
      18,
    );
    expect(result).toHaveLength(3);
    expect(result[0].height).toBeCloseTo(9); // 18 * 0.5
    expect(result[1].text).toBe("3/8rest"); // \S3#8; rendered as inline fraction
    expect(result[1].height).toBeCloseTo(9); // \H0.7x inside braces stripped
    expect(result[2].height).toBeCloseTo(9); // height unchanged
  });

  it("replaces \\~ (non-breaking space) with a regular space", () => {
    const result = parseMTextContent("Hello\\~World");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Hello World");
  });

  it("replaces \\N (column break) with a space", () => {
    const result = parseMTextContent("Col1\\NCol2");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Col1 Col2");
  });

  it("removes grouping braces {}", () => {
    const result = parseMTextContent("{grouped text}");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("grouped text");
  });

  it("sets underline with \\L and strips overline/strikethrough (\\O, \\K)", () => {
    const result = parseMTextContent("\\LUnderlined\\OOverlined\\KStrikethrough");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("UnderlinedOverlinedStrikethrough");
    expect(result[0].underline).toBe(true);
  });

  it("\\l turns off underline", () => {
    const result = parseMTextContent("\\LUnderlined\\l Normal");
    expect(result).toHaveLength(1);
    expect(result[0].underline).toBe(true);
    expect(result[0].text).toBe("Underlined Normal");
  });

  it("underline persists across \\P line breaks", () => {
    const result = parseMTextContent("\\LLine 1\\PLine 2");
    expect(result).toHaveLength(2);
    expect(result[0].underline).toBe(true);
    expect(result[1].underline).toBe(true);
  });

  it("no underline by default", () => {
    const result = parseMTextContent("Normal text");
    expect(result).toHaveLength(1);
    expect(result[0].underline).toBeUndefined();
  });

  it("removes \\W, \\T, \\Q, \\A formatting codes", () => {
    const result = parseMTextContent("\\W1.5;\\T0.1;\\Q15;\\A1;text");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("text");
  });

  it("parses paragraph indent \\pi<value>,l<value>;", () => {
    const result = parseMTextContent("\\pi-13.5,l18,t18;indented text");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("indented text");
    expect(result[0].firstIndent).toBe(-13.5);
    expect(result[0].leftMargin).toBe(18);
  });

  it("parses paragraph indent \\pi<value>; without left margin", () => {
    const result = parseMTextContent("\\pi2;indented text");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("indented text");
    expect(result[0].firstIndent).toBe(2);
    expect(result[0].leftMargin).toBeUndefined();
  });

  it("strips \\pxqc; alignment code", () => {
    const result = parseMTextContent("\\pxqc;centered text");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("centered text");
  });

  it("preserves empty lines from \\P\\P as paragraph spacing", () => {
    const result = parseMTextContent("First\\P\\PLast");
    expect(result).toHaveLength(3);
    expect(result[0].text).toBe("First");
    expect(result[1].text).toBe("");
    expect(result[2].text).toBe("Last");
  });

  it("applies DXF special chars (%%d, %%c, etc.) inside MTEXT", () => {
    const result = parseMTextContent("Angle: 45%%d, Dia: %%c20");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Angle: 45\u00B0, Dia: \u230020");
  });
});

// ── getMTextHAlign ───────────────────────────────────────────────────────

describe("getMTextHAlign", () => {
  it("returns 'left' when attachmentPoint is undefined", () => {
    expect(getMTextHAlign(undefined)).toBe("left");
  });

  it("returns 'left' when attachmentPoint is 0", () => {
    expect(getMTextHAlign(0)).toBe("left");
  });

  it("returns 'left' for attachment points 1, 4, 7", () => {
    expect(getMTextHAlign(1)).toBe("left");
    expect(getMTextHAlign(4)).toBe("left");
    expect(getMTextHAlign(7)).toBe("left");
  });

  it("returns 'center' for attachment points 2, 5, 8", () => {
    expect(getMTextHAlign(2)).toBe("center");
    expect(getMTextHAlign(5)).toBe("center");
    expect(getMTextHAlign(8)).toBe("center");
  });

  it("returns 'right' for attachment points 3, 6, 9", () => {
    expect(getMTextHAlign(3)).toBe("right");
    expect(getMTextHAlign(6)).toBe("right");
    expect(getMTextHAlign(9)).toBe("right");
  });
});

// ── getTextHAlign ────────────────────────────────────────────────────────

describe("getTextHAlign", () => {
  it("returns 'left' when halign is undefined", () => {
    expect(getTextHAlign(undefined)).toBe("left");
  });

  it("returns 'left' for halign=0 (Left) and halign=3 (Aligned) and halign=5 (Fit)", () => {
    expect(getTextHAlign(0)).toBe("left");
    expect(getTextHAlign(3)).toBe("left");
    expect(getTextHAlign(5)).toBe("left");
  });

  it("returns 'center' for halign=1 (Center) and halign=4 (Middle)", () => {
    expect(getTextHAlign(1)).toBe("center");
    expect(getTextHAlign(4)).toBe("center");
  });

  it("returns 'right' for halign=2 (Right)", () => {
    expect(getTextHAlign(2)).toBe("right");
  });
});

// ── getMTextVAlign ───────────────────────────────────────────────────────

describe("getMTextVAlign", () => {
  it("returns 'top' when attachmentPoint is undefined", () => {
    expect(getMTextVAlign(undefined)).toBe("top");
  });

  it("returns 'top' when attachmentPoint is 0", () => {
    expect(getMTextVAlign(0)).toBe("top");
  });

  it("returns 'top' for attachment points 1, 2, 3", () => {
    expect(getMTextVAlign(1)).toBe("top");
    expect(getMTextVAlign(2)).toBe("top");
    expect(getMTextVAlign(3)).toBe("top");
  });

  it("returns 'middle' for attachment points 4, 5, 6", () => {
    expect(getMTextVAlign(4)).toBe("middle");
    expect(getMTextVAlign(5)).toBe("middle");
    expect(getMTextVAlign(6)).toBe("middle");
  });

  it("returns 'bottom' for attachment points 7, 8, 9", () => {
    expect(getMTextVAlign(7)).toBe("bottom");
    expect(getMTextVAlign(8)).toBe("bottom");
    expect(getMTextVAlign(9)).toBe("bottom");
  });
});

// ── getTextVAlign ────────────────────────────────────────────────────────

describe("getTextVAlign", () => {
  it("returns 'bottom' when valign is undefined (Baseline)", () => {
    expect(getTextVAlign(undefined)).toBe("bottom");
  });

  it("returns 'bottom' for valign=0 (Baseline) and valign=1 (Bottom)", () => {
    expect(getTextVAlign(0)).toBe("bottom");
    expect(getTextVAlign(1)).toBe("bottom");
  });

  it("returns 'middle' for valign=2", () => {
    expect(getTextVAlign(2)).toBe("middle");
  });

  it("returns 'top' for valign=3", () => {
    expect(getTextVAlign(3)).toBe("top");
  });
});
