import { describe, it, expect, beforeAll } from "vitest";
import {
  addTextToCollector,
  addMTextToCollector,
  addDimensionTextToCollector,
  measureTextWidth,
  measureDimensionTextWidth,
  HAlign,
  VAlign,
} from "../vectorTextBuilder";
import type { MTextLine } from "../text";
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

  describe("addMTextToCollector — basic", () => {
    it("produces mesh data for multiline text", () => {
      const c = new MockCollector();
      const lines: MTextLine[] = [
        { text: "Line one" },
        { text: "Line two" },
      ];
      addMTextToCollector(c as any, "0", "#fff", font, lines, 10, 0, 0, 0);
      expect(c.meshCalls.length).toBe(2);
      expect(c.totalVertices).toBeGreaterThan(0);
    });

    it("produces nothing for empty lines array", () => {
      const c = new MockCollector();
      addMTextToCollector(c as any, "0", "#fff", font, [], 10, 0, 0, 0);
      expect(c.meshCalls.length).toBe(0);
    });

    it("single line works like addTextToCollector", () => {
      const c = new MockCollector();
      const lines: MTextLine[] = [{ text: "Hello" }];
      addMTextToCollector(c as any, "0", "#fff", font, lines, 10, 0, 0, 0);
      expect(c.meshCalls.length).toBe(1);
      expect(c.totalVertices).toBeGreaterThan(0);
    });

    it("all z-coordinates match posZ", () => {
      const c = new MockCollector();
      const lines: MTextLine[] = [{ text: "A" }, { text: "B" }];
      addMTextToCollector(c as any, "0", "#fff", font, lines, 10, 0, 0, 7);
      for (const call of c.meshCalls) {
        for (let i = 2; i < call.vertices.length; i += 3) {
          expect(call.vertices[i]).toBe(7);
        }
      }
    });

    it("produces nothing for zero height", () => {
      const c = new MockCollector();
      const lines: MTextLine[] = [{ text: "Hello" }];
      addMTextToCollector(c as any, "0", "#fff", font, lines, 0, 0, 0, 0);
      expect(c.meshCalls.length).toBe(0);
    });
  });

  describe("addMTextToCollector — attachment points", () => {
    it("TOP_LEFT (1): text extends below and right of position", () => {
      const c = new MockCollector();
      const lines: MTextLine[] = [{ text: "AB" }, { text: "CD" }];
      addMTextToCollector(c as any, "0", "#fff", font, lines, 10, 50, 50, 0, 0, 1);
      const b = c.getBounds();
      // TOP_LEFT: text starts at position and goes right and down
      expect(b.xMin).toBeGreaterThanOrEqual(48);
      expect(b.yMax).toBeLessThanOrEqual(52); // top near position
    });

    it("BOTTOM_RIGHT (9): text extends above and left of position", () => {
      const c = new MockCollector();
      const lines: MTextLine[] = [{ text: "AB" }, { text: "CD" }];
      addMTextToCollector(c as any, "0", "#fff", font, lines, 10, 50, 50, 0, 0, 9);
      const b = c.getBounds();
      // BOTTOM_RIGHT: text extends above and to the left
      expect(b.xMax).toBeLessThanOrEqual(52);
      expect(b.yMin).toBeGreaterThanOrEqual(44); // bottom near position (ascender-based)
    });

    it("MIDDLE_CENTER (5): text is centered around position", () => {
      const c = new MockCollector();
      const lines: MTextLine[] = [{ text: "AB" }, { text: "CD" }];
      addMTextToCollector(c as any, "0", "#fff", font, lines, 10, 50, 50, 0, 0, 5);
      const b = c.getBounds();
      const midX = (b.xMin + b.xMax) / 2;
      const midY = (b.yMin + b.yMax) / 2;
      // Center should be near (50, 50)
      expect(Math.abs(midX - 50)).toBeLessThan(5);
      expect(Math.abs(midY - 50)).toBeLessThan(8);
    });
  });

  describe("addMTextToCollector — per-line color", () => {
    it("lines with different colors produce separate addMesh calls", () => {
      const c = new MockCollector();
      const lines: MTextLine[] = [
        { text: "Red line", color: "#ff0000" },
        { text: "Blue line", color: "#0000ff" },
      ];
      addMTextToCollector(c as any, "0", "#fff", font, lines, 10, 0, 0, 0);
      // Each line has different color → separate calls
      const colors = c.meshCalls.map(call => call.color);
      expect(colors).toContain("#ff0000");
      expect(colors).toContain("#0000ff");
    });

    it("lines without color use default entity color", () => {
      const c = new MockCollector();
      const lines: MTextLine[] = [{ text: "Default" }];
      addMTextToCollector(c as any, "0", "#abcdef", font, lines, 10, 0, 0, 0);
      expect(c.meshCalls[0].color).toBe("#abcdef");
    });
  });

  describe("addMTextToCollector — per-line height", () => {
    it("different line heights render at different sizes", () => {
      const cSmall = new MockCollector();
      const cLarge = new MockCollector();
      const smallLines: MTextLine[] = [{ text: "A", height: 5 }];
      const largeLines: MTextLine[] = [{ text: "A", height: 20 }];
      addMTextToCollector(cSmall as any, "0", "#fff", font, smallLines, 10, 0, 0, 0);
      addMTextToCollector(cLarge as any, "0", "#fff", font, largeLines, 10, 0, 0, 0);
      const hSmall = cSmall.getBounds().yMax - cSmall.getBounds().yMin;
      const hLarge = cLarge.getBounds().yMax - cLarge.getBounds().yMin;
      expect(hLarge).toBeGreaterThan(hSmall * 2);
    });
  });

  describe("addMTextToCollector — word wrapping", () => {
    it("long text with width constraint produces multiple lines", () => {
      const c = new MockCollector();
      // "Hello World Test" with narrow width should wrap
      const lines: MTextLine[] = [{ text: "Hello World Test" }];
      // Measure width of "Hello" to set a narrow constraint
      const helloWidth = measureTextWidth(font, "Hello World", 10);
      addMTextToCollector(c as any, "0", "#fff", font, lines, 10, 0, 0, 0, 0, 1, helloWidth * 0.8);
      // Should have more than 1 addMesh call (wrapped into multiple lines)
      expect(c.meshCalls.length).toBeGreaterThan(1);
    });

    it("short text stays single line when width is large enough", () => {
      const c = new MockCollector();
      const lines: MTextLine[] = [{ text: "Hi" }];
      addMTextToCollector(c as any, "0", "#fff", font, lines, 10, 0, 0, 0, 0, 1, 1000);
      expect(c.meshCalls.length).toBe(1);
    });

    it("width=0 or undefined skips wrapping", () => {
      const c1 = new MockCollector();
      const c2 = new MockCollector();
      const lines: MTextLine[] = [{ text: "Hello World Test" }];
      addMTextToCollector(c1 as any, "0", "#fff", font, lines, 10, 0, 0, 0, 0, 1, 0);
      addMTextToCollector(c2 as any, "0", "#fff", font, lines, 10, 0, 0, 0, 0, 1, undefined);
      // No wrapping → single addMesh call each
      expect(c1.meshCalls.length).toBe(1);
      expect(c2.meshCalls.length).toBe(1);
    });
  });

  describe("addMTextToCollector — stacked text", () => {
    it("line with stackedTop/stackedBottom renders extra geometry", () => {
      const c = new MockCollector();
      const lines: MTextLine[] = [{
        text: "Main",
        stackedTop: "1",
        stackedBottom: "2",
      }];
      addMTextToCollector(c as any, "0", "#fff", font, lines, 10, 0, 0, 0);
      // Should have calls for main text + top fraction + bottom fraction
      expect(c.meshCalls.length).toBeGreaterThanOrEqual(3);
      expect(c.totalVertices).toBeGreaterThan(0);
    });

    it("stacked text without main text still renders fractions", () => {
      const c = new MockCollector();
      const lines: MTextLine[] = [{
        text: "",
        stackedTop: "1",
        stackedBottom: "2",
      }];
      addMTextToCollector(c as any, "0", "#fff", font, lines, 10, 0, 0, 0);
      // Top + bottom fractions
      expect(c.meshCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("addMTextToCollector — rotation", () => {
    it("90° rotation changes text direction", () => {
      const c0 = new MockCollector();
      const c90 = new MockCollector();
      const lines: MTextLine[] = [{ text: "ABC" }];
      addMTextToCollector(c0 as any, "0", "#fff", font, lines, 10, 0, 0, 0, 0);
      addMTextToCollector(c90 as any, "0", "#fff", font, lines, 10, 0, 0, 0, Math.PI / 2);
      const b0 = c0.getBounds();
      const b90 = c90.getBounds();
      // Unrotated: wider than tall
      const w0 = b0.xMax - b0.xMin;
      const h0 = b0.yMax - b0.yMin;
      expect(w0).toBeGreaterThan(h0);
      // Rotated 90°: taller than wide (text direction is vertical)
      const w90 = b90.xMax - b90.xMin;
      const h90 = b90.yMax - b90.yMin;
      expect(h90).toBeGreaterThan(w90);
    });

    it("multiline rotation positions lines perpendicular to text direction", () => {
      const c = new MockCollector();
      const lines: MTextLine[] = [{ text: "A" }, { text: "B" }];
      // 90° rotation: lines should spread horizontally (perpendicular to text direction)
      addMTextToCollector(c as any, "0", "#fff", font, lines, 10, 0, 0, 0, Math.PI / 2, 1);
      const b = c.getBounds();
      // With 90° rotation, line stacking goes in -X direction instead of -Y
      const w = b.xMax - b.xMin;
      expect(w).toBeGreaterThan(5); // lines spread horizontally
    });
  });

  describe("addDimensionTextToCollector — plain text", () => {
    it("produces mesh data for dimension value", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(c as any, "0", "#fff", font, "25.40", 10, 0, 0, 0);
      expect(c.meshCalls.length).toBe(1);
      expect(c.totalVertices).toBeGreaterThan(0);
      expect(c.totalTriangles).toBeGreaterThan(0);
    });

    it("produces nothing for empty text", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(c as any, "0", "#fff", font, "", 10, 0, 0, 0);
      expect(c.meshCalls.length).toBe(0);
    });

    it("produces nothing for whitespace-only text", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(c as any, "0", "#fff", font, "   ", 10, 0, 0, 0);
      expect(c.meshCalls.length).toBe(0);
    });

    it("produces nothing for zero height", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(c as any, "0", "#fff", font, "25.40", 0, 0, 0, 0);
      expect(c.meshCalls.length).toBe(0);
    });

    it("strips MTEXT formatting codes", () => {
      const c1 = new MockCollector();
      const c2 = new MockCollector();
      addDimensionTextToCollector(c1 as any, "0", "#fff", font, "\\fArial;25.40", 10, 0, 0, 0);
      addDimensionTextToCollector(c2 as any, "0", "#fff", font, "25.40", 10, 0, 0, 0);
      // Both should produce the same geometry (formatting stripped)
      expect(c1.totalVertices).toBe(c2.totalVertices);
    });
  });

  describe("addDimensionTextToCollector — stacked text", () => {
    it("renders stacked fractions as multiple mesh calls", () => {
      const c = new MockCollector();
      // \S with caret separator: top=5.2, bottom=5.3 (tolerance format)
      addDimensionTextToCollector(c as any, "0", "#fff", font, "\\S5.2^5.3;", 10, 0, 0, 0);
      // Top + bottom fractions (no main text prefix)
      expect(c.meshCalls.length).toBeGreaterThanOrEqual(2);
      expect(c.totalVertices).toBeGreaterThan(0);
    });

    it("renders prefix + stacked fractions", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(c as any, "0", "#fff", font, "Prefix \\S1^2;", 10, 0, 0, 0);
      // Main text + top fraction + bottom fraction
      expect(c.meshCalls.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("addDimensionTextToCollector — alignment", () => {
    it("center: text centered around position", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(c as any, "0", "#fff", font, "25.40", 10, 50, 0, 0, 0, "center");
      const b = c.getBounds();
      const midX = (b.xMin + b.xMax) / 2;
      expect(Math.abs(midX - 50)).toBeLessThan(2);
    });

    it("left: text extends right of position", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(c as any, "0", "#fff", font, "25.40", 10, 50, 0, 0, 0, "left");
      const b = c.getBounds();
      expect(b.xMin).toBeGreaterThanOrEqual(49);
      expect(b.xMax).toBeGreaterThan(55);
    });

    it("right: text extends left of position", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(c as any, "0", "#fff", font, "25.40", 10, 50, 0, 0, 0, "right");
      const b = c.getBounds();
      expect(b.xMax).toBeLessThanOrEqual(51);
    });
  });

  describe("addDimensionTextToCollector — rotation", () => {
    it("90° rotation changes text direction", () => {
      const c0 = new MockCollector();
      const c90 = new MockCollector();
      addDimensionTextToCollector(c0 as any, "0", "#fff", font, "25.40", 10, 0, 0, 0, 0);
      addDimensionTextToCollector(c90 as any, "0", "#fff", font, "25.40", 10, 0, 0, 0, Math.PI / 2);
      const b0 = c0.getBounds();
      const b90 = c90.getBounds();
      // Unrotated: wider than tall
      expect(b0.xMax - b0.xMin).toBeGreaterThan(b0.yMax - b0.yMin);
      // Rotated 90°: taller than wide
      expect(b90.yMax - b90.yMin).toBeGreaterThan(b90.xMax - b90.xMin);
    });
  });

  describe("addDimensionTextToCollector — vertical centering", () => {
    it("text vertically centered on insertion point (VAlign.MIDDLE)", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(c as any, "0", "#fff", font, "25.40", 10, 0, 0, 0, 0, "center");
      const b = c.getBounds();
      // With VAlign.MIDDLE, text should be centered on posY=0
      const midY = (b.yMin + b.yMax) / 2;
      expect(Math.abs(midY)).toBeLessThan(1); // approximately centered
    });

    it("text centered on insertion point with rotation", () => {
      const c = new MockCollector();
      // 90° rotation: text should still be approximately centered on (50,50)
      addDimensionTextToCollector(c as any, "0", "#fff", font, "A", 10, 50, 50, 0, Math.PI / 2, "center");
      const b = c.getBounds();
      const midX = (b.xMin + b.xMax) / 2;
      const midY = (b.yMin + b.yMax) / 2;
      // With rotation, center should still be near insertion point
      expect(Math.abs(midX - 50)).toBeLessThan(5);
      expect(Math.abs(midY - 50)).toBeLessThan(5);
    });
  });

  describe("addDimensionTextToCollector — z coordinate", () => {
    it("all vertices have correct posZ", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(c as any, "0", "#fff", font, "25.40", 10, 0, 0, 3.5);
      for (const call of c.meshCalls) {
        for (let i = 2; i < call.vertices.length; i += 3) {
          expect(call.vertices[i]).toBe(3.5);
        }
      }
    });
  });

  describe("measureDimensionTextWidth", () => {
    it("returns positive width for plain text", () => {
      const w = measureDimensionTextWidth(font, "25.40", 10);
      expect(w).toBeGreaterThan(0);
    });

    it("stacked text is wider than just the prefix", () => {
      const wPrefix = measureDimensionTextWidth(font, "Value", 10);
      const wStacked = measureDimensionTextWidth(font, "Value \\S1^2;", 10);
      expect(wStacked).toBeGreaterThan(wPrefix);
    });

    it("doubling height doubles width", () => {
      const w1 = measureDimensionTextWidth(font, "25.40", 10);
      const w2 = measureDimensionTextWidth(font, "25.40", 20);
      expect(w2).toBeCloseTo(w1 * 2, 1);
    });

    it("formatting codes are stripped before measuring", () => {
      const w1 = measureDimensionTextWidth(font, "\\fArial;25.40", 10);
      const w2 = measureDimensionTextWidth(font, "25.40", 10);
      expect(w1).toBeCloseTo(w2, 5);
    });

    it("returns 0 for empty text", () => {
      const w = measureDimensionTextWidth(font, "", 10);
      expect(w).toBe(0);
    });
  });

  // ── Transform (block INSERT worldMatrix) ────────────────────────────

  describe("transform parameter (block INSERT)", () => {
    it("addTextToCollector applies transform to vertex positions", () => {
      const c1 = new MockCollector();
      addTextToCollector(c1 as any, "0", "#000", font, "A", 10, 0, 0, 0);

      // Identity matrix — should produce same positions
      // prettier-ignore
      const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
      const c2 = new MockCollector();
      addTextToCollector(c2 as any, "0", "#000", font, "A", 10, 0, 0, 0, 0, HAlign.LEFT, VAlign.BASELINE, 1, undefined, undefined, identity);
      expect(c2.meshCalls.length).toBe(1);
      expect(c2.meshCalls[0].vertices.length).toBe(c1.meshCalls[0].vertices.length);
      // Verify positions match with identity
      for (let i = 0; i < c1.meshCalls[0].vertices.length; i++) {
        expect(c2.meshCalls[0].vertices[i]).toBeCloseTo(c1.meshCalls[0].vertices[i], 5);
      }
    });

    it("addTextToCollector translates vertices by transform", () => {
      // Translation matrix: move (+100, +200, 0)
      // prettier-ignore
      const translate = [1,0,0,0, 0,1,0,0, 0,0,1,0, 100,200,0,1];

      const cOrig = new MockCollector();
      addTextToCollector(cOrig as any, "0", "#000", font, "A", 10, 5, 5, 0);

      const cTransformed = new MockCollector();
      addTextToCollector(cTransformed as any, "0", "#000", font, "A", 10, 5, 5, 0, 0, HAlign.LEFT, VAlign.BASELINE, 1, undefined, undefined, translate);

      expect(cTransformed.meshCalls.length).toBe(1);
      const vOrig = cOrig.meshCalls[0].vertices;
      const vT = cTransformed.meshCalls[0].vertices;
      // Every X should be shifted by +100, every Y by +200
      for (let i = 0; i < vOrig.length; i += 3) {
        expect(vT[i]).toBeCloseTo(vOrig[i] + 100, 5);
        expect(vT[i + 1]).toBeCloseTo(vOrig[i + 1] + 200, 5);
        expect(vT[i + 2]).toBeCloseTo(vOrig[i + 2], 5);
      }
    });

    it("addDimensionTextToCollector passes transform through", () => {
      // Translation matrix: move (+500, +300, 0)
      // prettier-ignore
      const translate = [1,0,0,0, 0,1,0,0, 0,0,1,0, 500,300,0,1];

      const cOrig = new MockCollector();
      addDimensionTextToCollector(cOrig as any, "0", "#000", font, "10", 5, 10, 10, 0);

      const cT = new MockCollector();
      addDimensionTextToCollector(cT as any, "0", "#000", font, "10", 5, 10, 10, 0, 0, "center", translate);

      expect(cT.meshCalls.length).toBe(1);
      const vOrig = cOrig.meshCalls[0].vertices;
      const vT = cT.meshCalls[0].vertices;
      for (let i = 0; i < vOrig.length; i += 3) {
        expect(vT[i]).toBeCloseTo(vOrig[i] + 500, 5);
        expect(vT[i + 1]).toBeCloseTo(vOrig[i + 1] + 300, 5);
      }
    });
  });
});
