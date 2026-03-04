import { describe, it, expect, beforeAll } from "vitest";
import {
  addTextToCollector,
  measureTextWidth,
  HAlign,
  VAlign,
} from "../vectorTextBuilder";
import { loadDefaultFont } from "../fontManager";
import { clearGlyphCache } from "../glyphCache";
import type { Font } from "opentype.js";

let font: Font;

/** Minimal mock of GeometryCollector — captures addMesh calls */
class MockCollector {
  meshCalls: { layer: string; color: string; vertices: number[]; indices: number[] }[] = [];

  addMesh(layer: string, color: string, vertices: number[], indices: number[]): void {
    if (vertices.length < 9 || indices.length < 3) return;
    this.meshCalls.push({ layer, color, vertices: [...vertices], indices: [...indices] });
  }

  get totalVertices(): number {
    return this.meshCalls.reduce((sum, c) => sum + c.vertices.length / 3, 0);
  }

  get totalTriangles(): number {
    return this.meshCalls.reduce((sum, c) => sum + c.indices.length / 3, 0);
  }

  /** Get all X,Y positions from first call as [x,y] pairs */
  getPositions2D(callIndex = 0): [number, number][] {
    const v = this.meshCalls[callIndex]?.vertices ?? [];
    const pts: [number, number][] = [];
    for (let i = 0; i < v.length; i += 3) {
      pts.push([v[i], v[i + 1]]);
    }
    return pts;
  }

