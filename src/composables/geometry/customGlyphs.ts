import { ShapeUtils, Vector2 } from "three";
import type { GlyphData } from "./glyphCache";

/**
 * Custom glyph registry for engineering symbols missing from bundled fonts.
 * Each entry is a builder function that procedurally generates triangulated
 * GlyphData (positions, indices, advance, bounds) in normalized coordinates
 * (baseline at y=0, cap-height ~0.7, advance width ~0.5-0.8).
 */
const CUSTOM_GLYPHS = new Map<string, () => GlyphData>();

// ── Geometry helpers ────────────────────────────────────────────────────

/** Generate CCW circle points as Vector2 for triangulation. */
function circlePoints(
  cx: number, cy: number, r: number, segments: number,
): Vector2[] {
  const pts: Vector2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return pts;
}

/**
 * Build an annulus (ring) as triangulated geometry.
 * Outer contour CCW, inner hole CW — standard winding for ShapeUtils.
 */
function buildRing(
  cx: number, cy: number,
  outerR: number, innerR: number,
  segments: number,
): { positions: number[]; indices: number[] } {
  const outer = circlePoints(cx, cy, outerR, segments);
  const inner = circlePoints(cx, cy, innerR, segments);
  // Hole must be CW — reverse the CCW inner ring
  const hole = [...inner].reverse();

  const triangles = ShapeUtils.triangulateShape(outer, [hole]);

  const positions: number[] = [];
  for (const p of outer) positions.push(p.x, p.y, 0);
  for (const p of hole) positions.push(p.x, p.y, 0);

  const indices: number[] = [];
  for (const [a, b, c] of triangles) indices.push(a, b, c);

  return { positions, indices };
}

/**
 * Build a thin rectangle (stroke) between two points.
 * Returns 4 vertices and 2 triangles.
 */
function buildStroke(
  x1: number, y1: number,
  x2: number, y2: number,
  halfWidth: number,
): { positions: number[]; indices: number[] } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return { positions: [], indices: [] };

  // Normal perpendicular to the line
  const nx = (-dy / len) * halfWidth;
  const ny = (dx / len) * halfWidth;

  const positions = [
    x1 + nx, y1 + ny, 0,
    x1 - nx, y1 - ny, 0,
    x2 - nx, y2 - ny, 0,
    x2 + nx, y2 + ny, 0,
  ];
  // CCW winding for both triangles
  const indices = [0, 1, 2, 0, 2, 3];

  return { positions, indices };
}

/**
 * Merge multiple geometry pieces into a single GlyphData.
 */
function mergeGeometry(
  pieces: { positions: number[]; indices: number[] }[],
  advance: number,
): GlyphData {
  const allPositions: number[] = [];
  const allIndices: number[] = [];

  for (const piece of pieces) {
    const baseIdx = allPositions.length / 3;
    for (const v of piece.positions) allPositions.push(v);
    for (const i of piece.indices) allIndices.push(i + baseIdx);
  }

  // Compute bounds
  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < allPositions.length; i += 3) {
    const x = allPositions[i], y = allPositions[i + 1];
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }

  return {
    positions: allPositions,
    indices: allIndices,
    advance,
    bounds: allPositions.length > 0
      ? { xMin, xMax, yMin, yMax }
      : { xMin: 0, xMax: 0, yMin: 0, yMax: 0 },
  };
}

// ── Diameter symbol ⌀ (U+2300) ─────────────────────────────────────────

function buildDiameterGlyph(): GlyphData {
  // Normalized coordinates: baseline at y=0, cap-height ~0.7
  // Matches visual weight of 'O' in Noto Sans Light
  const cx = 0.355;
  const cy = 0.35;
  const outerR = 0.31;
  const strokeW = 0.045;
  const innerR = outerR - strokeW;
  const segments = 32;

  // Circle ring
  const ring = buildRing(cx, cy, outerR, innerR, segments);

  // Diagonal line at 60° extending ~15% beyond the circle
  const angle = (60 * Math.PI) / 180;
  const extend = outerR * 1.15;
  const x1 = cx - Math.cos(angle) * extend;
  const y1 = cy - Math.sin(angle) * extend;
  const x2 = cx + Math.cos(angle) * extend;
  const y2 = cy + Math.sin(angle) * extend;
  const line = buildStroke(x1, y1, x2, y2, strokeW / 2);

  // Advance width ~0.73 (matches font's 'O')
  return mergeGeometry([ring, line], 0.73);
}

// ── Math relation symbols ───────────────────────────────────────────────
// Reference: font's '=' glyph has advance=0.571, bars at x=[0.056..0.514],
// lower bar center y≈0.254, upper bar center y≈0.451, stroke thickness≈0.052

