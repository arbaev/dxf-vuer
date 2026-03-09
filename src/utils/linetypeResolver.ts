import type { DxfEntity, DxfLayer, DxfLineType } from "@/types/dxf";
import type { DxfHeader } from "@/types/header";
import { AUTO_LTSCALE_DIVISOR, AUTO_LTSCALE_MIN_EXTENT } from "@/constants";

/** If the smallest LTYPE cycle is at least this fraction of maxExtent, patterns are already visible */
const AUTO_LTSCALE_PATTERN_THRESHOLD = 0.005;

export interface LinetypeInfo {
  /** Scaled DXF pattern: positive = dash, negative = gap, 0 = dot */
  pattern: number[];
}

/** Result of applying a linetype pattern to a polyline */
export interface PatternGeometry {
  /** Flat xyz pairs for LineSegments: [x1,y1,z1, x2,y2,z2, ...] */
  segments: number[];
  /** Flat xyz positions for Points (dots): [x1,y1,z1, x2,y2,z2, ...] */
  dots: number[];
}

/**
 * Scale a DXF LTYPE pattern by entityScale * globalLtScale.
 * Zero elements (dots) remain zero — handled as MIN_DASH_SIZE at render time.
 */
export function scalePattern(
  pattern: number[],
  entityScale = 1,
  globalLtScale = 1,
): number[] {
  if (!pattern || pattern.length === 0) return [];
  const scale = entityScale * globalLtScale;
  return pattern.map((v) => (v === 0 ? 0 : v * scale));
}

/**
 * Walk along a polyline and split it into dash segments and dot positions
 * according to a DXF pattern.
 *
 * - Dashes (positive values) → LineSegments vertex pairs
 * - Dots (zero values) → Point positions (rendered as THREE.Points)
 * - Gaps (negative values) → skipped
 *
 * @param points - polyline vertices
 * @param pattern - scaled DXF pattern: positive = dash, negative = gap, 0 = dot
 * @returns PatternGeometry with segments and dots, or empty arrays if invalid
 */
export function applyLinetypePattern(
  points: { x: number; y: number; z?: number }[],
  pattern: number[],
): PatternGeometry {
  const segments: number[] = [];
  const dots: number[] = [];
  const empty: PatternGeometry = { segments, dots };
  if (points.length < 2 || pattern.length === 0) return empty;
  if (!pattern.some((v) => v < 0)) return empty; // no gaps = solid

  let patIdx = 0;
  let elem = pattern[patIdx];
  const isDot = elem === 0;
  let drawing = elem >= 0 && !isDot;
  // For dots, remaining = 0 so they resolve immediately at current position
  let remaining = elem > 0 ? elem : (elem < 0 ? Math.abs(elem) : 0);

  let dashX = 0;
  let dashY = 0;
  let dashZ = 0;
  if (drawing) {
    dashX = points[0].x;
    dashY = points[0].y;
    dashZ = points[0].z ?? 0;
  } else if (isDot) {
    // Dot at the very start
    dots.push(points[0].x, points[0].y, points[0].z ?? 0);
    patIdx = (patIdx + 1) % pattern.length;
    elem = pattern[patIdx];
    drawing = elem > 0;
    remaining = elem > 0 ? elem : (elem < 0 ? Math.abs(elem) : 0);
    if (drawing) {
      dashX = points[0].x;
      dashY = points[0].y;
      dashZ = points[0].z ?? 0;
    }
  }

  for (let i = 0; i < points.length - 1; i++) {
    const p1x = points[i].x;
    const p1y = points[i].y;
    const p1z = points[i].z ?? 0;
    const p2x = points[i + 1].x;
    const p2y = points[i + 1].y;
    const p2z = points[i + 1].z ?? 0;
    const dx = p2x - p1x;
    const dy = p2y - p1y;
    const dz = p2z - p1z;
    const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (segLen < 1e-10) continue;

    const dirX = dx / segLen;
    const dirY = dy / segLen;
    const dirZ = dz / segLen;
    let consumed = 0;

    while (consumed < segLen - 1e-10) {
      const available = segLen - consumed;

      if (remaining <= available + 1e-10) {
        // Pattern element ends within this polyline segment
        consumed += remaining;
        const endX = p1x + dirX * consumed;
        const endY = p1y + dirY * consumed;
        const endZ = p1z + dirZ * consumed;

        if (drawing) {
          segments.push(dashX, dashY, dashZ, endX, endY, endZ);
        }

        // Advance to next pattern element
        patIdx = (patIdx + 1) % pattern.length;
        elem = pattern[patIdx];

        if (elem === 0) {
          // Dot at current position
          dots.push(endX, endY, endZ);
          // Immediately advance past the dot
          patIdx = (patIdx + 1) % pattern.length;
          elem = pattern[patIdx];
        }

        drawing = elem > 0;
        remaining = elem > 0 ? elem : (elem < 0 ? Math.abs(elem) : 0);

        if (drawing) {
          dashX = endX;
          dashY = endY;
          dashZ = endZ;
        }
      } else {
        // Pattern element extends beyond this polyline segment
        remaining -= available;
        consumed = segLen;
        if (drawing) {
          // Emit intermediate segment to preserve polyline shape
          segments.push(dashX, dashY, dashZ, p2x, p2y, p2z);
          dashX = p2x;
          dashY = p2y;
          dashZ = p2z;
        }
      }
    }
  }

  // Close any open dash at the end of the polyline (skip degenerate zero-length)
  if (drawing) {
    const last = points[points.length - 1];
    const lx = last.x;
    const ly = last.y;
    const lz = last.z ?? 0;
    const ex = lx - dashX;
    const ey = ly - dashY;
    const ez = lz - dashZ;
    if (ex * ex + ey * ey + ez * ez > 1e-20) {
      segments.push(dashX, dashY, dashZ, lx, ly, lz);
    }
  }

  return { segments, dots };
}

