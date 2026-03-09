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

/** Cache for measureText results keyed by "fontFamily::text" */
const measureTextCache = new Map<string, TextMetrics>();

/** Clear measureText cache (call between file reloads to prevent unbounded growth) */
export function clearMeasureTextCache(): void {
  measureTextCache.clear();
}

/**
 * Measure text: collect glyphs, compute total advance and visual bounds.
 * All values are in font units (divide by unitsPerEm to normalize).
 * Results are cached by font+text key.
 */
function measureText(font: Font, text: string): TextMetrics {
  const cacheKey = (font.names?.fontFamily?.en ?? "font") + "::" + text;
  const cached = measureTextCache.get(cacheKey);
  if (cached) return cached;
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

  const result: TextMetrics = {
    glyphs,
    glyphData: glyphDataArr,
    totalAdvance,
    bounds: { xMin, xMax, yMin, yMax },
  };
  measureTextCache.set(cacheKey, result);
  return result;
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
  // DXF height = cap height; scale to em units for correct measurement
  const capRatio = getCapHeightRatio(font);
  return (m.bounds.xMax - m.bounds.xMin) * (height / capRatio) * widthFactor;
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
  underline?: boolean;
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

  // DXF text height = cap height (visual height of uppercase letters).
  // Font glyph data is normalized to em square (unitsPerEm = 1), so we need
  // to scale by height/capHeightRatio to make cap height match DXF height.
  const capRatio = getCapHeightRatio(font);
  const emScale = height / capRatio;
  let scaleX = emScale * widthFactor;
  let scaleY = emScale;

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

  // Emit underline line segment below text
  if (p.underline && m.totalAdvance > 0) {
    const ulX1 = (m.bounds.xMin - originX) * scaleX;
    const ulX2 = (m.bounds.xMax - originX) * scaleX;
    const ulLocalY = (-UNDERLINE_OFFSET - originY) * scaleY;

    let wx1 = posX + ulX1 * cos - ulLocalY * sin;
    let wy1 = posY + ulX1 * sin + ulLocalY * cos;
    let wz1 = posZ;
    let wx2 = posX + ulX2 * cos - ulLocalY * sin;
    let wy2 = posY + ulX2 * sin + ulLocalY * cos;
    let wz2 = posZ;

    if (transform) {
      const t1x = transform[0] * wx1 + transform[4] * wy1 + transform[8] * wz1 + transform[12];
      const t1y = transform[1] * wx1 + transform[5] * wy1 + transform[9] * wz1 + transform[13];
      const t1z = transform[2] * wx1 + transform[6] * wy1 + transform[10] * wz1 + transform[14];
      wx1 = t1x; wy1 = t1y; wz1 = t1z;
      const t2x = transform[0] * wx2 + transform[4] * wy2 + transform[8] * wz2 + transform[12];
      const t2y = transform[1] * wx2 + transform[5] * wy2 + transform[9] * wz2 + transform[13];
      const t2z = transform[2] * wx2 + transform[6] * wy2 + transform[10] * wz2 + transform[14];
      wx2 = t2x; wy2 = t2y; wz2 = t2z;
    }

    collector.addLineSegments(layer, color, [wx1, wy1, wz1, wx2, wy2, wz2]);
  }
}

// ── Faux bold/italic constants ─────────────────────────────────────────

/** Default cap height ratio when OS/2 table is unavailable */
const DEFAULT_CAP_HEIGHT_RATIO = 0.7;

/** Cache for per-font cap height ratio */
const capHeightCache = new WeakMap<Font, number>();

/**
 * Get the cap height ratio (capHeight / unitsPerEm) for a font.
 * DXF text height defines the cap height (height of uppercase letters),
 * so we scale by 1/capHeightRatio to convert from DXF height to em scale.
 */
function getCapHeightRatio(font: Font): number {
  let ratio = capHeightCache.get(font);
  if (ratio !== undefined) return ratio;
  const os2 = (font as { tables?: { os2?: { sCapHeight?: number } } }).tables?.os2;
  const capHeight = os2?.sCapHeight;
  ratio = (capHeight && capHeight > 0 && font.unitsPerEm > 0)
    ? capHeight / font.unitsPerEm
    : DEFAULT_CAP_HEIGHT_RATIO;
  capHeightCache.set(font, ratio);
  return ratio;
}

