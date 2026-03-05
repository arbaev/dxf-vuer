import type { Font, Glyph } from "opentype.js";
import { getTriangulatedGlyph, type GlyphData } from "./glyphCache";
import type { GeometryCollector } from "./mergeCollectors";
import type { MTextLine } from "./text";
import { cleanDimensionMText } from "./dimensions";
import { classifyFont } from "./fontClassifier";

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

    // Use GlyphData advance (correct for both font and custom glyphs)
    totalAdvance += gd ? gd.advance : (glyphs[i].advanceWidth ?? 0) * invEm;
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

// ── Parameter interfaces ──────────────────────────────────────────────

export interface TextParams {
  collector: GeometryCollector;
  layer: string;
  color: string;
  font: Font;
  text: string;
  height: number;
  posX: number;
  posY: number;
  posZ: number;
  rotation?: number;
  hAlign?: number;
  vAlign?: number;
  widthFactor?: number;
  endPosX?: number;
  endPosY?: number;
  transform?: readonly number[];
  bold?: boolean;
  italic?: boolean;
  obliqueAngle?: number;
}

export interface MTextParams {
  collector: GeometryCollector;
  layer: string;
  color: string;
  font: Font;
  lines: MTextLine[];
  defaultHeight: number;
  posX: number;
  posY: number;
  posZ: number;
  rotation?: number;
  attachmentPoint?: number;
  width?: number;
  serifFont?: Font;
  lineSpacingFactor?: number;
}

export interface DimensionTextParams {
  collector: GeometryCollector;
  layer: string;
  color: string;
  font: Font;
  rawText: string;
  height: number;
  posX: number;
  posY: number;
  posZ: number;
  rotation?: number;
  hAlign?: "left" | "center" | "right";
  transform?: readonly number[];
}

// ── addTextToCollector ────────────────────────────────────────────────

/**
 * Add TEXT entity glyphs to GeometryCollector as triangulated mesh.
 */
export function addTextToCollector(p: TextParams): void {
  const {
    collector, layer, color, font, text, height,
    posZ, transform, bold,
    widthFactor = 1,
    hAlign = HAlign.LEFT,
    vAlign = VAlign.BASELINE,
    endPosX, endPosY,
    obliqueAngle, italic,
  } = p;
  let { posX, posY, rotation = 0 } = p;
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

  // Oblique angle shear: obliqueAngle (degrees) > faux italic > none
  const shear = obliqueAngle ? Math.tan((obliqueAngle * Math.PI) / 180) : (italic ? ITALIC_SLANT : 0);

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
        const glyphX = gd.positions[j] + xCursor - originX;
        const glyphY = gd.positions[j + 1] - originY;
        // Oblique / italic shear X by Y
        const localX = (shear ? glyphX + glyphY * shear : glyphX) * scaleX;
        const localY = glyphY * scaleY;
        // Rotation + translation to world coordinates
        let wx = posX + localX * cos - localY * sin;
        let wy = posY + localX * sin + localY * cos;
        let wz = posZ;
        // Apply block INSERT transform if provided (Matrix4 elements)
        if (transform) {
          const tx = transform[0] * wx + transform[4] * wy + transform[8] * wz + transform[12];
          const ty = transform[1] * wx + transform[5] * wy + transform[9] * wz + transform[13];
          const tz = transform[2] * wx + transform[6] * wy + transform[10] * wz + transform[14];
          wx = tx;
          wy = ty;
          wz = tz;
        }
        allPositions.push(wx, wy, wz);
      }

      for (const idx of gd.indices) {
        allIndices.push(idx + vertexOffset);
      }

      // Faux bold: duplicate triangles shifted along text direction
      if (bold) {
        const boldVertexOffset = allPositions.length / 3;
        for (let j = 0; j < gd.positions.length; j += 3) {
          const glyphX = gd.positions[j] + xCursor - originX;
          const glyphY = gd.positions[j + 1] - originY;
          const localX =
            ((shear ? glyphX + glyphY * shear : glyphX) + BOLD_OFFSET) * scaleX;
          const localY = glyphY * scaleY;
          let wx = posX + localX * cos - localY * sin;
          let wy = posY + localX * sin + localY * cos;
          let wz = posZ;
          if (transform) {
            const tx = transform[0] * wx + transform[4] * wy + transform[8] * wz + transform[12];
            const ty = transform[1] * wx + transform[5] * wy + transform[9] * wz + transform[13];
            const tz = transform[2] * wx + transform[6] * wy + transform[10] * wz + transform[14];
            wx = tx;
            wy = ty;
            wz = tz;
          }
          allPositions.push(wx, wy, wz);
        }
        for (const idx of gd.indices) {
          allIndices.push(idx + boldVertexOffset);
        }
      }
    }

    // Use GlyphData advance (correct for both font and custom glyphs)
    xCursor += gd ? gd.advance : (m.glyphs[i].advanceWidth ?? 0) * invEm;
    if (i < m.glyphs.length - 1) {
      xCursor += font.getKerningValue(m.glyphs[i], m.glyphs[i + 1]) * invEm;
    }
  }

  if (allPositions.length >= 9 && allIndices.length >= 3) {
    collector.addMesh(layer, color, allPositions, allIndices);
  }
}