/**
 * Resolve the linetype for a DXF entity.
 * Priority: entity lineType > ByBlock > ByLayer > lookup in LTYPE table.
 * Returns null for CONTINUOUS or undefined linetypes (= solid line).
 */
export function resolveEntityLinetype(
  entity: DxfEntity,
  layers: Record<string, DxfLayer>,
  lineTypes: Record<string, DxfLineType>,
  globalLtScale = 1,
  blockLineType?: string,
  headerLtScale = 1,
): LinetypeInfo | null {
  let lineTypeName: string | undefined;

  const entityLt = entity.lineType;

  if (entityLt) {
    const upper = entityLt.toUpperCase();
    if (upper === "CONTINUOUS") return null;
    if (upper === "BYBLOCK") {
      lineTypeName = blockLineType;
    } else if (upper === "BYLAYER") {
      lineTypeName = undefined;
    } else {
      lineTypeName = entityLt;
    }
  }

  // Resolve from layer if not set or BYLAYER
  if (!lineTypeName) {
    const layerName = entity.layer;
    if (layerName && layers[layerName]?.lineType) {
      const layerLt = layers[layerName].lineType!;
      if (layerLt.toUpperCase() === "CONTINUOUS") return null;
      lineTypeName = layerLt;
    }
  }

  if (!lineTypeName) return null;

  // Case-insensitive lookup in LTYPE table
  const upperName = lineTypeName.toUpperCase();
  const ltDef = Object.values(lineTypes).find(
    (lt) => lt.name?.toUpperCase() === upperName,
  );

  if (!ltDef || !ltDef.pattern || ltDef.pattern.length === 0) return null;
  if (!ltDef.pattern.some((v) => v < 0)) return null; // no gaps = solid

  const entityScale = entity.lineTypeScale ?? 1;
  // When entity has explicit lineTypeScale, use original $LTSCALE (not auto-computed).
  // AutoLtScale is a heuristic for entities without explicit scale — applying it on top
  // of an already-large entity scale produces invisible patterns.
  const hasExplicitScale = entity.lineTypeScale != null;
  const effectiveScale = hasExplicitScale ? headerLtScale : globalLtScale;
  const scaled = scalePattern(ltDef.pattern, entityScale, effectiveScale);
  return { pattern: scaled };
}

/**
 * Compute an automatic LTSCALE from drawing extents ($EXTMIN / $EXTMAX).
 * When $LTSCALE is at its default value of 1, patterns defined in small
 * world units (e.g. 12.7 mm) are invisible on large drawings.
 * This function derives a scale that keeps patterns visible.
 *
 * When lineTypes are provided, the function checks whether patterns are
 * already large enough relative to the drawing — e.g. in drawings measured
 * in inches, the mm-based LTYPE values (6.35 for HIDDEN) are already
 * visible and don't need scaling.
 *
 * Returns 1 if header is missing, extents are absent, or the drawing
 * is small enough that no scaling is needed.
 */
export function computeAutoLtScale(
  header: DxfHeader | undefined,
  lineTypes?: Record<string, DxfLineType>,
): number {
  if (!header) return 1;

  const extMin = header.$EXTMIN;
  const extMax = header.$EXTMAX;

  if (!extMin || !extMax) return 1;

  // Invalid extents: min > max means uninitialized (AutoCAD default 1E+20 / -1E+20)
  if (extMin.x >= extMax.x || extMin.y >= extMax.y) return 1;

  const width = extMax.x - extMin.x;
  const height = extMax.y - extMin.y;
  const maxExtent = Math.max(width, height);

  if (maxExtent < AUTO_LTSCALE_MIN_EXTENT) return 1;

  // Check if any LTYPE pattern is already large enough relative to drawing extents.
  // If the largest pattern cycle is visible, the drawing uses units where patterns
  // make sense — no auto-scaling needed. Using max (not min) avoids false triggers
  // from xref-dependent linetypes with tiny pattern values.
  if (lineTypes) {
    let maxCycle = 0;
    for (const lt of Object.values(lineTypes)) {
      if (lt.pattern && lt.pattern.length > 0 && lt.pattern.some((v) => v < 0)) {
        const cycle = lt.pattern.reduce((sum, v) => sum + Math.abs(v), 0);
        if (cycle > maxCycle) maxCycle = cycle;
      }
    }
    if (maxCycle > 0 && maxCycle / maxExtent >= AUTO_LTSCALE_PATTERN_THRESHOLD) {
      return 1;
    }
  }

  return Math.max(1, maxExtent / AUTO_LTSCALE_DIVISOR);
}
