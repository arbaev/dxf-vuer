import { describe, it, expect } from "vitest";
import { getCustomGlyph, hasCustomGlyph } from "../customGlyphs";

describe("customGlyphs", () => {
  describe("registry", () => {
    it.each([
      ["\u2300", "⌀ DIAMETER SIGN"],
      ["\u2205", "∅ EMPTY SET"],
      ["\u2248", "≈ APPROXIMATELY EQUAL"],
      ["\u2260", "≠ NOT EQUAL TO"],
      ["\u2261", "≡ IDENTICAL TO"],
    ])("has custom glyph for %s (%s)", (char) => {
      expect(hasCustomGlyph(char)).toBe(true);
      const gd = getCustomGlyph(char);
      expect(gd).not.toBeNull();
      expect(gd!.positions.length).toBeGreaterThan(0);
      expect(gd!.indices.length).toBeGreaterThan(0);
      expect(gd!.advance).toBeGreaterThan(0);
    });

    it("returns null for unregistered characters", () => {
      expect(getCustomGlyph("A")).toBeNull();
      expect(hasCustomGlyph("A")).toBe(false);
    });
  });

  describe("diameter glyph (U+2300)", () => {
    const glyph = getCustomGlyph("\u2300")!;

    it("returns non-null GlyphData", () => {
      expect(glyph).not.toBeNull();
    });

    it("has valid positions (triplets of x, y, z)", () => {
      expect(glyph.positions.length).toBeGreaterThan(0);
      expect(glyph.positions.length % 3).toBe(0);
    });

    it("has valid indices (triplets for triangles)", () => {
      expect(glyph.indices.length).toBeGreaterThan(0);
      expect(glyph.indices.length % 3).toBe(0);
    });

    it("all indices are within vertex count range", () => {
      const vertexCount = glyph.positions.length / 3;
      for (const idx of glyph.indices) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(vertexCount);
      }
    });

    it("all z-coordinates are 0 (2D glyph)", () => {
      for (let i = 2; i < glyph.positions.length; i += 3) {
        expect(glyph.positions[i]).toBe(0);
      }
    });

    it("has positive advance width", () => {
      expect(glyph.advance).toBeGreaterThan(0);
      // Should be approximately 0.73 (like font's 'O')
      expect(glyph.advance).toBeCloseTo(0.73, 1);
    });

    it("has valid bounds within normalized range", () => {
      expect(glyph.bounds.xMin).toBeLessThan(glyph.bounds.xMax);
      expect(glyph.bounds.yMin).toBeLessThan(glyph.bounds.yMax);
      // Glyph should be within [0, advance] x [0, ~0.7] roughly
      expect(glyph.bounds.xMin).toBeGreaterThanOrEqual(-0.1);
      expect(glyph.bounds.xMax).toBeLessThanOrEqual(0.85);
      expect(glyph.bounds.yMin).toBeGreaterThanOrEqual(-0.1);
      expect(glyph.bounds.yMax).toBeLessThanOrEqual(0.85);
    });
  });

  describe("U+2205 (∅) is same shape as U+2300 (⌀)", () => {
    it("produces identical advance width", () => {
      const d1 = getCustomGlyph("\u2300")!;
      const d2 = getCustomGlyph("\u2205")!;
      expect(d1.advance).toBe(d2.advance);
    });

    it("produces same number of vertices and indices", () => {
      const d1 = getCustomGlyph("\u2300")!;
      const d2 = getCustomGlyph("\u2205")!;
      expect(d1.positions.length).toBe(d2.positions.length);
      expect(d1.indices.length).toBe(d2.indices.length);
    });
  });

  describe("math relation glyphs share advance width", () => {
    it("≈, ≠, ≡ all have same advance as font's '=' (~0.571)", () => {
      const approx = getCustomGlyph("\u2248")!;
      const notEq = getCustomGlyph("\u2260")!;
      const ident = getCustomGlyph("\u2261")!;
      expect(approx.advance).toBeCloseTo(0.571, 2);
      expect(notEq.advance).toBeCloseTo(0.571, 2);
      expect(ident.advance).toBeCloseTo(0.571, 2);
    });
  });

  describe("geometry validity for all custom glyphs", () => {
    const allChars = ["\u2300", "\u2205", "\u2248", "\u2260", "\u2261"];

    it.each(allChars)("glyph %s has valid indices within vertex range", (char) => {
      const gd = getCustomGlyph(char)!;
      const vertexCount = gd.positions.length / 3;
      for (const idx of gd.indices) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(vertexCount);
      }
    });

    it.each(allChars)("glyph %s has all z-coordinates at 0", (char) => {
      const gd = getCustomGlyph(char)!;
      for (let i = 2; i < gd.positions.length; i += 3) {
        expect(gd.positions[i]).toBe(0);
      }
    });

    it.each(allChars)("glyph %s has valid bounds (xMin < xMax, yMin < yMax)", (char) => {
      const gd = getCustomGlyph(char)!;
      expect(gd.bounds.xMin).toBeLessThan(gd.bounds.xMax);
      expect(gd.bounds.yMin).toBeLessThan(gd.bounds.yMax);
    });
  });
});