// ── Faux bold/italic constants ─────────────────────────────────────────

/** Italic slant: tan(12°) ≈ 0.2126 */
const ITALIC_SLANT = Math.tan((12 * Math.PI) / 180);
/** Bold offset as fraction of height (normalized units) */
const BOLD_OFFSET = 0.02;

// ── MTEXT support ──────────────────────────────────────────────────────

/** DXF standard MTEXT line spacing: factor * 5/3 of text height */
const DXF_LINE_SPACING_BASE = 5 / 3;
const STACKED_RATIO = 0.6;
/** Small gap between main text and stacked fraction, as ratio of height */
const STACKED_H_GAP = 0.1;

/**
 * Map MTEXT horizontal alignment string to HAlign enum.
 */
function mtextHAlignToEnum(hAlign: "left" | "center" | "right"): number {
  if (hAlign === "center") return HAlign.CENTER;
  if (hAlign === "right") return HAlign.RIGHT;
  return HAlign.LEFT;
}

/**
 * Word wrap text to fit within a maximum width (in world units).
 * Splits by spaces; single words wider than maxWidth stay on their own line.
 */
function wrapTextToWidth(font: Font, text: string, height: number, maxWidth: number): string[] {
  if (!text) return [text];
  const words = text.split(" ");
  if (words.length <= 1) return [text];

  const lines: string[] = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const testLine = currentLine + " " + words[i];
    const m = measureText(font, testLine);
    // totalAdvance is normalized (unitsPerEm=1), multiply by height for world units
    if (m.totalAdvance * height > maxWidth && currentLine.length > 0) {
      lines.push(currentLine);
      currentLine = words[i];
    } else {
      currentLine = testLine;
    }
  }
  lines.push(currentLine);
  return lines;
}

interface StackedTextParams {
  collector: GeometryCollector;
  layer: string;
  color: string;
  font: Font;
  mainText: string;
  stackedTop: string;
  stackedBottom: string;
  height: number;
  posX: number;
  posY: number;
  posZ: number;
  rotation: number;
  hAlign: "left" | "center" | "right";
  transform?: readonly number[];
  bold?: boolean;
  italic?: boolean;
}

/**
 * Emit stacked text (main text + fraction) into collector.
 * Handles horizontal alignment for the combined width.
 */
