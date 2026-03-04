import type { Font, Glyph } from "opentype.js";
import { getTriangulatedGlyph, type GlyphData } from "./glyphCache";
import type { GeometryCollector } from "./mergeCollectors";

/** DXF TEXT horizontal alignment (code 72) */
export const enum HAlign {
  LEFT = 0,
  CENTER = 1,
  RIGHT = 2,
  ALIGNED = 3,
  MIDDLE = 4,
  FIT = 5,
}

/** DXF TEXT vertical alignment (code 73) */
export const enum VAlign {
  BASELINE = 0,
  BOTTOM = 1,
  MIDDLE = 2,
  TOP = 3,
}

interface TextMetrics {
  glyphs: Glyph[];
  glyphData: (GlyphData | null)[];
  /** Total advance width in font units */
  totalAdvance: number;
  /** Visual bounding box in font units */
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number };
}

/**
 * Measure text: collect glyphs, compute total advance and visual bounds.
 * All values are in font units (divide by unitsPerEm to normalize).
 */
function measureText(font: Font, text: string): TextMetrics {
  const glyphs = font.stringToGlyphs(text);
  const glyphDataArr: (GlyphData | null)[] = [];

  let totalAdvance = 0; // normalized (unitsPerEm = 1)
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  let hasVisibleGlyphs = false;
  const invEm = 1 / font.unitsPerEm;

  for (let i = 0; i < glyphs.length; i++) {
    const gd = getTriangulatedGlyph(font, text[i]);
    glyphDataArr.push(gd);

    if (gd && gd.positions.length > 0) {
      const gxMin = totalAdvance + gd.bounds.xMin;
      const gxMax = totalAdvance + gd.bounds.xMax;
      if (gxMin < xMin) xMin = gxMin;
      if (gxMax > xMax) xMax = gxMax;
      if (gd.bounds.yMin < yMin) yMin = gd.bounds.yMin;
      if (gd.bounds.yMax > yMax) yMax = gd.bounds.yMax;
      hasVisibleGlyphs = true;
    }

    totalAdvance += (glyphs[i].advanceWidth ?? 0) * invEm;
    if (i < glyphs.length - 1) {
      totalAdvance += font.getKerningValue(glyphs[i], glyphs[i + 1]) * invEm;
    }
  }

  if (!hasVisibleGlyphs) {
    xMin = 0;
    xMax = totalAdvance;
    yMin = font.descender * invEm;
    yMax = font.ascender * invEm;
  }

  return {
    glyphs,
    glyphData: glyphDataArr,
    totalAdvance,
    bounds: { xMin, xMax, yMin, yMax },
  };
}

/**
 * Measure text width in world units.
 */
export function measureTextWidth(
  font: Font,
  text: string,
  height: number,
  widthFactor: number = 1,
): number {
  const m = measureText(font, text);
  // bounds are normalized (unitsPerEm=1), so multiply by height directly
  return (m.bounds.xMax - m.bounds.xMin) * height * widthFactor;
}

/**
 * Add TEXT entity glyphs to GeometryCollector as triangulated mesh.
 *
 * @param collector   GeometryCollector to write into
 * @param layer       Layer name for merge key
 * @param color       Color hex string for merge key
 * @param font        opentype.js Font
 * @param text        Text string to render
 * @param height      Text height in world units
 * @param posX        Insertion point X (startPoint for LEFT/BASELINE, endPoint for others)
 * @param posY        Insertion point Y
 * @param posZ        Insertion point Z
 * @param rotation    Rotation in radians (0 = horizontal)
 * @param hAlign      Horizontal alignment (DXF code 72)
 * @param vAlign      Vertical alignment (DXF code 73)
 * @param widthFactor Relative X scale factor (DXF code 41, default 1)
 * @param endPosX     Second alignment point X (for FIT/ALIGNED)
 * @param endPosY     Second alignment point Y (for FIT/ALIGNED)
 */
