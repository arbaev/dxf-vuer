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

/** Helper to create a TextParams object with defaults */
function tp(overrides: Partial<Parameters<typeof addTextToCollector>[0]> & { collector: any; font: Font }) {
  return {
    layer: "0", color: "#fff", text: "A", height: 10,
    posX: 0, posY: 0, posZ: 0,
    ...overrides,
  };
}

/** Helper to create an MTextParams object with defaults */
function mp(overrides: Partial<Parameters<typeof addMTextToCollector>[0]> & { collector: any; font: Font; lines: MTextLine[] }) {
  return {
    layer: "0", color: "#fff", defaultHeight: 10,
    posX: 0, posY: 0, posZ: 0,
    ...overrides,
  };
}

/** Helper to create a DimensionTextParams object with defaults */
function dp(overrides: Partial<Parameters<typeof addDimensionTextToCollector>[0]> & { collector: any; font: Font }) {
  return {
    layer: "0", color: "#fff", rawText: "25.40", height: 10,
    posX: 0, posY: 0, posZ: 0,
    ...overrides,
  };
}

beforeAll(() => {
  clearGlyphCache();
  font = loadDefaultFont();
});

describe("vectorTextBuilder", () => {
  describe("addTextToCollector — basic", () => {
    it("produces mesh data for simple text", () => {
      const c = new MockCollector();
      addTextToCollector(tp({ collector: c as any, font, text: "Hello" }));
      expect(c.meshCalls.length).toBe(1);
      expect(c.totalVertices).toBeGreaterThan(0);
      expect(c.totalTriangles).toBeGreaterThan(0);
    });

    it("produces nothing for empty string", () => {
      const c = new MockCollector();
      addTextToCollector(tp({ collector: c as any, font, text: "" }));
      expect(c.meshCalls.length).toBe(0);
    });

    it("produces nothing for zero height", () => {
      const c = new MockCollector();
      addTextToCollector(tp({ collector: c as any, font, text: "Test", height: 0 }));
      expect(c.meshCalls.length).toBe(0);
    });

    it("uses correct layer and color keys", () => {
      const c = new MockCollector();
      addTextToCollector(tp({ collector: c as any, font, layer: "Layer1", color: "#ff0000" }));
      expect(c.meshCalls[0].layer).toBe("Layer1");
      expect(c.meshCalls[0].color).toBe("#ff0000");
    });

    it("handles space-only text (no geometry, just advance)", () => {
      const c = new MockCollector();
      addTextToCollector(tp({ collector: c as any, font, text: "   " }));
      expect(c.meshCalls.length).toBe(0);
    });

    it("all z-coordinates match posZ", () => {
      const c = new MockCollector();
      addTextToCollector(tp({ collector: c as any, font, text: "AB", posZ: 5 }));
      for (const call of c.meshCalls) {
        for (let i = 2; i < call.vertices.length; i += 3) {
          expect(call.vertices[i]).toBe(5);
        }
      }
    });

    it("all indices are within vertex count range", () => {
      const c = new MockCollector();
      addTextToCollector(tp({ collector: c as any, font, text: "Test" }));
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
      addTextToCollector(tp({ collector: c as any, font, posX: 100, posY: 200 }));
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
      addTextToCollector(tp({ collector: c as any, font, text: "ABC", posX: 50, hAlign: HAlign.LEFT, vAlign: VAlign.BASELINE }));
      const b = c.getBounds();
      expect(b.xMin).toBeGreaterThanOrEqual(49);
      expect(b.xMax).toBeGreaterThan(55);
    });

    it("CENTER: text is centered around position", () => {
      const c = new MockCollector();
      addTextToCollector(tp({ collector: c as any, font, text: "ABC", posX: 50, hAlign: HAlign.CENTER, vAlign: VAlign.BASELINE }));
      const b = c.getBounds();
      // Midpoint should be near x=50
      const midX = (b.xMin + b.xMax) / 2;
      expect(Math.abs(midX - 50)).toBeLessThan(2);
    });

    it("RIGHT: text extends to the left of position", () => {
      const c = new MockCollector();
      addTextToCollector(tp({ collector: c as any, font, text: "ABC", posX: 50, hAlign: HAlign.RIGHT, vAlign: VAlign.BASELINE }));
      const b = c.getBounds();
      expect(b.xMax).toBeLessThanOrEqual(51);
      expect(b.xMin).toBeLessThan(50);
    });
  });

  describe("addTextToCollector — vertical alignment", () => {
    it("BASELINE: some glyphs extend above and below y", () => {
      const c = new MockCollector();
      addTextToCollector(tp({ collector: c as any, font, text: "Ag", posY: 50, hAlign: HAlign.LEFT, vAlign: VAlign.BASELINE }));
      const b = c.getBounds();
      // 'A' ascends above baseline, 'g' descends below
      expect(b.yMax).toBeGreaterThan(50);
      expect(b.yMin).toBeLessThan(50);
    });

    it("TOP: text extends below position", () => {
      const c = new MockCollector();
      addTextToCollector(tp({ collector: c as any, font, posY: 50, hAlign: HAlign.LEFT, vAlign: VAlign.TOP }));
      const b = c.getBounds();
      expect(b.yMax).toBeLessThanOrEqual(51);
    });

    it("BOTTOM: text extends above position", () => {
      const c = new MockCollector();
      addTextToCollector(tp({ collector: c as any, font, posY: 50, hAlign: HAlign.LEFT, vAlign: VAlign.BOTTOM }));
      const b = c.getBounds();
      expect(b.yMin).toBeGreaterThanOrEqual(49);
    });
  });

  describe("addTextToCollector — rotation", () => {
    it("90° rotation: text extends upward instead of rightward", () => {
      const c = new MockCollector();
      addTextToCollector(tp({ collector: c as any, font, text: "ABC", rotation: Math.PI / 2, hAlign: HAlign.LEFT, vAlign: VAlign.BASELINE }));
      const b = c.getBounds();
      // Rotated 90° CCW: width becomes vertical extent
      expect(b.yMax - b.yMin).toBeGreaterThan(15); // text width now vertical
    });

    it("0° and 360° produce same result", () => {
      const c1 = new MockCollector();
      const c2 = new MockCollector();
      addTextToCollector(tp({ collector: c1 as any, font, rotation: 0 }));
      addTextToCollector(tp({ collector: c2 as any, font, rotation: Math.PI * 2 }));
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
      addTextToCollector(tp({ collector: c1 as any, font, hAlign: HAlign.LEFT, vAlign: VAlign.BASELINE, widthFactor: 1 }));
      addTextToCollector(tp({ collector: c2 as any, font, hAlign: HAlign.LEFT, vAlign: VAlign.BASELINE, widthFactor: 2 }));
      const w1 = c1.getBounds().xMax - c1.getBounds().xMin;
      const w2 = c2.getBounds().xMax - c2.getBounds().xMin;
      expect(w2).toBeCloseTo(w1 * 2, 1);
    });

    it("widthFactor does not affect vertical extent", () => {
      const c1 = new MockCollector();
      const c2 = new MockCollector();
      addTextToCollector(tp({ collector: c1 as any, font, hAlign: HAlign.LEFT, vAlign: VAlign.BASELINE, widthFactor: 1 }));
      addTextToCollector(tp({ collector: c2 as any, font, hAlign: HAlign.LEFT, vAlign: VAlign.BASELINE, widthFactor: 2 }));
      const h1 = c1.getBounds().yMax - c1.getBounds().yMin;
      const h2 = c2.getBounds().yMax - c2.getBounds().yMin;
      expect(h2).toBeCloseTo(h1, 1);
    });
  });

  describe("addTextToCollector — FIT/ALIGNED", () => {
    it("FIT: text fits between two points horizontally", () => {
      const c = new MockCollector();
      addTextToCollector(tp({ collector: c as any, font, text: "AB", posX: 10, hAlign: HAlign.FIT, vAlign: VAlign.BASELINE, endPosX: 50, endPosY: 0 }));
      const b = c.getBounds();
      expect(b.xMin).toBeCloseTo(10, 0);
      expect(b.xMax).toBeCloseTo(50, 0);
    });

    it("FIT: does not change vertical size", () => {
      const cNormal = new MockCollector();
      const cFit = new MockCollector();
      addTextToCollector(tp({ collector: cNormal as any, font, text: "AB", hAlign: HAlign.LEFT, vAlign: VAlign.BASELINE }));
      addTextToCollector(tp({ collector: cFit as any, font, text: "AB", hAlign: HAlign.FIT, vAlign: VAlign.BASELINE, endPosX: 100, endPosY: 0 }));
      const hNormal = cNormal.getBounds().yMax - cNormal.getBounds().yMin;
      const hFit = cFit.getBounds().yMax - cFit.getBounds().yMin;
      expect(hFit).toBeCloseTo(hNormal, 1);
    });

    it("ALIGNED: text fits between two points with uniform scale", () => {
      const c = new MockCollector();
      addTextToCollector(tp({ collector: c as any, font, text: "AB", posX: 10, hAlign: HAlign.ALIGNED, vAlign: VAlign.BASELINE, endPosX: 50, endPosY: 0 }));
      const b = c.getBounds();
      expect(b.xMin).toBeCloseTo(10, 0);
      expect(b.xMax).toBeCloseTo(50, 0);
    });

    it("ALIGNED: vertical size scales proportionally", () => {
      const cNormal = new MockCollector();
      const cAligned = new MockCollector();
      addTextToCollector(tp({ collector: cNormal as any, font, text: "AB", hAlign: HAlign.LEFT, vAlign: VAlign.BASELINE }));
      addTextToCollector(tp({ collector: cAligned as any, font, text: "AB", hAlign: HAlign.ALIGNED, vAlign: VAlign.BASELINE, endPosX: 60, endPosY: 0 }));
      const hNormal = cNormal.getBounds().yMax - cNormal.getBounds().yMin;
      const hAligned = cAligned.getBounds().yMax - cAligned.getBounds().yMin;
      expect(hAligned).toBeGreaterThan(hNormal * 1.5);
    });

    it("ALIGNED with angled endPos: text rotates to match", () => {
      const c = new MockCollector();
      addTextToCollector(tp({ collector: c as any, font, text: "AB", hAlign: HAlign.ALIGNED, vAlign: VAlign.BASELINE, endPosX: 50, endPosY: 50 }));
      const b = c.getBounds();
      const w = b.xMax - b.xMin;
      const h = b.yMax - b.yMin;
      expect(w).toBeGreaterThan(10);
      expect(h).toBeGreaterThan(10);
    });
  });

  describe("addTextToCollector — Cyrillic text", () => {
    it("renders Cyrillic characters", () => {
      const c = new MockCollector();
      addTextToCollector(tp({ collector: c as any, font, text: "Привет" }));
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
      const lines: MTextLine[] = [{ text: "Line one" }, { text: "Line two" }];
      addMTextToCollector(mp({ collector: c as any, font, lines }));
      expect(c.meshCalls.length).toBe(2);
      expect(c.totalVertices).toBeGreaterThan(0);
    });

    it("produces nothing for empty lines array", () => {
      const c = new MockCollector();
      addMTextToCollector(mp({ collector: c as any, font, lines: [] }));
      expect(c.meshCalls.length).toBe(0);
    });

    it("single line works like addTextToCollector", () => {
      const c = new MockCollector();
      addMTextToCollector(mp({ collector: c as any, font, lines: [{ text: "Hello" }] }));
      expect(c.meshCalls.length).toBe(1);
      expect(c.totalVertices).toBeGreaterThan(0);
    });

    it("all z-coordinates match posZ", () => {
      const c = new MockCollector();
      addMTextToCollector(mp({ collector: c as any, font, lines: [{ text: "A" }, { text: "B" }], posZ: 7 }));
      for (const call of c.meshCalls) {
        for (let i = 2; i < call.vertices.length; i += 3) {
          expect(call.vertices[i]).toBe(7);
        }
      }
    });

    it("produces nothing for zero height", () => {
      const c = new MockCollector();
      addMTextToCollector(mp({ collector: c as any, font, lines: [{ text: "Hello" }], defaultHeight: 0 }));
      expect(c.meshCalls.length).toBe(0);
    });
  });

  describe("addMTextToCollector — attachment points", () => {
    it("TOP_LEFT (1): text extends below and right of position", () => {
      const c = new MockCollector();
      const lines: MTextLine[] = [{ text: "AB" }, { text: "CD" }];
      addMTextToCollector(mp({ collector: c as any, font, lines, posX: 50, posY: 50, attachmentPoint: 1 }));
      const b = c.getBounds();
      expect(b.xMin).toBeGreaterThanOrEqual(48);
      expect(b.yMax).toBeLessThanOrEqual(52);
    });

    it("BOTTOM_RIGHT (9): text extends above and left of position", () => {
      const c = new MockCollector();
      const lines: MTextLine[] = [{ text: "AB" }, { text: "CD" }];
      addMTextToCollector(mp({ collector: c as any, font, lines, posX: 50, posY: 50, attachmentPoint: 9 }));
      const b = c.getBounds();
      expect(b.xMax).toBeLessThanOrEqual(52);
      expect(b.yMin).toBeGreaterThanOrEqual(44);
    });

    it("MIDDLE_CENTER (5): text is centered around position", () => {
      const c = new MockCollector();
      const lines: MTextLine[] = [{ text: "AB" }, { text: "CD" }];
      addMTextToCollector(mp({ collector: c as any, font, lines, posX: 50, posY: 50, attachmentPoint: 5 }));
      const b = c.getBounds();
      const midX = (b.xMin + b.xMax) / 2;
      const midY = (b.yMin + b.yMax) / 2;
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
      addMTextToCollector(mp({ collector: c as any, font, lines }));
      const colors = c.meshCalls.map(call => call.color);
      expect(colors).toContain("#ff0000");
      expect(colors).toContain("#0000ff");
    });

    it("lines without color use default entity color", () => {
      const c = new MockCollector();
      addMTextToCollector(mp({ collector: c as any, font, lines: [{ text: "Default" }], color: "#abcdef" }));
      expect(c.meshCalls[0].color).toBe("#abcdef");
    });
  });

  describe("addMTextToCollector — per-line height", () => {
    it("different line heights render at different sizes", () => {
      const cSmall = new MockCollector();
      const cLarge = new MockCollector();
      addMTextToCollector(mp({ collector: cSmall as any, font, lines: [{ text: "A", height: 5 }] }));
      addMTextToCollector(mp({ collector: cLarge as any, font, lines: [{ text: "A", height: 20 }] }));
      const hSmall = cSmall.getBounds().yMax - cSmall.getBounds().yMin;
      const hLarge = cLarge.getBounds().yMax - cLarge.getBounds().yMin;
      expect(hLarge).toBeGreaterThan(hSmall * 2);
    });
  });

  describe("addMTextToCollector — word wrapping", () => {
    it("long text with width constraint produces multiple lines", () => {
      const c = new MockCollector();
      const lines: MTextLine[] = [{ text: "Hello World Test" }];
      const helloWidth = measureTextWidth(font, "Hello World", 10);
      addMTextToCollector(mp({ collector: c as any, font, lines, width: helloWidth * 0.8, attachmentPoint: 1 }));
      expect(c.meshCalls.length).toBeGreaterThan(1);
    });

    it("short text stays single line when width is large enough", () => {
      const c = new MockCollector();
      addMTextToCollector(mp({ collector: c as any, font, lines: [{ text: "Hi" }], width: 1000, attachmentPoint: 1 }));
      expect(c.meshCalls.length).toBe(1);
    });

    it("width=0 or undefined skips wrapping", () => {
      const c1 = new MockCollector();
      const c2 = new MockCollector();
      const lines: MTextLine[] = [{ text: "Hello World Test" }];
      addMTextToCollector(mp({ collector: c1 as any, font, lines, width: 0, attachmentPoint: 1 }));
      addMTextToCollector(mp({ collector: c2 as any, font, lines, attachmentPoint: 1 }));
      expect(c1.meshCalls.length).toBe(1);
      expect(c2.meshCalls.length).toBe(1);
    });
  });

  describe("addMTextToCollector — stacked text", () => {
    it("line with stackedTop/stackedBottom renders extra geometry", () => {
      const c = new MockCollector();
      const lines: MTextLine[] = [{ text: "Main", stackedTop: "1", stackedBottom: "2" }];
      addMTextToCollector(mp({ collector: c as any, font, lines }));
      expect(c.meshCalls.length).toBeGreaterThanOrEqual(3);
      expect(c.totalVertices).toBeGreaterThan(0);
    });

    it("stacked text without main text still renders fractions", () => {
      const c = new MockCollector();
      const lines: MTextLine[] = [{ text: "", stackedTop: "1", stackedBottom: "2" }];
      addMTextToCollector(mp({ collector: c as any, font, lines }));
      expect(c.meshCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("addMTextToCollector — rotation", () => {
    it("90° rotation changes text direction", () => {
      const c0 = new MockCollector();
      const c90 = new MockCollector();
      const lines: MTextLine[] = [{ text: "ABC" }];
      addMTextToCollector(mp({ collector: c0 as any, font, lines, rotation: 0 }));
      addMTextToCollector(mp({ collector: c90 as any, font, lines, rotation: Math.PI / 2 }));
      const b0 = c0.getBounds();
      const b90 = c90.getBounds();
      expect(b0.xMax - b0.xMin).toBeGreaterThan(b0.yMax - b0.yMin);
      expect(b90.yMax - b90.yMin).toBeGreaterThan(b90.xMax - b90.xMin);
    });

    it("multiline rotation positions lines perpendicular to text direction", () => {
      const c = new MockCollector();
      const lines: MTextLine[] = [{ text: "A" }, { text: "B" }];
      addMTextToCollector(mp({ collector: c as any, font, lines, rotation: Math.PI / 2, attachmentPoint: 1 }));
      const b = c.getBounds();
      const w = b.xMax - b.xMin;
      expect(w).toBeGreaterThan(5);
    });
  });

  describe("addMTextToCollector — tab stops", () => {
    it("trailing tabs exceeding column width insert empty line (more mesh calls)", () => {
      // Tab stop = 4 × defaultHeight = 4 × 10 = 40 units
      // "AB\tCD\t\t": AB width ~14, tab→40, CD width ~14, pos→54, tab→80, tab→120
      // With column width=50, trailing tabs (120 > 50) cause wrapping → empty line
      const cTabs = new MockCollector();
      const cNoTabs = new MockCollector();
      const linesWithTabs: MTextLine[] = [{ text: "AB\tCD\t\t" }, { text: "EF" }];
      const linesNoTabs: MTextLine[] = [{ text: "AB CD" }, { text: "EF" }];
      addMTextToCollector(mp({ collector: cTabs as any, font, lines: linesWithTabs, width: 50, attachmentPoint: 1 }));
      addMTextToCollector(mp({ collector: cNoTabs as any, font, lines: linesNoTabs, width: 50, attachmentPoint: 1 }));
      // With trailing tabs creating empty line, the MTEXT block is taller (3 visual lines vs 2)
      const bTabs = cTabs.getBounds();
      const bNoTabs = cNoTabs.getBounds();
      expect(bTabs.yMin).toBeLessThan(bNoTabs.yMin);
    });

    it("tabs within text produce wider spacing than two spaces", () => {
      const cTab = new MockCollector();
      const cSpaces = new MockCollector();
      // Tab stop at 40 units, so A\tB places B much further than "A  B"
      addMTextToCollector(mp({ collector: cTab as any, font, lines: [{ text: "A\tB" }] }));
      addMTextToCollector(mp({ collector: cSpaces as any, font, lines: [{ text: "A  B" }] }));
      const bTab = cTab.getBounds();
      const bSpaces = cSpaces.getBounds();
      expect(bTab.xMax - bTab.xMin).toBeGreaterThan(bSpaces.xMax - bSpaces.xMin);
    });

    it("no empty line inserted when trailing tabs fit within column width", () => {
      const cTabs = new MockCollector();
      const cNoTabs = new MockCollector();
      // Very wide column (1000 units) — tabs won't exceed it
      const linesWithTabs: MTextLine[] = [{ text: "AB\tCD\t" }, { text: "EF" }];
      const linesNoTabs: MTextLine[] = [{ text: "AB CD" }, { text: "EF" }];
      addMTextToCollector(mp({ collector: cTabs as any, font, lines: linesWithTabs, width: 1000, attachmentPoint: 1 }));
      addMTextToCollector(mp({ collector: cNoTabs as any, font, lines: linesNoTabs, width: 1000, attachmentPoint: 1 }));
      // Same number of visual lines (2), so Y bounds should be similar
      const bTabs = cTabs.getBounds();
      const bNoTabs = cNoTabs.getBounds();
      expect(Math.abs(bTabs.yMin - bNoTabs.yMin)).toBeLessThan(5);
    });

    it("tabs without column width are expanded to spaces (no crash)", () => {
      const c = new MockCollector();
      addMTextToCollector(mp({ collector: c as any, font, lines: [{ text: "X-00\tREFRIGERATOR\t\t" }] }));
      expect(c.meshCalls.length).toBeGreaterThan(0);
    });

    it("relaxed check: trailing tab within one tab stop of boundary inserts empty line", () => {
      // Tab stop = 4 × 10 = 40. "A\tB\t": A→tab(40), B~(48)→trailing tab(80).
      // With width=81: strict fails (80 < 81), relaxed passes (80 > 81-40=41).
      // Next line is "X" (not empty) → insert empty line.
      const c = new MockCollector();
      const linesRelaxed: MTextLine[] = [{ text: "A\tB\t" }, { text: "X" }];
      addMTextToCollector(mp({ collector: c as any, font, lines: linesRelaxed, width: 81, attachmentPoint: 1 }));
      const b = c.getBounds();
      // 3 visual lines (text + empty + X), block should be taller than 2 lines
      const cNoRelax = new MockCollector();
      const linesNoRelax: MTextLine[] = [{ text: "A B" }, { text: "X" }];
      addMTextToCollector(mp({ collector: cNoRelax as any, font, lines: linesNoRelax, width: 81, attachmentPoint: 1 }));
      const bNoRelax = cNoRelax.getBounds();
      expect(b.yMin).toBeLessThan(bNoRelax.yMin);
    });

    it("relaxed check does NOT insert empty line when next line is already empty", () => {
      // Same tab layout: "A\tB\t" → trailing tab at 80. width=81.
      // Strict fails (80<81), relaxed passes (80>41), but next line is "" → no insert.
      const cWithTabs = new MockCollector();
      const cPlain = new MockCollector();
      const linesWithTabs: MTextLine[] = [{ text: "A\tB\t" }, { text: "" }, { text: "X" }];
      const linesPlain: MTextLine[] = [{ text: "A B" }, { text: "" }, { text: "X" }];
      addMTextToCollector(mp({ collector: cWithTabs as any, font, lines: linesWithTabs, width: 81, attachmentPoint: 1 }));
      addMTextToCollector(mp({ collector: cPlain as any, font, lines: linesPlain, width: 81, attachmentPoint: 1 }));
      const b1 = cWithTabs.getBounds();
      const b2 = cPlain.getBounds();
      // Same number of visual lines (3) — no extra empty line inserted
      expect(Math.abs(b1.yMin - b2.yMin)).toBeLessThan(5);
    });
  });

  describe("addDimensionTextToCollector — plain text", () => {
    it("produces mesh data for dimension value", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(dp({ collector: c as any, font }));
      expect(c.meshCalls.length).toBe(1);
      expect(c.totalVertices).toBeGreaterThan(0);
      expect(c.totalTriangles).toBeGreaterThan(0);
    });

    it("produces nothing for empty text", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(dp({ collector: c as any, font, rawText: "" }));
      expect(c.meshCalls.length).toBe(0);
    });

    it("produces nothing for whitespace-only text", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(dp({ collector: c as any, font, rawText: "   " }));
      expect(c.meshCalls.length).toBe(0);
    });

    it("produces nothing for zero height", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(dp({ collector: c as any, font, height: 0 }));
      expect(c.meshCalls.length).toBe(0);
    });

    it("strips MTEXT formatting codes", () => {
      const c1 = new MockCollector();
      const c2 = new MockCollector();
      addDimensionTextToCollector(dp({ collector: c1 as any, font, rawText: "\\fArial;25.40" }));
      addDimensionTextToCollector(dp({ collector: c2 as any, font }));
      expect(c1.totalVertices).toBe(c2.totalVertices);
    });
  });

  describe("addDimensionTextToCollector — stacked text", () => {
    it("renders stacked fractions as multiple mesh calls", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(dp({ collector: c as any, font, rawText: "\\S5.2^5.3;" }));
      expect(c.meshCalls.length).toBeGreaterThanOrEqual(2);
      expect(c.totalVertices).toBeGreaterThan(0);
    });

    it("renders prefix + stacked fractions", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(dp({ collector: c as any, font, rawText: "Prefix \\S1^2;" }));
      expect(c.meshCalls.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("addDimensionTextToCollector — alignment", () => {
    it("center: text centered around position", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(dp({ collector: c as any, font, posX: 50, hAlign: "center" }));
      const b = c.getBounds();
      const midX = (b.xMin + b.xMax) / 2;
      expect(Math.abs(midX - 50)).toBeLessThan(2);
    });

    it("left: text extends right of position", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(dp({ collector: c as any, font, posX: 50, hAlign: "left" }));
      const b = c.getBounds();
      expect(b.xMin).toBeGreaterThanOrEqual(49);
      expect(b.xMax).toBeGreaterThan(55);
    });

    it("right: text extends left of position", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(dp({ collector: c as any, font, posX: 50, hAlign: "right" }));
      const b = c.getBounds();
      expect(b.xMax).toBeLessThanOrEqual(51);
    });
  });

  describe("addDimensionTextToCollector — rotation", () => {
    it("90° rotation changes text direction", () => {
      const c0 = new MockCollector();
      const c90 = new MockCollector();
      addDimensionTextToCollector(dp({ collector: c0 as any, font, rotation: 0 }));
      addDimensionTextToCollector(dp({ collector: c90 as any, font, rotation: Math.PI / 2 }));
      const b0 = c0.getBounds();
      const b90 = c90.getBounds();
      expect(b0.xMax - b0.xMin).toBeGreaterThan(b0.yMax - b0.yMin);
      expect(b90.yMax - b90.yMin).toBeGreaterThan(b90.xMax - b90.xMin);
    });
  });

  describe("addDimensionTextToCollector — vertical centering", () => {
    it("text vertically centered on insertion point (VAlign.MIDDLE)", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(dp({ collector: c as any, font, hAlign: "center" }));
      const b = c.getBounds();
      const midY = (b.yMin + b.yMax) / 2;
      expect(Math.abs(midY)).toBeLessThan(1);
    });

    it("text centered on insertion point with rotation", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(dp({ collector: c as any, font, rawText: "A", posX: 50, posY: 50, rotation: Math.PI / 2, hAlign: "center" }));
      const b = c.getBounds();
      const midX = (b.xMin + b.xMax) / 2;
      const midY = (b.yMin + b.yMax) / 2;
      expect(Math.abs(midX - 50)).toBeLessThan(5);
      expect(Math.abs(midY - 50)).toBeLessThan(5);
    });
  });

  describe("addDimensionTextToCollector — z coordinate", () => {
    it("all vertices have correct posZ", () => {
      const c = new MockCollector();
      addDimensionTextToCollector(dp({ collector: c as any, font, posZ: 3.5 }));
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
      addTextToCollector(tp({ collector: c1 as any, font }));

      // Identity matrix — should produce same positions
      // prettier-ignore
      const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
      const c2 = new MockCollector();
      addTextToCollector(tp({ collector: c2 as any, font, transform: identity }));
      expect(c2.meshCalls.length).toBe(1);
      expect(c2.meshCalls[0].vertices.length).toBe(c1.meshCalls[0].vertices.length);
      for (let i = 0; i < c1.meshCalls[0].vertices.length; i++) {
        expect(c2.meshCalls[0].vertices[i]).toBeCloseTo(c1.meshCalls[0].vertices[i], 5);
      }
    });

    it("addTextToCollector translates vertices by transform", () => {
      // prettier-ignore
      const translate = [1,0,0,0, 0,1,0,0, 0,0,1,0, 100,200,0,1];

      const cOrig = new MockCollector();
      addTextToCollector(tp({ collector: cOrig as any, font, posX: 5, posY: 5 }));

      const cTransformed = new MockCollector();
      addTextToCollector(tp({ collector: cTransformed as any, font, posX: 5, posY: 5, transform: translate }));

      expect(cTransformed.meshCalls.length).toBe(1);
      const vOrig = cOrig.meshCalls[0].vertices;
      const vT = cTransformed.meshCalls[0].vertices;
      for (let i = 0; i < vOrig.length; i += 3) {
        expect(vT[i]).toBeCloseTo(vOrig[i] + 100, 5);
        expect(vT[i + 1]).toBeCloseTo(vOrig[i + 1] + 200, 5);
        expect(vT[i + 2]).toBeCloseTo(vOrig[i + 2], 5);
      }
    });

    it("addDimensionTextToCollector passes transform through", () => {
      // prettier-ignore
      const translate = [1,0,0,0, 0,1,0,0, 0,0,1,0, 500,300,0,1];

      const cOrig = new MockCollector();
      addDimensionTextToCollector(dp({ collector: cOrig as any, font, rawText: "10", height: 5, posX: 10, posY: 10 }));

      const cT = new MockCollector();
      addDimensionTextToCollector(dp({ collector: cT as any, font, rawText: "10", height: 5, posX: 10, posY: 10, transform: translate }));

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