function emitStackedText(p: StackedTextParams): void {
  const {
    collector, layer, color, font,
    mainText, stackedTop, stackedBottom,
    height, posX, posY, posZ, rotation, hAlign,
    transform, bold, italic,
  } = p;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const stackedHeight = height * STACKED_RATIO;

  // Measure advance widths in world units
  const mainAdvance = mainText ? measureText(font, mainText).totalAdvance * height : 0;
  const topAdvance = stackedTop ? measureText(font, stackedTop).totalAdvance * stackedHeight : 0;
  const bottomAdvance = stackedBottom
    ? measureText(font, stackedBottom).totalAdvance * stackedHeight
    : 0;
  const stackedWidth = Math.max(topAdvance, bottomAdvance);
  const gap = mainText ? height * STACKED_H_GAP : 0;
  const totalWidth = mainAdvance + gap + stackedWidth;

  // Horizontal alignment offset (in local text direction)
  let offsetX = 0;
  if (hAlign === "center") offsetX = -totalWidth / 2;
  else if (hAlign === "right") offsetX = -totalWidth;

  // Visual center of the main text line
  const normAsc = font.ascender / font.unitsPerEm;
  const halfAsc = normAsc * height * 0.5;
  // Center point: shift down from top by halfAsc
  const centerOffsetY = -halfAsc;
  const centerX = posX - centerOffsetY * sin;
  const centerY = posY + centerOffsetY * cos;

  // Start position with alignment offset applied in rotated direction
  let curX = centerX + offsetX * cos;
  let curY = centerY + offsetX * sin;

  // Emit main text (LEFT-aligned, vertically centered on the stacked block center)
  if (mainText) {
    addTextToCollector({
      collector, layer, color, font, text: mainText, height,
      posX: curX, posY: curY, posZ,
      rotation, hAlign: HAlign.LEFT, vAlign: VAlign.MIDDLE,
      transform, bold, italic,
    });
    curX += (mainAdvance + gap) * cos;
    curY += (mainAdvance + gap) * sin;
  }
  // Gap between top and bottom fractions (in world units)
  const vGap = height * 0.02;

  // Top fraction: baseline positioned above center
  if (stackedTop) {
    const topOffsetY = vGap;
    const topX = curX - topOffsetY * sin;
    const topY = curY + topOffsetY * cos;
    addTextToCollector({
      collector, layer, color, font, text: stackedTop, height: stackedHeight,
      posX: topX, posY: topY, posZ,
      rotation, hAlign: HAlign.LEFT, vAlign: VAlign.BASELINE,
      transform, bold, italic,
    });
  }

  // Bottom fraction: baseline positioned below center
  if (stackedBottom) {
    const stackedAsc = normAsc * stackedHeight;
    const bottomOffsetY = -vGap - stackedAsc;
    const bottomX = curX - bottomOffsetY * sin;
    const bottomY = curY + bottomOffsetY * cos;
    addTextToCollector({
      collector, layer, color, font, text: stackedBottom, height: stackedHeight,
      posX: bottomX, posY: bottomY, posZ,
      rotation, hAlign: HAlign.LEFT, vAlign: VAlign.BASELINE,
      transform, bold, italic,
    });
  }
}

/**
 * Add MTEXT entity lines to GeometryCollector as triangulated mesh.
 * Handles multiline text with word wrapping, 9 attachment points,
 * stacked text (fractions), and per-line color/height overrides.
 */