export function addTextToCollector(
  collector: GeometryCollector,
  layer: string,
  color: string,
  font: Font,
  text: string,
  height: number,
  posX: number,
  posY: number,
  posZ: number,
  rotation: number = 0,
  hAlign: number = HAlign.LEFT,
  vAlign: number = VAlign.BASELINE,
  widthFactor: number = 1,
  endPosX?: number,
  endPosY?: number,
): void {
  if (!text || height <= 0) return;

  const m = measureText(font, text);
  if (m.glyphs.length === 0) return;

  // All glyph data is normalized (unitsPerEm = 1), so height IS the scale
  let scaleX = height * widthFactor;
  let scaleY = height;

  const boundsWidth = m.bounds.xMax - m.bounds.xMin;

  // FIT/ALIGNED: compute scale and rotation from two alignment points
  if (
    endPosX !== undefined &&
    endPosY !== undefined &&
    (hAlign === HAlign.ALIGNED || hAlign === HAlign.FIT)
  ) {
    const dx = endPosX - posX;
    const dy = endPosY - posY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    rotation = Math.atan2(dy, dx);

    if (boundsWidth > 0 && dist > 0) {
      const fitScale = dist / boundsWidth;
      if (hAlign === HAlign.ALIGNED) {
        // Uniform scale to fit distance
        scaleX = fitScale;
        scaleY = fitScale;
      } else {
        // FIT: scale only X, keep Y = height
        scaleX = fitScale;
      }
    }
  }

  // Horizontal origin offset (in normalized font units: divided by unitsPerEm)
  let originX = 0;
  switch (hAlign) {
    case HAlign.LEFT:
      originX = m.bounds.xMin;
      break;
    case HAlign.CENTER:
      originX = (m.bounds.xMax + m.bounds.xMin) / 2;
      break;
    case HAlign.RIGHT:
      originX = m.bounds.xMax;
      break;
    case HAlign.MIDDLE:
      originX = (m.bounds.xMax + m.bounds.xMin) / 2;
      break;
    case HAlign.ALIGNED:
    case HAlign.FIT:
      originX = m.bounds.xMin;
      break;
  }

  // Vertical origin offset (in normalized font units)
  let originY = 0;
  switch (vAlign) {
    case VAlign.BASELINE:
      originY = 0;
      break;
    case VAlign.BOTTOM:
      originY = m.bounds.yMin;
      break;
    case VAlign.MIDDLE:
      originY = (m.bounds.yMax + m.bounds.yMin) / 2;
      break;
    case VAlign.TOP:
      originY = m.bounds.yMax;
      break;
  }
  // MIDDLE (hAlign=4) also centers vertically
  if (hAlign === HAlign.MIDDLE) {
    originY = (m.bounds.yMax + m.bounds.yMin) / 2;
  }

  // Rotation transform
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  // Emit glyphs into collector
  let xCursor = 0; // normalized advance cursor (unitsPerEm = 1)
  const allPositions: number[] = [];
  const allIndices: number[] = [];
  const invEm = 1 / font.unitsPerEm;

  for (let i = 0; i < m.glyphs.length; i++) {
    const gd = m.glyphData[i];

    if (gd && gd.positions.length > 0) {
      const vertexOffset = allPositions.length / 3;

      for (let j = 0; j < gd.positions.length; j += 3) {
        // All values normalized (unitsPerEm = 1)
        const localX = (gd.positions[j] + xCursor - originX) * scaleX;
        const localY = (gd.positions[j + 1] - originY) * scaleY;
        // Rotation + translation to world coordinates
        allPositions.push(
          posX + localX * cos - localY * sin,
          posY + localX * sin + localY * cos,
          posZ,
        );
      }

      for (const idx of gd.indices) {
        allIndices.push(idx + vertexOffset);
      }
    }

    xCursor += (m.glyphs[i].advanceWidth ?? 0) * invEm;
    if (i < m.glyphs.length - 1) {
      xCursor += font.getKerningValue(m.glyphs[i], m.glyphs[i + 1]) * invEm;
    }
  }

  if (allPositions.length >= 9 && allIndices.length >= 3) {
    collector.addMesh(layer, color, allPositions, allIndices);
  }
}