/** Shared constants for math relation glyphs (match font's '=' proportions) */
const MATH_ADVANCE = 0.571;
const MATH_X_LEFT = 0.056;
const MATH_X_RIGHT = 0.514;
const MATH_STROKE_HW = 0.026; // half of 0.052 stroke thickness
const MATH_LOWER_Y = 0.254;   // lower bar center
const MATH_UPPER_Y = 0.451;   // upper bar center

/** Build a horizontal bar (used by =, ≠, ≡ glyphs). */
function buildHBar(y: number): { positions: number[]; indices: number[] } {
  return buildStroke(MATH_X_LEFT, y, MATH_X_RIGHT, y, MATH_STROKE_HW);
}

/** Build a wavy (sine) horizontal line for ≈ glyph. */
function buildWavyLine(
  yCenter: number, amplitude: number, segments: number = 16,
): { positions: number[]; indices: number[] } {
  const pieces: { positions: number[]; indices: number[] }[] = [];
  for (let i = 0; i < segments; i++) {
    const t1 = i / segments;
    const t2 = (i + 1) / segments;
    const x1 = MATH_X_LEFT + t1 * (MATH_X_RIGHT - MATH_X_LEFT);
    const x2 = MATH_X_LEFT + t2 * (MATH_X_RIGHT - MATH_X_LEFT);
    // 1.5 cycles, starting at bottom (t=0) → ending at top (t=1)
    const y1 = yCenter + Math.sin(t1 * Math.PI * 3 - Math.PI / 2) * amplitude;
    const y2 = yCenter + Math.sin(t2 * Math.PI * 3 - Math.PI / 2) * amplitude;
    pieces.push(buildStroke(x1, y1, x2, y2, MATH_STROKE_HW));
  }
  const positions: number[] = [];
  const indices: number[] = [];
  for (const piece of pieces) {
    const base = positions.length / 3;
    for (const v of piece.positions) positions.push(v);
    for (const idx of piece.indices) indices.push(idx + base);
  }
  return { positions, indices };
}

// ≈ APPROXIMATELY EQUAL TO (U+2248) — two wavy lines
function buildApproxEqualGlyph(): GlyphData {
  const wave1 = buildWavyLine(MATH_LOWER_Y, 0.035);
  const wave2 = buildWavyLine(MATH_UPPER_Y, 0.035);
  return mergeGeometry([wave1, wave2], MATH_ADVANCE);
}

// ≠ NOT EQUAL TO (U+2260) — two bars + diagonal slash
function buildNotEqualGlyph(): GlyphData {
  const bar1 = buildHBar(MATH_LOWER_Y);
  const bar2 = buildHBar(MATH_UPPER_Y);
  // Diagonal slash through both bars, extending slightly beyond
  const midX = (MATH_X_LEFT + MATH_X_RIGHT) / 2;
  const slashDx = 0.09;
  const slashBottomY = MATH_LOWER_Y - 0.08;
  const slashTopY = MATH_UPPER_Y + 0.08;
  const slash = buildStroke(
    midX - slashDx, slashBottomY,
    midX + slashDx, slashTopY,
    MATH_STROKE_HW,
  );
  return mergeGeometry([bar1, bar2, slash], MATH_ADVANCE);
}

// ≡ IDENTICAL TO (U+2261) — three horizontal bars
function buildIdenticalGlyph(): GlyphData {
  const midY = (MATH_LOWER_Y + MATH_UPPER_Y) / 2;
  const bar1 = buildHBar(MATH_LOWER_Y - 0.05);
  const bar2 = buildHBar(midY);
  const bar3 = buildHBar(MATH_UPPER_Y + 0.05);
  return mergeGeometry([bar1, bar2, bar3], MATH_ADVANCE);
}

// ── Registration ────────────────────────────────────────────────────────

CUSTOM_GLYPHS.set("\u2300", buildDiameterGlyph); // ⌀ DIAMETER SIGN
CUSTOM_GLYPHS.set("\u2205", buildDiameterGlyph); // ∅ EMPTY SET (visual alias)
CUSTOM_GLYPHS.set("\u2248", buildApproxEqualGlyph); // ≈ APPROXIMATELY EQUAL TO
CUSTOM_GLYPHS.set("\u2260", buildNotEqualGlyph);    // ≠ NOT EQUAL TO
CUSTOM_GLYPHS.set("\u2261", buildIdenticalGlyph);    // ≡ IDENTICAL TO

// ── Public API ──────────────────────────────────────────────────────────

/** Get custom glyph data for a character, or null if not registered. */
export function getCustomGlyph(char: string): GlyphData | null {
  const builder = CUSTOM_GLYPHS.get(char);
  return builder ? builder() : null;
}

/** Check if a character has a custom glyph registered. */
export function hasCustomGlyph(char: string): boolean {
  return CUSTOM_GLYPHS.has(char);
}
