import { ShapePath, ShapeUtils } from "three";
import type { Font, Glyph } from "opentype.js";

/** Number of line segments per curve in glyph outlines.
 *  5 gives smooth contours for fonts with cubic Bézier curves (Noto Sans etc.).
 *  Lower values (2-3) produce visibly angular letter shapes. */
const CURVE_SUBDIVISION = 5;

/** Characters to use as fallback when a glyph is missing from the font. */
const FALLBACK_CHARS = "\uFFFD?";

/** Triangulated glyph data, normalized to font units (divide by unitsPerEm). */
export interface GlyphData {
  /** Flat vertex array [x,y,z, x,y,z, ...] in font units */
  positions: number[];
  /** Triangle indices */
  indices: number[];
  /** Advance width in font units */
  advance: number;
  /** Glyph bounding box in font units */
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number };
}

/** Cache key: fontFamily + glyphIndex to avoid collisions across fonts. */
function makeCacheKey(font: Font, glyphIndex: number): string {
  return `${font.names.fontFamily.en ?? "font"}::${glyphIndex}`;
}

const cache = new Map<string, GlyphData>();
let fallbackGlyphData: GlyphData | null = null;
let fallbackFontKey: string | null = null;

/**
 * Triangulate an opentype.js Glyph into flat vertex/index arrays.
 * Returns null for empty glyphs (space, control chars).
 */
function triangulateGlyph(glyph: Glyph, unitsPerEm: number): GlyphData {
  const invEm = 1 / unitsPerEm;
  const advance = (glyph.advanceWidth ?? 0) * invEm;

  const path = glyph.getPath(0, 0, unitsPerEm);
  if (path.commands.length === 0) {
    // Empty glyph — use glyph metadata for bounds (y-flipped for getPath coords)
    const bounds = {
      xMin: (glyph.xMin ?? 0) * invEm,
      xMax: (glyph.xMax ?? 0) * invEm,
      yMin: -(glyph.yMax ?? 0) * invEm,
      yMax: -(glyph.yMin ?? 0) * invEm,
    };
    return { positions: [], indices: [], advance, bounds };
  }

  // Convert opentype path commands to Three.js ShapePath
  const shapePath = new ShapePath();
  for (const cmd of path.commands) {
    switch (cmd.type) {
      case "M":
        shapePath.moveTo(cmd.x, cmd.y);
        break;
      case "L":
        shapePath.lineTo(cmd.x, cmd.y);
        break;
      case "Q":
        shapePath.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
        break;
      case "C":
        shapePath.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
        break;
      case "Z":
        if (shapePath.currentPath) {
          shapePath.currentPath.closePath();
        }
        break;
    }
  }

  // isCCW=true: opentype.js getPath() uses screen coords (Y-down), so CW in screen
  // appears as CCW to Three.js (Y-up). Passing true tells toShapes that CCW = solid,
  // which correctly identifies outer contours as solids and inner contours as holes.
  const shapes = shapePath.toShapes(true);
  const positions: number[] = [];
  const indices: number[] = [];

  for (const shape of shapes) {
    const shapePoints = shape.extractPoints(CURVE_SUBDIVISION);

    const triangles = ShapeUtils.triangulateShape(shapePoints.shape, shapePoints.holes);
    const baseIdx = positions.length / 3;

    // Outer contour vertices (normalized to unitsPerEm=1, y negated: screen→world coords)
    for (const pt of shapePoints.shape) {
      positions.push(pt.x * invEm, -pt.y * invEm, 0);
    }
    // Hole vertices (normalized, y negated)
    for (const hole of shapePoints.holes) {
      for (const pt of hole) {
        positions.push(pt.x * invEm, -pt.y * invEm, 0);
      }
    }

    // Triangle indices with base offset
    for (const [a, b, c] of triangles) {
      indices.push(a + baseIdx, b + baseIdx, c + baseIdx);
    }
  }

  // Compute bounds from actual vertex positions (getPath uses y-down screen coords,
  // which differ from glyph.yMin/yMax font coords)
  let xMin = Infinity,
    xMax = -Infinity,
    yMin = Infinity,
    yMax = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i],
      y = positions[i + 1];
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  const bounds =
    positions.length > 0 ? { xMin, xMax, yMin, yMax } : { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };

  return { positions, indices, advance, bounds };
}

/**
 * Build or return the fallback glyph for missing characters.
 * Tries FALLBACK_CHARS in order; returns null if none available.
 */
function getFallbackGlyph(font: Font): GlyphData | null {
  const fontKey = font.names.fontFamily.en ?? "font";
  if (fallbackFontKey === fontKey) return fallbackGlyphData;

  fallbackFontKey = fontKey;
  fallbackGlyphData = null;

  for (const char of FALLBACK_CHARS) {
    const idx = font.charToGlyphIndex(char);
    if (idx !== 0) {
      const glyph = font.charToGlyph(char);
      fallbackGlyphData = triangulateGlyph(glyph, font.unitsPerEm);
      const key = makeCacheKey(font, idx);
      cache.set(key, fallbackGlyphData);
      break;
    }
  }
  return fallbackGlyphData;
}

/**
 * Get triangulated glyph data for a character.
 * Results are cached per font+glyph. Returns fallback glyph data
 * for characters not present in the font.
 */
export function getTriangulatedGlyph(font: Font, char: string): GlyphData | null {
  const glyphIndex = font.charToGlyphIndex(char);

  // Missing glyph → fallback
  if (glyphIndex === 0) {
    return getFallbackGlyph(font);
  }

  const key = makeCacheKey(font, glyphIndex);
  const cached = cache.get(key);
  if (cached) return cached;

  const glyph = font.charToGlyph(char);
  const data = triangulateGlyph(glyph, font.unitsPerEm);
  cache.set(key, data);
  return data;
}

/**
 * Clear the glyph cache. Useful for testing or when switching fonts.
 */
export function clearGlyphCache(): void {
  cache.clear();
  fallbackGlyphData = null;
  fallbackFontKey = null;
}
