/**
 * Built-in dictionary of standard AutoCAD hatch patterns.
 * Used as fallback when a DXF file references a pattern by name
 * but does not include embedded pattern line definitions (code 78=0).
 *
 * Each pattern is an array of HatchPatternLine:
 *   { angle, basePoint: {x, y}, offset: {x, y}, dashes: number[] }
 *
 * Pattern data sourced from the standard acad.pat / acadiso.pat files.
 * Dash values: positive = draw, negative = gap, 0 = dot.
 */
import type { HatchPatternLine } from "@/types/dxf";

const p = (
  angle: number,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  dashes: number[] = [],
): HatchPatternLine => ({
  angle,
  basePoint: { x: ox, y: oy },
  offset: { x: dx, y: dy },
  dashes,
});

export const HATCH_PATTERNS: Record<string, HatchPatternLine[]> = {
  // ANSI patterns (inch-based from acad.pat)
  ANSI31: [p(45, 0, 0, 0, 3.175)],
  ANSI32: [p(45, 0, 0, 0, 9.525)],
  ANSI33: [p(45, 0, 0, 0, 6.35, [6.35, -3.175])],
  ANSI34: [p(45, 0, 0, 0, 6.35), p(45, 4.49, 0, 0, 6.35)],
  ANSI35: [p(45, 0, 0, 0, 6.35, [6.35, -3.175]), p(45, 4.49, 0, 0, 6.35, [6.35, -3.175])],
  ANSI36: [p(45, 0, 0, 0, 6.35, [6.35, -3.175]), p(45, 4.49, 0, 0, 6.35)],
  ANSI37: [
    p(45, 0, 0, 0, 3.175),
    p(135, 0, 0, 0, 3.175),
  ],
  ANSI38: [
    p(45, 0, 0, 0, 3.175),
    p(135, 0, 0, 6.35, 6.35, [16.51, -3.175]),
  ],

  // Simple line/cross patterns
  LINE: [p(0, 0, 0, 0, 3.175)],
  ANGLE: [p(0, 0, 0, 0, 6.35, [6.35, -3.175]), p(90, 0, 0, 0, 6.35, [6.35, -3.175])],
  CROSS: [p(0, 0, 0, 0, 6.35, [6.35, -6.35]), p(90, 3.175, -3.175, 0, 6.35, [6.35, -6.35])],
  NET: [p(0, 0, 0, 0, 3.175), p(90, 0, 0, 0, 3.175)],
  NET3: [p(0, 0, 0, 0, 3.175), p(60, 0, 0, 0, 3.175), p(120, 0, 0, 0, 3.175)],
  SQUARE: [p(0, 0, 0, 0, 3.175, [3.175, -3.175]), p(90, 0, 0, 0, 3.175, [3.175, -3.175])],

  // Brick pattern
  BRICK: [
    p(0, 0, 0, 0, 6.35),
    p(90, 0, 0, 6.35, 6.35, [6.35, -6.35]),
  ],

  // Dot pattern
  DOTS: [p(0, 0, 0, 0, 3.175, [0, -3.175])],

  // Hexagonal pattern
  HEX: [
    p(0, 0, 0, 0, 5.4914, [3.175, -3.175]),
    p(60, 0, 0, 0, 5.4914, [3.175, -3.175]),
    p(120, 1.5875, 2.7457, 0, 5.4914, [3.175, -3.175]),
  ],

  // Honeycomb pattern
  HONEY: [
    p(0, 0, 0, 5.4914, 9.5104, [3.175, -3.175]),
    p(60, 0, 0, 5.4914, 9.5104, [3.175, -3.175]),
    p(120, 1.5875, 2.7457, 5.4914, 9.5104, [3.175, -3.175]),
  ],

  // Star-shaped pattern
  STARS: [
    p(0, 0, 0, 0, 5.4914, [3.175, -3.175]),
    p(60, 0, 0, 0, 5.4914, [3.175, -3.175]),
    p(120, 0, 0, 0, 5.4914, [3.175, -3.175]),
  ],

  // Steel plate pattern
  STEEL: [
    p(45, 0, 0, 0, 3.175),
    p(45, 0, 1.5875, 0, 3.175),
  ],

  // Grass / ground pattern
  GRASS: [
    p(90, 0, 0, 11.049, 5.5245, [3.175, -41.275]),
    p(45, 0, 0, 11.049, 5.5245, [4.49, -39.96]),
    p(135, 0, 0, 11.049, 5.5245, [4.49, -39.96]),
  ],

  // Earth pattern
  EARTH: [
    p(0, 0, 0, 6.35, 3.175, [6.35, -6.35]),
    p(0, 0, 1.5875, 6.35, 3.175, [6.35, -6.35]),
    p(90, 1.5875, 1.5875, 6.35, 3.175, [3.175, -9.525]),
  ],

  // Insulation pattern (zigzag)
  INSUL: [
    p(0, 0, 0, 0, 9.525),
    p(0, 0, 4.7625, 0, 9.525, [4.7625, -4.7625]),
  ],

  // Mudst (simple diagonal)
  MUDST: [
    p(0, 0, 0, 12.7, 6.35, [6.35, -19.05]),
    p(90, 3.175, 0, 12.7, 6.35, [6.35, -19.05]),
  ],

  // Dash pattern
  DASH: [p(0, 0, 0, 0, 3.175, [3.175, -1.5875])],

  // GOST standard hatches (common fallback for Russian DXF files)
  GOST_GLASS: [p(45, 0, 0, 0, 4)],
  GOST_WOOD: [
    p(45, 0, 0, 0, 4),
    p(135, 0, 0, 0, 4, [2, -6]),
  ],
  GOST_METAL: [p(45, 0, 0, 0, 3)],
  "GOST_NON-METAL": [
    p(45, 0, 0, 0, 6),
    p(135, 0, 0, 0, 6),
  ],
  GOST_GROUND: [
    p(45, 0, 0, 0, 3, [3, -3]),
    p(45, 1.5, 0, 0, 3, [3, -3]),
  ],
};