export function addMTextToCollector(p: MTextParams): void {
  const {
    collector, layer, color, font, lines, defaultHeight,
    posX, posY, posZ,
    rotation = 0,
    attachmentPoint = 1,
    width, serifFont, lineSpacingFactor,
  } = p;
  if (lines.length === 0 || defaultHeight <= 0) return;
  const lineSpacing = (lineSpacingFactor || 1) * DXF_LINE_SPACING_BASE;

  // 1. Word wrapping: expand lines if width constraint is set
  const expandedLines: MTextLine[] = [];
  if (width && width > 0) {
    for (const line of lines) {
      // Skip wrapping for stacked lines (typically short fractions)
      if (line.stackedTop || line.stackedBottom) {
        expandedLines.push(line);
        continue;
      }
      const lineHeight = line.height || defaultHeight;
      const margin = line.leftMargin || 0;
      const effectiveWidth = width - margin;
      const wrapped = wrapTextToWidth(font, line.text, lineHeight, effectiveWidth > 0 ? effectiveWidth : width);
      for (let wi = 0; wi < wrapped.length; wi++) {
        expandedLines.push({
          ...line,
          text: wrapped[wi],
          // Only first wrapped line gets firstIndent
          firstIndent: wi === 0 ? line.firstIndent : undefined,
        });
      }
    }
  } else {
    expandedLines.push(...lines);
  }

  if (expandedLines.length === 0) return;

  // 2. Compute total block height
  let totalHeight = 0;
  for (const line of expandedLines) {
    totalHeight += (line.height || defaultHeight) * lineSpacing;
  }
  // Remove trailing spacing from last line
  const lastLineHeight = expandedLines[expandedLines.length - 1].height || defaultHeight;
  totalHeight = totalHeight - lastLineHeight * lineSpacing + lastLineHeight;

  // 3. Determine alignment from attachment point (1-9)
  const col = (attachmentPoint - 1) % 3; // 0=left, 1=center, 2=right
  const row = Math.ceil(attachmentPoint / 3); // 1=top, 2=middle, 3=bottom
  const hAlign: "left" | "center" | "right" = col === 1 ? "center" : col === 2 ? "right" : "left";

  // Vertical offset and VAlign depend on the attachment row.
  let groupYOffset = 0;
  let rowVAlign = VAlign.TOP;
  if (row === 2) {
    groupYOffset = (totalHeight - lastLineHeight) / 2;
    rowVAlign = VAlign.MIDDLE;
  } else if (row === 3) {
    groupYOffset = totalHeight - lastLineHeight;
    rowVAlign = VAlign.BOTTOM;
  }

  // 4. Emit each line
  const hAlignEnum = mtextHAlignToEnum(hAlign);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  let lineYOffset = 0; // accumulates downward (negative Y in local coords)

  for (const line of expandedLines) {
    const lineHeight = line.height || defaultHeight;
    const lineColor = line.color || color;

    // Per-line font: use inline \f fontFamily to pick sans/serif
    let lineFont = font;
    if (serifFont && line.fontFamily) {
      lineFont = classifyFont(line.fontFamily) === "serif" ? serifFont : font;
    }

    // Paragraph indentation: leftMargin + firstIndent (in drawing units)
    const indentX = (line.leftMargin || 0) + (line.firstIndent || 0);

    // Local offset from insertion point (in text-local coordinates)
    const localY = groupYOffset + lineYOffset;

    // Apply rotation to get world position, including paragraph indent
    const worldX = posX - localY * sin + indentX * cos;
    const worldY = posY + localY * cos + indentX * sin;

    if (line.stackedTop || line.stackedBottom) {
      emitStackedText({
        collector, layer, color: lineColor, font: lineFont,
        mainText: line.text, stackedTop: line.stackedTop || "", stackedBottom: line.stackedBottom || "",
        height: lineHeight, posX: worldX, posY: worldY, posZ, rotation, hAlign,
        bold: line.bold, italic: line.italic,
      });
    } else {
      addTextToCollector({
        collector, layer, color: lineColor, font: lineFont,
        text: line.text, height: lineHeight,
        posX: worldX, posY: worldY, posZ,
        rotation, hAlign: hAlignEnum, vAlign: rowVAlign,
        bold: line.bold, italic: line.italic,
      });
    }

    lineYOffset -= lineHeight * lineSpacing;
  }
}

// ── DIMENSION text support ──────────────────────────────────────────────

