import { describe, it, expect, beforeEach } from "vitest";
import { getTriangulatedGlyph, clearGlyphCache } from "../glyphCache";
import { loadDefaultFont } from "../fontManager";
import type { Font } from "opentype.js";

let font: Font;

beforeEach(() => {
  clearGlyphCache();
  font = loadDefaultFont();
});

describe("glyphCache", () => {
  describe("getTriangulatedGlyph", () => {
    it("triangulates a simple glyph (L — no holes)", () => {
      const data = getTriangulatedGlyph(font, "L");
      expect(data).not.toBeNull();
      expect(data!.positions.length).toBeGreaterThan(0);
      expect(data!.indices.length).toBeGreaterThan(0);
      // positions should be triplets (x, y, z)
      expect(data!.positions.length % 3).toBe(0);
      // indices should be triplets (triangles)
      expect(data!.indices.length % 3).toBe(0);
    });

    it("triangulates a glyph with holes (O)", () => {
      const data = getTriangulatedGlyph(font, "O");
      expect(data).not.toBeNull();
      expect(data!.positions.length).toBeGreaterThan(0);
      expect(data!.indices.length).toBeGreaterThan(0);
      // O has more geometry than L due to the hole
      const dataL = getTriangulatedGlyph(font, "L");
      expect(data!.positions.length).toBeGreaterThan(dataL!.positions.length);
    });

    it("triangulates a glyph with multiple holes (B)", () => {
      const data = getTriangulatedGlyph(font, "B");
      expect(data).not.toBeNull();
      expect(data!.positions.length).toBeGreaterThan(0);
      expect(data!.indices.length).toBeGreaterThan(0);
    });

    it("triangulates digit 8 (two holes)", () => {
      const data = getTriangulatedGlyph(font, "8");
      expect(data).not.toBeNull();
      expect(data!.positions.length).toBeGreaterThan(0);
      expect(data!.indices.length).toBeGreaterThan(0);
    });

    it("returns empty geometry for space (advance only)", () => {
      const data = getTriangulatedGlyph(font, " ");
      expect(data).not.toBeNull();
      expect(data!.positions.length).toBe(0);
      expect(data!.indices.length).toBe(0);
      expect(data!.advance).toBeGreaterThan(0);
    });

    it("has valid advance width", () => {
      const data = getTriangulatedGlyph(font, "A");
      expect(data).not.toBeNull();
      expect(data!.advance).toBeGreaterThan(0);
    });

    it("has valid bounds", () => {
      const data = getTriangulatedGlyph(font, "A");
      expect(data).not.toBeNull();
      expect(data!.bounds.xMin).toBeLessThan(data!.bounds.xMax);
      expect(data!.bounds.yMin).toBeLessThan(data!.bounds.yMax);
    });

    it("returns fallback glyph for missing characters", () => {
      // CJK character unlikely in Noto Sans Light (Latin/Cyrillic only)
      const data = getTriangulatedGlyph(font, "\u4E00"); // 一 (CJK)
      // Should return fallback glyph or null, not crash
      if (font.charToGlyphIndex("\u4E00") === 0) {
        // If missing, should get fallback (? or U+FFFD)
        if (data) {
          expect(data.advance).toBeGreaterThan(0);
        }
      }
    });

    it("returns custom glyph for U+2300 (⌀ diameter sign)", () => {
      // U+2300 DIAMETER SIGN is not in Liberation Sans
      expect(font.charToGlyphIndex("\u2300")).toBe(0);
      const data = getTriangulatedGlyph(font, "\u2300");
      expect(data).not.toBeNull();
      expect(data!.positions.length).toBeGreaterThan(0);
      expect(data!.indices.length).toBeGreaterThan(0);
      expect(data!.advance).toBeGreaterThan(0);
    });

    it("caches custom glyph — same object on second call", () => {
      const data1 = getTriangulatedGlyph(font, "\u2300");
      const data2 = getTriangulatedGlyph(font, "\u2300");
      expect(data1).toBe(data2);
    });

    it("caches results — same object on second call", () => {
      const data1 = getTriangulatedGlyph(font, "A");
      const data2 = getTriangulatedGlyph(font, "A");
      expect(data1).toBe(data2);
    });

    it("returns different data for different characters", () => {
      const dataA = getTriangulatedGlyph(font, "A");
      const dataI = getTriangulatedGlyph(font, "i");
      expect(dataA).not.toBe(dataI);
      expect(dataA!.advance).not.toBe(dataI!.advance);
    });

    it("triangulates Cyrillic character (Д)", () => {
      const data = getTriangulatedGlyph(font, "Д");
      expect(data).not.toBeNull();
      expect(data!.positions.length).toBeGreaterThan(0);
      expect(data!.indices.length).toBeGreaterThan(0);
    });

    it("all z-coordinates are 0 (2D text)", () => {
      const data = getTriangulatedGlyph(font, "A");
      expect(data).not.toBeNull();
      for (let i = 2; i < data!.positions.length; i += 3) {
        expect(data!.positions[i]).toBe(0);
      }
    });

    it("all indices are within vertex count range", () => {
      const data = getTriangulatedGlyph(font, "O");
      expect(data).not.toBeNull();
      const vertexCount = data!.positions.length / 3;
      for (const idx of data!.indices) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(vertexCount);
      }
    });
  });

  describe("clearGlyphCache", () => {
    it("clears cache — next call creates new object", () => {
      const data1 = getTriangulatedGlyph(font, "A");
      clearGlyphCache();
      const data2 = getTriangulatedGlyph(font, "A");
      expect(data1).not.toBe(data2);
      // But content should be equivalent
      expect(data1!.positions).toEqual(data2!.positions);
      expect(data1!.indices).toEqual(data2!.indices);
    });
  });
});