  /** Bounding box of all mesh vertices */
  getBounds(): { xMin: number; xMax: number; yMin: number; yMax: number } {
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const call of this.meshCalls) {
      for (let i = 0; i < call.vertices.length; i += 3) {
        const x = call.vertices[i], y = call.vertices[i + 1];
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
    return { xMin, xMax, yMin, yMax };
  }
}

beforeAll(() => {
  clearGlyphCache();
  font = loadDefaultFont();
});

describe("vectorTextBuilder", () => {
  describe("addTextToCollector — basic", () => {
    it("produces mesh data for simple text", () => {
      const c = new MockCollector();
      addTextToCollector(c as any, "0", "#ffffff", font, "Hello", 10, 0, 0, 0);
      expect(c.meshCalls.length).toBe(1);
      expect(c.totalVertices).toBeGreaterThan(0);
      expect(c.totalTriangles).toBeGreaterThan(0);
    });

    it("produces nothing for empty string", () => {
      const c = new MockCollector();
      addTextToCollector(c as any, "0", "#ffffff", font, "", 10, 0, 0, 0);
      expect(c.meshCalls.length).toBe(0);
    });

    it("produces nothing for zero height", () => {
      const c = new MockCollector();
      addTextToCollector(c as any, "0", "#ffffff", font, "Test", 0, 0, 0, 0);
      expect(c.meshCalls.length).toBe(0);
    });

    it("uses correct layer and color keys", () => {
      const c = new MockCollector();
      addTextToCollector(c as any, "Layer1", "#ff0000", font, "A", 10, 0, 0, 0);
      expect(c.meshCalls[0].layer).toBe("Layer1");
      expect(c.meshCalls[0].color).toBe("#ff0000");
    });

    it("handles space-only text (no geometry, just advance)", () => {
      const c = new MockCollector();
      addTextToCollector(c as any, "0", "#fff", font, "   ", 10, 0, 0, 0);
      expect(c.meshCalls.length).toBe(0);
    });

    it("all z-coordinates match posZ", () => {
      const c = new MockCollector();
      addTextToCollector(c as any, "0", "#fff", font, "AB", 10, 0, 0, 5);
      for (const call of c.meshCalls) {
        for (let i = 2; i < call.vertices.length; i += 3) {
          expect(call.vertices[i]).toBe(5);
        }
      }
    });

    it("all indices are within vertex count range", () => {
      const c = new MockCollector();
      addTextToCollector(c as any, "0", "#fff", font, "Test", 10, 0, 0, 0);
      for (const call of c.meshCalls) {
        const vertexCount = call.vertices.length / 3;
        for (const idx of call.indices) {
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThan(vertexCount);
        }
      }
    });
  });

  describe("addTextToCollector — position", () => {
    it("text is placed at specified position", () => {
      const c = new MockCollector();
      addTextToCollector(c as any, "0", "#fff", font, "A", 10, 100, 200, 0);
      const b = c.getBounds();
      // Text should be near (100, 200)
      expect(b.xMin).toBeGreaterThanOrEqual(95);
      expect(b.xMax).toBeLessThan(120);
      expect(b.yMin).toBeGreaterThanOrEqual(195);
      expect(b.yMax).toBeLessThan(215);
    });
  });

  describe("addTextToCollector — horizontal alignment", () => {
    it("LEFT: text extends to the right of position", () => {
      const c = new MockCollector();
      addTextToCollector(c as any, "0", "#fff", font, "ABC", 10, 50, 0, 0, 0, HAlign.LEFT, VAlign.BASELINE);
      const b = c.getBounds();
      expect(b.xMin).toBeGreaterThanOrEqual(49);
      expect(b.xMax).toBeGreaterThan(55);
    });

    it("CENTER: text is centered around position", () => {
      const c = new MockCollector();
      addTextToCollector(c as any, "0", "#fff", font, "ABC", 10, 50, 0, 0, 0, HAlign.CENTER, VAlign.BASELINE);
      const b = c.getBounds();
      // Midpoint should be near x=50
      const midX = (b.xMin + b.xMax) / 2;
      expect(Math.abs(midX - 50)).toBeLessThan(2);
    });

    it("RIGHT: text extends to the left of position", () => {
      const c = new MockCollector();
      addTextToCollector(c as any, "0", "#fff", font, "ABC", 10, 50, 0, 0, 0, HAlign.RIGHT, VAlign.BASELINE);
      const b = c.getBounds();
      expect(b.xMax).toBeLessThanOrEqual(51);
      expect(b.xMin).toBeLessThan(50);
    });
  });

  describe("addTextToCollector — vertical alignment", () => {
    it("BASELINE: some glyphs extend above and below y", () => {
      const c = new MockCollector();
      addTextToCollector(c as any, "0", "#fff", font, "Ag", 10, 0, 50, 0, 0, HAlign.LEFT, VAlign.BASELINE);
      const b = c.getBounds();
      // 'A' ascends above baseline, 'g' descends below
      expect(b.yMax).toBeGreaterThan(50);
      expect(b.yMin).toBeLessThan(50);
    });

    it("TOP: text extends below position", () => {
      const c = new MockCollector();
      addTextToCollector(c as any, "0", "#fff", font, "A", 10, 0, 50, 0, 0, HAlign.LEFT, VAlign.TOP);
      const b = c.getBounds();
      expect(b.yMax).toBeLessThanOrEqual(51);
    });

    it("BOTTOM: text extends above position", () => {
      const c = new MockCollector();
      addTextToCollector(c as any, "0", "#fff", font, "A", 10, 0, 50, 0, 0, HAlign.LEFT, VAlign.BOTTOM);
      const b = c.getBounds();
      expect(b.yMin).toBeGreaterThanOrEqual(49);
    });
  });

  describe("addTextToCollector — rotation", () => {
    it("90° rotation: text extends upward instead of rightward", () => {
      const c = new MockCollector();
      addTextToCollector(c as any, "0", "#fff", font, "ABC", 10, 0, 0, 0, Math.PI / 2, HAlign.LEFT, VAlign.BASELINE);
      const b = c.getBounds();
      // Rotated 90° CCW: width becomes vertical extent
      expect(b.yMax - b.yMin).toBeGreaterThan(15); // text width now vertical
    });

    it("0° and 360° produce same result", () => {
      const c1 = new MockCollector();
      const c2 = new MockCollector();
      addTextToCollector(c1 as any, "0", "#fff", font, "A", 10, 0, 0, 0, 0);
      addTextToCollector(c2 as any, "0", "#fff", font, "A", 10, 0, 0, 0, Math.PI * 2);
      const b1 = c1.getBounds();
      const b2 = c2.getBounds();
      expect(b1.xMin).toBeCloseTo(b2.xMin, 3);
      expect(b1.xMax).toBeCloseTo(b2.xMax, 3);
    });
  });

  describe("addTextToCollector — widthFactor", () => {
    it("widthFactor=2 doubles horizontal extent", () => {
      const c1 = new MockCollector();
      const c2 = new MockCollector();
      addTextToCollector(c1 as any, "0", "#fff", font, "A", 10, 0, 0, 0, 0, HAlign.LEFT, VAlign.BASELINE, 1);
      addTextToCollector(c2 as any, "0", "#fff", font, "A", 10, 0, 0, 0, 0, HAlign.LEFT, VAlign.BASELINE, 2);
      const w1 = c1.getBounds().xMax - c1.getBounds().xMin;
      const w2 = c2.getBounds().xMax - c2.getBounds().xMin;
      expect(w2).toBeCloseTo(w1 * 2, 1);
    });

    it("widthFactor does not affect vertical extent", () => {
      const c1 = new MockCollector();
      const c2 = new MockCollector();
      addTextToCollector(c1 as any, "0", "#fff", font, "A", 10, 0, 0, 0, 0, HAlign.LEFT, VAlign.BASELINE, 1);
      addTextToCollector(c2 as any, "0", "#fff", font, "A", 10, 0, 0, 0, 0, HAlign.LEFT, VAlign.BASELINE, 2);
      const h1 = c1.getBounds().yMax - c1.getBounds().yMin;
      const h2 = c2.getBounds().yMax - c2.getBounds().yMin;
      expect(h2).toBeCloseTo(h1, 1);
    });
  });

  describe("addTextToCollector — FIT/ALIGNED", () => {
    it("FIT: text fits between two points horizontally", () => {
      const c = new MockCollector();
      // Text "AB" fitted between x=10 and x=50
      addTextToCollector(c as any, "0", "#fff", font, "AB", 10, 10, 0, 0, 0, HAlign.FIT, VAlign.BASELINE, 1, 50, 0);
      const b = c.getBounds();
      // Text should span roughly from x=10 to x=50
      expect(b.xMin).toBeCloseTo(10, 0);
      expect(b.xMax).toBeCloseTo(50, 0);
    });

    it("FIT: does not change vertical size", () => {
      const cNormal = new MockCollector();
      const cFit = new MockCollector();
      addTextToCollector(cNormal as any, "0", "#fff", font, "AB", 10, 0, 0, 0, 0, HAlign.LEFT, VAlign.BASELINE);
      addTextToCollector(cFit as any, "0", "#fff", font, "AB", 10, 0, 0, 0, 0, HAlign.FIT, VAlign.BASELINE, 1, 100, 0);
      const hNormal = cNormal.getBounds().yMax - cNormal.getBounds().yMin;
      const hFit = cFit.getBounds().yMax - cFit.getBounds().yMin;
      expect(hFit).toBeCloseTo(hNormal, 1);
    });

    it("ALIGNED: text fits between two points with uniform scale", () => {
      const c = new MockCollector();
      addTextToCollector(c as any, "0", "#fff", font, "AB", 10, 10, 0, 0, 0, HAlign.ALIGNED, VAlign.BASELINE, 1, 50, 0);
      const b = c.getBounds();
      // Text should span roughly from x=10 to x=50
      expect(b.xMin).toBeCloseTo(10, 0);
      expect(b.xMax).toBeCloseTo(50, 0);
    });

    it("ALIGNED: vertical size scales proportionally", () => {
      const cNormal = new MockCollector();
      const cAligned = new MockCollector();
      addTextToCollector(cNormal as any, "0", "#fff", font, "AB", 10, 0, 0, 0, 0, HAlign.LEFT, VAlign.BASELINE);
      // Stretch to ~3x width → height should also ~3x
      addTextToCollector(cAligned as any, "0", "#fff", font, "AB", 10, 0, 0, 0, 0, HAlign.ALIGNED, VAlign.BASELINE, 1, 60, 0);
      const hNormal = cNormal.getBounds().yMax - cNormal.getBounds().yMin;
      const hAligned = cAligned.getBounds().yMax - cAligned.getBounds().yMin;
      expect(hAligned).toBeGreaterThan(hNormal * 1.5);
    });

    it("ALIGNED with angled endPos: text rotates to match", () => {
      const c = new MockCollector();
      // Endpoint at 45° angle
      addTextToCollector(c as any, "0", "#fff", font, "AB", 10, 0, 0, 0, 0, HAlign.ALIGNED, VAlign.BASELINE, 1, 50, 50);
      const b = c.getBounds();
      // Both X and Y should have significant extent (rotated ~45°)
      const w = b.xMax - b.xMin;
      const h = b.yMax - b.yMin;
      expect(w).toBeGreaterThan(10);
      expect(h).toBeGreaterThan(10);
    });
  });

  describe("addTextToCollector — Cyrillic text", () => {
    it("renders Cyrillic characters", () => {
      const c = new MockCollector();
      addTextToCollector(c as any, "0", "#fff", font, "Привет", 10, 0, 0, 0);
      expect(c.meshCalls.length).toBe(1);
      expect(c.totalVertices).toBeGreaterThan(0);
    });
  });

  describe("measureTextWidth", () => {
    it("returns positive width for non-empty text", () => {
      const w = measureTextWidth(font, "Hello", 10);
      expect(w).toBeGreaterThan(0);
    });

    it("longer text is wider", () => {
      const w1 = measureTextWidth(font, "A", 10);
      const w2 = measureTextWidth(font, "AAAA", 10);
      expect(w2).toBeGreaterThan(w1 * 3);
    });

    it("larger height makes wider text", () => {
      const w1 = measureTextWidth(font, "Hello", 10);
      const w2 = measureTextWidth(font, "Hello", 20);
      expect(w2).toBeCloseTo(w1 * 2, 1);
    });

    it("widthFactor scales the width", () => {
      const w1 = measureTextWidth(font, "Hello", 10, 1);
      const w2 = measureTextWidth(font, "Hello", 10, 2);
      expect(w2).toBeCloseTo(w1 * 2, 1);
    });

    it("returns 0 for empty string", () => {
      const w = measureTextWidth(font, "", 10);
      expect(w).toBe(0);
    });
  });
});