/** Stacked fraction regex: prefix \S top^bottom; or top/bottom; or top#bottom; suffix */
const STACKED_REGEX = /^(.*?)\\S([^^/#;]*)[\^/#]([^;]*);(.*)$/;

/**
 * Measure dimension text width in world units.
 * Cleans MTEXT formatting, handles stacked fractions (\S).
 */
export function measureDimensionTextWidth(font: Font, rawText: string, height: number): number {
  const cleaned = cleanDimensionMText(rawText);
  const stackedMatch = cleaned.match(STACKED_REGEX);

  if (stackedMatch) {
    const mainText = stackedMatch[1].trim();
    const topText = stackedMatch[2].trim();
    const bottomText = stackedMatch[3].trim();

    const stackedHeight = height * STACKED_RATIO;
    const mainAdvance = mainText ? measureText(font, mainText).totalAdvance * height : 0;
    const topAdvance = topText ? measureText(font, topText).totalAdvance * stackedHeight : 0;
    const bottomAdvance = bottomText
      ? measureText(font, bottomText).totalAdvance * stackedHeight
      : 0;
    const stackedWidth = Math.max(topAdvance, bottomAdvance);
    const gap = mainText ? height * STACKED_H_GAP : 0;

    return mainAdvance + gap + stackedWidth;
  }

  // Plain text: strip remaining \S patterns
  const plain = cleaned.replace(/\\S[^;]*;/g, "").trim();
  return measureTextWidth(font, plain, height);
}

/**
 * Add DIMENSION text to GeometryCollector as triangulated mesh.
 * Cleans MTEXT formatting, applies baseline gap above the dimension line,
 * and handles stacked fractions (\S format).
 */
export function addDimensionTextToCollector(p: DimensionTextParams): void {
  const {
    collector, layer, color, font, rawText, height,
    posX, posY, posZ,
    rotation = 0,
    hAlign = "center",
    transform,
  } = p;
  const cleaned = cleanDimensionMText(rawText);
  if (!cleaned.trim() || height <= 0) return;

  const stackedMatch = cleaned.match(STACKED_REGEX);

  if (stackedMatch) {
    const mainText = stackedMatch[1].trim();
    const topText = stackedMatch[2].trim();
    const bottomText = stackedMatch[3].trim();
    const stackedHeight = height * STACKED_RATIO;

    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    // Measure widths to compute horizontal alignment
    const mainAdvance = mainText ? measureText(font, mainText).totalAdvance * height : 0;
    const topAdvance = topText ? measureText(font, topText).totalAdvance * stackedHeight : 0;
    const bottomAdvance = bottomText
      ? measureText(font, bottomText).totalAdvance * stackedHeight
      : 0;
    const stackedWidth = Math.max(topAdvance, bottomAdvance);
    const gap = mainText ? height * STACKED_H_GAP : 0;
    const totalWidth = mainAdvance + gap + stackedWidth;

    // Horizontal alignment offset
    let offsetX = 0;
    if (hAlign === "center") offsetX = -totalWidth / 2;
    else if (hAlign === "right") offsetX = -totalWidth;

    let curX = posX + offsetX * cos;
    let curY = posY + offsetX * sin;

    // Emit main text centered on posY
    if (mainText) {
      addTextToCollector({
        collector, layer, color, font, text: mainText, height,
        posX: curX, posY: curY, posZ,
        rotation, hAlign: HAlign.LEFT, vAlign: VAlign.MIDDLE,
        transform,
      });
      curX += (mainAdvance + gap) * cos;
      curY += (mainAdvance + gap) * sin;
    }

    // Fractions: centered vertically around posY (= dimension midpoint).
    const vGap = height * 0.04;
    const topMetrics = topText ? measureText(font, topText) : null;
    const bottomMetrics = bottomText ? measureText(font, bottomText) : null;
    const topVisualH = topMetrics
      ? (topMetrics.bounds.yMax - topMetrics.bounds.yMin) * stackedHeight
      : 0;
    const bottomVisualH = bottomMetrics
      ? (bottomMetrics.bounds.yMax - bottomMetrics.bounds.yMin) * stackedHeight
      : 0;
    const totalStackH = topVisualH + vGap + bottomVisualH;
    const halfStack = totalStackH / 2;

    if (topText && topMetrics) {
      const topBaseY = halfStack - topMetrics.bounds.yMax * stackedHeight;
      const topX = curX - topBaseY * sin;
      const topY = curY + topBaseY * cos;
      addTextToCollector({
        collector, layer, color, font, text: topText, height: stackedHeight,
        posX: topX, posY: topY, posZ,
        rotation, hAlign: HAlign.LEFT, vAlign: VAlign.BASELINE,
        transform,
      });
    }

    if (bottomText && bottomMetrics) {
      const bottomBaseY = -halfStack - bottomMetrics.bounds.yMin * stackedHeight;
      const bottomX = curX - bottomBaseY * sin;
      const bottomY = curY + bottomBaseY * cos;
      addTextToCollector({
        collector, layer, color, font, text: bottomText, height: stackedHeight,
        posX: bottomX, posY: bottomY, posZ,
        rotation, hAlign: HAlign.LEFT, vAlign: VAlign.BASELINE,
        transform,
      });
    }
  } else {
    const plain = cleaned.replace(/\\S[^;]*;/g, "").trim();
    if (!plain) return;

    const hAlignEnum = mtextHAlignToEnum(hAlign);
    addTextToCollector({
      collector, layer, color, font, text: plain, height,
      posX, posY, posZ,
      rotation, hAlign: hAlignEnum, vAlign: VAlign.MIDDLE,
      transform,
    });
  }
}
