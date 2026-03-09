import { describe, it, expect } from "vitest";
import { loadDefaultFont, getDefaultFont } from "../fontManager";

describe("fontManager", () => {
  describe("loadDefaultFont", () => {
    it("returns an opentype.js Font object", () => {
      const font = loadDefaultFont();
      expect(font).toBeDefined();
      expect(font.unitsPerEm).toBe(2048);
    });

    it("has Liberation Sans font family", () => {
      const font = loadDefaultFont();
      expect(font.names.fontFamily.en).toBe("Liberation Sans");
    });

    it("has valid ascender and descender", () => {
      const font = loadDefaultFont();
      expect(font.ascender).toBeGreaterThan(0);
      expect(font.descender).toBeLessThan(0);
    });

    it("contains Latin glyphs", () => {
      const font = loadDefaultFont();
      expect(font.charToGlyphIndex("A")).toBeGreaterThan(0);
      expect(font.charToGlyphIndex("z")).toBeGreaterThan(0);
      expect(font.charToGlyphIndex("0")).toBeGreaterThan(0);
    });

    it("contains Cyrillic glyphs", () => {
      const font = loadDefaultFont();
      expect(font.charToGlyphIndex("А")).toBeGreaterThan(0);
      expect(font.charToGlyphIndex("Я")).toBeGreaterThan(0);
      expect(font.charToGlyphIndex("ё")).toBeGreaterThan(0);
    });

    it("contains Greek glyphs", () => {
      const font = loadDefaultFont();
      expect(font.charToGlyphIndex("Ω")).toBeGreaterThan(0);
      expect(font.charToGlyphIndex("α")).toBeGreaterThan(0);
    });

    it("contains special DXF characters (degree, plus-minus, diameter)", () => {
      const font = loadDefaultFont();
      expect(font.charToGlyphIndex("°")).toBeGreaterThan(0); // degree
      expect(font.charToGlyphIndex("±")).toBeGreaterThan(0); // plus-minus
      expect(font.charToGlyphIndex("\u00D8")).toBeGreaterThan(0); // Ø diameter
    });

    it("returns the same instance on subsequent calls (caching)", () => {
      const font1 = loadDefaultFont();
      const font2 = loadDefaultFont();
      expect(font1).toBe(font2);
    });

    it("has sCapHeight overridden to match Arial (1467)", () => {
      const font = loadDefaultFont();
      const os2 = (font as { tables?: { os2?: { sCapHeight?: number } } }).tables?.os2;
      expect(os2?.sCapHeight).toBe(1467);
    });
  });

  describe("getDefaultFont", () => {
    it("returns the font after loadDefaultFont was called", () => {
      loadDefaultFont();
      const font = getDefaultFont();
      expect(font).not.toBeNull();
      expect(font!.unitsPerEm).toBe(2048);
    });
  });
});