/** Italic slant: tan(12°) ≈ 0.2126 */
const ITALIC_SLANT = Math.tan((12 * Math.PI) / 180);
/** Bold offset as fraction of height (normalized units) */
const BOLD_OFFSET = 0.02;
/** Underline position below baseline as fraction of height (normalized units) */
const UNDERLINE_OFFSET = 0.15;

// ── MTEXT support ──────────────────────────────────────────────────────

/** DXF standard MTEXT line spacing: factor * 5/3 of text height */
const DXF_LINE_SPACING_BASE = 5 / 3;
const STACKED_RATIO = 0.6;
/** Small gap between main text and stacked fraction, as ratio of height */
const STACKED_H_GAP = 0.1;
/**
 * AutoCAD default MTEXT tab stop multiplier: 4 × textHeight.
 * With an Arial-compatible font (Liberation Sans) this matches AutoCAD behaviour.
 */
const TAB_STOP_MULTIPLIER = 4;

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
 * Uses incremental advance accumulation O(n) instead of re-measuring the full line O(n²).
 */
function wrapTextToWidth(font: Font, text: string, height: number, maxWidth: number): string[] {
  if (!text) return [text];
  const words = text.split(" ");
  if (words.length <= 1) return [text];

  const emScale = height / getCapHeightRatio(font);
  const spaceAdv = measureText(font, " ").totalAdvance;

  const lines: string[] = [];
  let currentLine = words[0];
  let lineAdv = measureText(font, words[0]).totalAdvance;

  for (let i = 1; i < words.length; i++) {
    const wordAdv = measureText(font, words[i]).totalAdvance;
    const testAdv = lineAdv + spaceAdv + wordAdv;
    // 2% tolerance: font metric rounding (sCapHeight override, advance precision)
    // can make text slightly wider than the original AutoCAD measurement
    if (testAdv * emScale > maxWidth * 1.02 && currentLine.length > 0) {
      lines.push(currentLine);
      currentLine = words[i];
      lineAdv = wordAdv;
    } else {
      currentLine += " " + words[i];
      lineAdv = testAdv;
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

  // Measure advance widths in world units (using em scale for cap height correction)
  const capRatio = getCapHeightRatio(font);
  const mainEmScale = height / capRatio;
  const stackedEmScale = stackedHeight / capRatio;
  const mainAdvance = mainText ? measureText(font, mainText).totalAdvance * mainEmScale : 0;
  const topAdvance = stackedTop ? measureText(font, stackedTop).totalAdvance * stackedEmScale : 0;
  const bottomAdvance = stackedBottom
    ? measureText(font, stackedBottom).totalAdvance * stackedEmScale
    : 0;
  const stackedWidth = Math.max(topAdvance, bottomAdvance);
  const gap = mainText ? mainEmScale * STACKED_H_GAP : 0;
  const totalWidth = mainAdvance + gap + stackedWidth;

  // Horizontal alignment offset (in local text direction)
  let offsetX = 0;
  if (hAlign === "center") offsetX = -totalWidth / 2;
  else if (hAlign === "right") offsetX = -totalWidth;

  // Visual center of the main text line
  const normAsc = font.ascender / font.unitsPerEm;
  const halfAsc = normAsc * mainEmScale * 0.5;
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

  // 1. Tab expansion + Word wrapping
  // Tab stop = 4 × textHeight (AutoCAD default)
  const tabStopWidth = TAB_STOP_MULTIPLIER * defaultHeight;
  const expandedLines: MTextLine[] = [];
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    // Skip wrapping for stacked lines (typically short fractions)
    if (line.stackedTop || line.stackedBottom) {
      expandedLines.push(line);
      continue;
    }

    let processedText = line.text;
    const hadTabs = processedText.includes("\t");

    // Tab-containing lines define columnar layout (tables, schedules).
    // Keep \t characters — they will be rendered at exact tab stop positions.
    // Strip trailing tabs — they are column-width padding, not visible content.
    if (hadTabs) {
      processedText = processedText.replace(/\t+$/, "");
    }

    // Word wrap (only when width constraint is set and line has no tabs)
    if (!hadTabs && width && width > 0) {
      const lineHeight = line.height || defaultHeight;
      const margin = line.leftMargin || 0;
      const effectiveWidth = width - margin;
      const wrapped = wrapTextToWidth(font, processedText, lineHeight, effectiveWidth > 0 ? effectiveWidth : width);
      for (let wi = 0; wi < wrapped.length; wi++) {
        expandedLines.push({
          ...line,
          text: wrapped[wi],
          // Only first wrapped line gets firstIndent
          firstIndent: wi === 0 ? line.firstIndent : undefined,
        });
      }
    } else {
      expandedLines.push({ ...line, text: processedText });
    }
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
    } else if (line.text.includes("\t")) {
      // Render tab-separated segments at exact tab stop positions.
      // Tab grid = multiples of tabStopWidth (4 × defaultHeight).
      // With sCapHeight overridden to match Arial, positions match AutoCAD exactly.
      const segments = line.text.split("\t");
      const emScale = lineHeight / getCapHeightRatio(lineFont);
      let segLocalX = 0;
      for (let si = 0; si < segments.length; si++) {
        if (segments[si]) {
          const segWX = worldX + segLocalX * cos;
          const segWY = worldY + segLocalX * sin;
          addTextToCollector({
            collector, layer, color: lineColor, font: lineFont,
            text: segments[si], height: lineHeight,
            posX: segWX, posY: segWY, posZ,
            rotation, hAlign: HAlign.LEFT, vAlign: rowVAlign,
            bold: line.bold, italic: line.italic,
            underline: line.underline,
          });
          segLocalX += measureText(lineFont, segments[si]).totalAdvance * emScale;
        }
        // Advance to next tab stop after each segment except the last
        if (si < segments.length - 1) {
          segLocalX = Math.ceil((segLocalX + 1e-6) / tabStopWidth) * tabStopWidth;
        }
      }
    } else {
      addTextToCollector({
        collector, layer, color: lineColor, font: lineFont,
        text: line.text, height: lineHeight,
        posX: worldX, posY: worldY, posZ,
        rotation, hAlign: hAlignEnum, vAlign: rowVAlign,
        bold: line.bold, italic: line.italic,
        underline: line.underline,
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
    const suffixText = stackedMatch[4]?.trim() || "";

    const stackedHeight = height * STACKED_RATIO;
    const capRatio = getCapHeightRatio(font);
    const mainEmScale = height / capRatio;
    const stackedEmScale = stackedHeight / capRatio;
    const mainAdvance = mainText ? measureText(font, mainText).totalAdvance * mainEmScale : 0;
    const topAdvance = topText ? measureText(font, topText).totalAdvance * stackedEmScale : 0;
    const bottomAdvance = bottomText
      ? measureText(font, bottomText).totalAdvance * stackedEmScale
      : 0;
    const stackedWidth = Math.max(topAdvance, bottomAdvance);
    const gap = mainText ? mainEmScale * STACKED_H_GAP : 0;
    const suffixAdvance = suffixText ? measureText(font, suffixText).totalAdvance * mainEmScale : 0;

    return mainAdvance + gap + stackedWidth + suffixAdvance;
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
    const suffixText = stackedMatch[4]?.trim() || "";
    const stackedHeight = height * STACKED_RATIO;

    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    // Measure widths to compute horizontal alignment (using em scale)
    const capRatio = getCapHeightRatio(font);
    const mainEmScale = height / capRatio;
    const stackedEmScale = stackedHeight / capRatio;
    const mainAdvance = mainText ? measureText(font, mainText).totalAdvance * mainEmScale : 0;
    const topAdvance = topText ? measureText(font, topText).totalAdvance * stackedEmScale : 0;
    const bottomAdvance = bottomText
      ? measureText(font, bottomText).totalAdvance * stackedEmScale
      : 0;
    const stackedWidth = Math.max(topAdvance, bottomAdvance);
    const gap = mainText ? mainEmScale * STACKED_H_GAP : 0;
    const suffixAdvance = suffixText ? measureText(font, suffixText).totalAdvance * mainEmScale : 0;
    const totalWidth = mainAdvance + gap + stackedWidth + suffixAdvance;

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
    // Extra gap so digits don't touch the horizontal separator line.
    const vGap = mainEmScale * 0.12;
    const topMetrics = topText ? measureText(font, topText) : null;
    const bottomMetrics = bottomText ? measureText(font, bottomText) : null;
    const topVisualH = topMetrics
      ? (topMetrics.bounds.yMax - topMetrics.bounds.yMin) * stackedEmScale
      : 0;
    const bottomVisualH = bottomMetrics
      ? (bottomMetrics.bounds.yMax - bottomMetrics.bounds.yMin) * stackedEmScale
      : 0;
    const totalStackH = topVisualH + vGap + bottomVisualH;
    const halfStack = totalStackH / 2;

    if (topText && topMetrics) {
      const topBaseY = halfStack - topMetrics.bounds.yMax * stackedEmScale;
      const topCenterX = (stackedWidth - topAdvance) / 2;
      const topX = curX + topCenterX * cos - topBaseY * sin;
      const topY = curY + topCenterX * sin + topBaseY * cos;
      addTextToCollector({
        collector, layer, color, font, text: topText, height: stackedHeight,
        posX: topX, posY: topY, posZ,
        rotation, hAlign: HAlign.LEFT, vAlign: VAlign.BASELINE,
        transform,
      });
    }

    if (bottomText && bottomMetrics) {
      const bottomBaseY = -halfStack - bottomMetrics.bounds.yMin * stackedEmScale;
      const bottomCenterX = (stackedWidth - bottomAdvance) / 2;
      const bottomX = curX + bottomCenterX * cos - bottomBaseY * sin;
      const bottomY = curY + bottomCenterX * sin + bottomBaseY * cos;
      addTextToCollector({
        collector, layer, color, font, text: bottomText, height: stackedHeight,
        posX: bottomX, posY: bottomY, posZ,
        rotation, hAlign: HAlign.LEFT, vAlign: VAlign.BASELINE,
        transform,
      });
    }

    // Horizontal separator line between numerator and denominator
    // Line extends slightly beyond digits (overshoot) and is centered
    if (topText && bottomText) {
      const overshoot = stackedWidth * 0.08;
      const lineX1 = -overshoot;
      const lineX2 = stackedWidth + overshoot;
      let wx1 = curX + lineX1 * cos;
      let wy1 = curY + lineX1 * sin;
      let wz1 = posZ;
      let wx2 = curX + lineX2 * cos;
      let wy2 = curY + lineX2 * sin;
      let wz2 = posZ;
      if (transform) {
        const t1x = transform[0] * wx1 + transform[4] * wy1 + transform[8] * wz1 + transform[12];
        const t1y = transform[1] * wx1 + transform[5] * wy1 + transform[9] * wz1 + transform[13];
        const t1z = transform[2] * wx1 + transform[6] * wy1 + transform[10] * wz1 + transform[14];
        wx1 = t1x; wy1 = t1y; wz1 = t1z;
        const t2x = transform[0] * wx2 + transform[4] * wy2 + transform[8] * wz2 + transform[12];
        const t2y = transform[1] * wx2 + transform[5] * wy2 + transform[9] * wz2 + transform[13];
        const t2z = transform[2] * wx2 + transform[6] * wy2 + transform[10] * wz2 + transform[14];
        wx2 = t2x; wy2 = t2y; wz2 = t2z;
      }
      collector.addLineSegments(layer, color, [wx1, wy1, wz1, wx2, wy2, wz2]);
    }

    // Suffix text after stacked fraction (e.g. the " in 9\S1/2;")
    if (suffixText) {
      const suffX = curX + stackedWidth * cos;
      const suffY = curY + stackedWidth * sin;
      addTextToCollector({
        collector, layer, color, font, text: suffixText, height,
        posX: suffX, posY: suffY, posZ,
        rotation, hAlign: HAlign.LEFT, vAlign: VAlign.MIDDLE,
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
