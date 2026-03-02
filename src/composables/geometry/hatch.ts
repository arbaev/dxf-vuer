import * as THREE from "three";
import type { DxfVertex, HatchBoundaryPath, HatchEdge, HatchPatternLine } from "@/types/dxf";
import {
  EPSILON,
  MAX_HATCH_SEGMENTS,
  MAX_HATCH_LINES_PER_PATTERN,
  CIRCLE_SEGMENTS,
  MIN_ARC_SEGMENTS,
} from "@/constants";
import { createBulgeArc } from "./primitives";

const getEdgeStartPoint = (edge: HatchEdge): { x: number; y: number } => {
  if (edge.type === "line") {
    return { x: edge.start.x, y: edge.start.y };
  } else if (edge.type === "arc") {
    const startRad = (edge.startAngle * Math.PI) / 180;
    return {
      x: edge.center.x + edge.radius * Math.cos(startRad),
      y: edge.center.y + edge.radius * Math.sin(startRad),
    };
  } else if (edge.type === "ellipse") {
    const pts = ellipseEdgeToPoints(edge, 1);
    return pts.length > 0 ? { x: pts[0].x, y: pts[0].y } : { x: 0, y: 0 };
  } else if (edge.type === "spline") {
    const pts = splineEdgeToPoints(edge);
    return pts.length > 0 ? { x: pts[0].x, y: pts[0].y } : { x: 0, y: 0 };
  }
  return { x: 0, y: 0 };
};

const ellipseEdgeToPoints = (
  edge: { center: DxfVertex; majorAxisEndPoint: DxfVertex; axisRatio: number; startAngle: number; endAngle: number; ccw: boolean },
  segmentOverride = 0,
): THREE.Vector3[] => {
  const majorX = edge.majorAxisEndPoint.x;
  const majorY = edge.majorAxisEndPoint.y;
  const majorLength = Math.sqrt(majorX * majorX + majorY * majorY);
  if (majorLength < EPSILON) return [];
  const minorLength = majorLength * edge.axisRatio;
  const rotation = Math.atan2(majorY, majorX);

  let startAngle = edge.startAngle; // already in radians for HATCH ellipse edge
  let endAngle = edge.endAngle;

  const isFullEllipse =
    Math.abs(endAngle - startAngle - 2 * Math.PI) < EPSILON ||
    (Math.abs(startAngle) < EPSILON && Math.abs(endAngle) < EPSILON);
  if (isFullEllipse) {
    startAngle = 0;
    endAngle = 2 * Math.PI;
  }

  let sweepAngle = endAngle - startAngle;
  if (edge.ccw) {
    if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
  } else {
    if (sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  }

  const segments = segmentOverride > 0 ? segmentOverride : Math.max(
    MIN_ARC_SEGMENTS,
    Math.floor((Math.abs(sweepAngle) * CIRCLE_SEGMENTS) / (2 * Math.PI)),
  );

  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = startAngle + (i / segments) * sweepAngle;
    const localX = majorLength * Math.cos(t);
    const localY = minorLength * Math.sin(t);
    const worldX = edge.center.x + localX * Math.cos(rotation) - localY * Math.sin(rotation);
    const worldY = edge.center.y + localX * Math.sin(rotation) + localY * Math.cos(rotation);
    points.push(new THREE.Vector3(worldX, worldY, 0));
  }
  return points;
};

const splineEdgeToPoints = (
  edge: { degree: number; knots: number[]; controlPoints: DxfVertex[]; fitPoints?: DxfVertex[] },
): THREE.Vector3[] => {
  // Use fitPoints if available, otherwise controlPoints
  const sourcePoints = edge.fitPoints && edge.fitPoints.length > 1
    ? edge.fitPoints
    : edge.controlPoints;

  if (!sourcePoints || sourcePoints.length < 2) return [];

  const pts = sourcePoints.map((p) => new THREE.Vector3(p.x, p.y, 0));

  if (pts.length === 2) return pts;

  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  const segments = Math.max(pts.length * 4, 20);
  return curve.getPoints(segments);
};

export const boundaryPathToShapePath = (bp: HatchBoundaryPath): THREE.ShapePath | null => {
  const shapePath = new THREE.ShapePath();

  if (bp.edges && bp.edges.length > 0) {
    const firstEdge = bp.edges[0];
    const firstPt = getEdgeStartPoint(firstEdge);
    shapePath.moveTo(firstPt.x, firstPt.y);

    for (const edge of bp.edges) {
      addEdgeToPath(shapePath, edge);
    }
  } else if (bp.polylineVertices && bp.polylineVertices.length > 1) {
    const verts = bp.polylineVertices;
    shapePath.moveTo(verts[0].x, verts[0].y);

    for (let i = 0; i < verts.length - 1; i++) {
      const v1 = verts[i];
      const v2 = verts[i + 1];
      if (!shapePath.currentPath) break;
      if (v1.bulge && Math.abs(v1.bulge) > EPSILON) {
        addBulgeArcToPath(shapePath, v1, v2, v1.bulge);
      } else {
        shapePath.currentPath.lineTo(v2.x, v2.y);
      }
    }
  } else {
    return null;
  }

  return shapePath;
};

export const addEdgeToPath = (shapePath: THREE.ShapePath, edge: HatchEdge): void => {
  if (!shapePath.currentPath) return;
  if (edge.type === "line") {
    shapePath.currentPath.lineTo(edge.end.x, edge.end.y);
  } else if (edge.type === "arc") {
    // Arc edge angles are in degrees, convert to radians
    const startRad = (edge.startAngle * Math.PI) / 180;
    const endRad = (edge.endAngle * Math.PI) / 180;
    shapePath.currentPath.absarc(
      edge.center.x,
      edge.center.y,
      edge.radius,
      startRad,
      endRad,
      !edge.ccw, // THREE.js: aClockwise=true means CW, DXF ccw=true means CCW
    );
  } else if (edge.type === "ellipse") {
    const pts = ellipseEdgeToPoints(edge);
    for (let i = 1; i < pts.length; i++) {
      shapePath.currentPath.lineTo(pts[i].x, pts[i].y);
    }
  } else if (edge.type === "spline") {
    const pts = splineEdgeToPoints(edge);
    for (let i = 1; i < pts.length; i++) {
      shapePath.currentPath.lineTo(pts[i].x, pts[i].y);
    }
  }
};

export const addBulgeArcToPath = (
  shapePath: THREE.ShapePath,
  v1: DxfVertex,
  v2: DxfVertex,
  bulge: number,
): void => {
  if (!shapePath.currentPath) return;
  const dx = v2.x - v1.x;
  const dy = v2.y - v1.y;
  const chordLength = Math.sqrt(dx * dx + dy * dy);
  if (chordLength < EPSILON) {
    shapePath.currentPath.lineTo(v2.x, v2.y);
    return;
  }

  const theta = 4 * Math.atan(bulge);
  const radius = chordLength / (2 * Math.sin(theta / 2));
  const h = radius * Math.cos(theta / 2);

  const midX = (v1.x + v2.x) / 2;
  const midY = (v1.y + v2.y) / 2;
  const perpX = -dy / chordLength;
  const perpY = dx / chordLength;

  const cx = midX + perpX * h;
  const cy = midY + perpY * h;

  const startAngle = Math.atan2(v1.y - cy, v1.x - cx);
  const endAngle = Math.atan2(v2.y - cy, v2.x - cx);

  // bulge > 0 -> CCW, bulge < 0 -> CW
  // THREE.js absarc: aClockwise=true -> CW
  const clockwise = bulge < 0;

  shapePath.currentPath!.absarc(cx, cy, Math.abs(radius), startAngle, endAngle, clockwise);
};

export const boundaryPathToLinePoints = (bp: HatchBoundaryPath): THREE.Vector3[] => {
  const points: THREE.Vector3[] = [];

  if (bp.edges && bp.edges.length > 0) {
    for (const edge of bp.edges) {
      if (edge.type === "line") {
        if (points.length === 0) {
          points.push(new THREE.Vector3(edge.start.x, edge.start.y, 0));
        }
        points.push(new THREE.Vector3(edge.end.x, edge.end.y, 0));
      } else if (edge.type === "arc") {
        const startRad = (edge.startAngle * Math.PI) / 180;
        const endRad = (edge.endAngle * Math.PI) / 180;
        let sweep = endRad - startRad;
        if (edge.ccw) {
          if (sweep < 0) sweep += 2 * Math.PI;
        } else {
          if (sweep > 0) sweep -= 2 * Math.PI;
        }
        const segments = Math.max(
          MIN_ARC_SEGMENTS,
          Math.floor((Math.abs(sweep) * CIRCLE_SEGMENTS) / (2 * Math.PI)),
        );
        for (let i = 0; i <= segments; i++) {
          const a = startRad + (i / segments) * sweep;
          points.push(
            new THREE.Vector3(
              edge.center.x + edge.radius * Math.cos(a),
              edge.center.y + edge.radius * Math.sin(a),
              0,
            ),
          );
        }
      } else if (edge.type === "ellipse") {
        const ePts = ellipseEdgeToPoints(edge);
        // Skip first point if points already exist (to avoid duplicates at edge junctions)
        const startIdx = points.length > 0 ? 1 : 0;
        for (let i = startIdx; i < ePts.length; i++) {
          points.push(ePts[i]);
        }
      } else if (edge.type === "spline") {
        const sPts = splineEdgeToPoints(edge);
        const startIdx = points.length > 0 ? 1 : 0;
        for (let i = startIdx; i < sPts.length; i++) {
          points.push(sPts[i]);
        }
      }
    }
  } else if (bp.polylineVertices && bp.polylineVertices.length > 1) {
    const verts = bp.polylineVertices;
    points.push(new THREE.Vector3(verts[0].x, verts[0].y, 0));
    for (let i = 0; i < verts.length - 1; i++) {
      const v1 = verts[i];
      const v2 = verts[i + 1];
      if (v1.bulge && Math.abs(v1.bulge) > EPSILON) {
        const p1 = new THREE.Vector3(v1.x, v1.y, 0);
        const p2 = new THREE.Vector3(v2.x, v2.y, 0);
        const arcPts = createBulgeArc(p1, p2, v1.bulge);
        points.push(...arcPts.slice(1));
      } else {
        points.push(new THREE.Vector3(v2.x, v2.y, 0));
      }
    }
  }

  return points;
};

export interface Point2D {
  x: number;
  y: number;
}

/** Point-in-polygon test (ray casting algorithm) */
export const pointInPolygon2D = (px: number, py: number, polygon: Point2D[]): boolean => {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = polygon[i].y,
      yj = polygon[j].y;
    if (
      yi > py !== yj > py &&
      px < ((polygon[j].x - polygon[i].x) * (py - yi)) / (yj - yi) + polygon[i].x
    ) {
      inside = !inside;
    }
  }
  return inside;
};

/**
 * Even-odd point-in-polygon test across multiple boundaries.
 * Point is inside the hatch if it falls inside an odd number of boundary polygons.
 */
export const isPointInsideHatch = (px: number, py: number, polygons: Point2D[][]): boolean => {
  let count = 0;
  for (const polygon of polygons) {
    if (pointInPolygon2D(px, py, polygon)) count++;
  }
  return count % 2 === 1;
};

/**
 * Clip a segment to polygon: returns array of [x1,y1,x2,y2] for parts inside the polygon.
 * Collects parameter t values for segment intersections with polygon edges,
 * then alternates inside/outside based on starting state.
 */
export const clipSegmentToPolygon = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  polygon: Point2D[],
): [number, number, number, number][] => {
  const dx = x2 - x1;
  const dy = y2 - y1;

  const params: number[] = [];
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = polygon[j].x - polygon[i].x;
    const ey = polygon[j].y - polygon[i].y;

    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-10) continue;

    const t = ((polygon[i].x - x1) * ey - (polygon[i].y - y1) * ex) / denom;
    const u = ((polygon[i].x - x1) * dy - (polygon[i].y - y1) * dx) / denom;

    if (t > 1e-9 && t < 1 - 1e-9 && u > -1e-9 && u < 1 + 1e-9) {
      params.push(t);
    }
  }

  params.sort((a, b) => a - b);

  // Deduplicate close t-values (vertex crossings produce duplicates)
  const uniqueParams: number[] = [];
  for (let i = 0; i < params.length; i++) {
    if (i > 0 && params[i] - params[i - 1] < 1e-7) continue;
    uniqueParams.push(params[i]);
  }

  // Build intervals and check each midpoint with pointInPolygon2D.
  // This correctly handles both vertex pass-through and tangential touch
  // without relying on toggle logic.
  const boundaries = [0, ...uniqueParams, 1];
  const result: [number, number, number, number][] = [];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const tStart = boundaries[i];
    const tEnd = boundaries[i + 1];
    if (tEnd - tStart < 1e-9) continue;
    const midT = (tStart + tEnd) / 2;
    if (pointInPolygon2D(x1 + midT * dx, y1 + midT * dy, polygon)) {
      result.push([
        x1 + tStart * dx, y1 + tStart * dy,
        x1 + tEnd * dx, y1 + tEnd * dy,
      ]);
    }
  }

  return result;
};

/**
 * Clip a segment against multiple boundary polygons using even-odd rule.
 * Collects intersection t-values from all polygons, sorts them,
 * and builds inside/outside runs based on parity of polygon containment.
 */
export const clipSegmentToPolygons = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  polygons: Point2D[][],
): [number, number, number, number][] => {
  if (polygons.length === 1) {
    return clipSegmentToPolygon(x1, y1, x2, y2, polygons[0]);
  }

  const dx = x2 - x1;
  const dy = y2 - y1;

  // Collect all t-values where the segment crosses any polygon edge
  const allParams = new Set<number>();
  for (const polygon of polygons) {
    const n = polygon.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ex = polygon[j].x - polygon[i].x;
      const ey = polygon[j].y - polygon[i].y;
      const denom = dx * ey - dy * ex;
      if (Math.abs(denom) < 1e-10) continue;
      const t = ((polygon[i].x - x1) * ey - (polygon[i].y - y1) * ex) / denom;
      const u = ((polygon[i].x - x1) * dy - (polygon[i].y - y1) * dx) / denom;
      if (t > 1e-9 && t < 1 - 1e-9 && u > -1e-9 && u < 1 + 1e-9) {
        allParams.add(t);
      }
    }
  }

  const params = Array.from(allParams).sort((a, b) => a - b);
  const result: [number, number, number, number][] = [];
  let prevT = 0;

  // Check initial state
  let inside = isPointInsideHatch(x1, y1, polygons);

  for (const t of params) {
    if (inside) {
      result.push([x1 + prevT * dx, y1 + prevT * dy, x1 + t * dx, y1 + t * dy]);
    }
    // Re-evaluate state at midpoint after crossing
    const midT = (t + (params[params.indexOf(t) + 1] ?? 1)) / 2;
    inside = isPointInsideHatch(x1 + midT * dx, y1 + midT * dy, polygons);
    prevT = t;
  }

  if (inside) {
    result.push([x1 + prevT * dx, y1 + prevT * dy, x2, y2]);
  }

  return result;
};

export interface HatchPatternGeometry {
  segments: THREE.Vector3[][];
  dots: THREE.Vector3[];
}

/**
 * Generate HATCH pattern geometry clipped to boundary polygons.
 * Supports multiple boundaries with even-odd fill rule (donut shapes),
 * pattern scale/angle, and dot rendering.
 */
export const generateHatchPattern = (
  patternLines: HatchPatternLine[],
  polygons: Point2D[][],
  patternScale = 1,
  patternAngle = 0,
): HatchPatternGeometry => {
  // Compute bounding box across all polygons
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const polygon of polygons) {
    for (const p of polygon) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  const bboxDiag = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);

  const allSegments: THREE.Vector3[][] = [];
  const allDots: THREE.Vector3[] = [];
  const scale = patternScale || 1;
  const extraAngle = patternAngle || 0;

  for (const pl of patternLines) {
    const angleRad = ((pl.angle + extraAngle) * Math.PI) / 180;
    const dirX = Math.cos(angleRad);
    const dirY = Math.sin(angleRad);
    const perpX = -dirY;
    const perpY = dirX;

    // Perpendicular distance between lines = |offset . perp| * scale
    const spacing = Math.abs(pl.offset.x * perpX + pl.offset.y * perpY) * scale;
    if (spacing < EPSILON) continue;

    // Shift along line direction between adjacent lines (for staggered patterns)
    const stagger = (pl.offset.x * dirX + pl.offset.y * dirY) * scale;

    // Scale base point
    const bpX = pl.basePoint.x * scale;
    const bpY = pl.basePoint.y * scale;

    // Project bbox corners onto both perp and line directions relative to basePoint
    const corners = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];

    let minPerpProj = Infinity,
      maxPerpProj = -Infinity;
    let minDirProj = Infinity,
      maxDirProj = -Infinity;
    for (const c of corners) {
      const dx = c.x - bpX;
      const dy = c.y - bpY;
      const perpProj = dx * perpX + dy * perpY;
      const dirProj = dx * dirX + dy * dirY;
      if (perpProj < minPerpProj) minPerpProj = perpProj;
      if (perpProj > maxPerpProj) maxPerpProj = perpProj;
      if (dirProj < minDirProj) minDirProj = dirProj;
      if (dirProj > maxDirProj) maxDirProj = dirProj;
    }

    const startIdx = Math.floor(minPerpProj / spacing);
    const endIdx = Math.ceil(maxPerpProj / spacing);

    if (endIdx - startIdx > MAX_HATCH_LINES_PER_PATTERN) continue;

    // Line extent along direction: must cover polygon from any line origin.
    // Use projection of polygon onto line direction relative to basePoint,
    // plus stagger compensation and bbox diagonal as margin.
    const diag = Math.max(Math.abs(minDirProj), Math.abs(maxDirProj)) + bboxDiag;

    // Scale dashes
    const scaledDashes = pl.dashes.map((d) => d * scale);
    const dashTotal = scaledDashes.reduce((s, d) => s + Math.abs(d), 0);
    const isSolid = scaledDashes.length === 0 || dashTotal < EPSILON;

    for (let i = startIdx; i <= endIdx; i++) {
      if (allSegments.length >= MAX_HATCH_SEGMENTS) break;

      // Line origin: basePoint + i * spacing * perp + i * stagger * dir
      const ox = bpX + i * spacing * perpX + i * stagger * dirX;
      const oy = bpY + i * spacing * perpY + i * stagger * dirY;

      if (isSolid) {
        const x1 = ox - diag * dirX,
          y1 = oy - diag * dirY;
        const x2 = ox + diag * dirX,
          y2 = oy + diag * dirY;
        const clipped = clipSegmentToPolygons(x1, y1, x2, y2, polygons);
        for (const seg of clipped) {
          allSegments.push([
            new THREE.Vector3(seg[0], seg[1], 0),
            new THREE.Vector3(seg[2], seg[3], 0),
          ]);
        }
      } else {
        // Dash pattern: start near polygon, not at -diag (avoids millions of iterations
        // when base point is far from polygon)
        const lineStart = minDirProj - i * stagger - bboxDiag;
        const lineEnd = maxDirProj - i * stagger + bboxDiag;
        let t = lineStart;
        // Align start to pattern period
        const phase = ((t % dashTotal) + dashTotal) % dashTotal;
        t -= phase;

        while (t < lineEnd) {
          for (const d of scaledDashes) {
            const segLen = Math.abs(d);
            if (d > 0) {
              // Dash — line segment
              const sx = ox + t * dirX,
                sy = oy + t * dirY;
              const ex = ox + (t + segLen) * dirX,
                ey = oy + (t + segLen) * dirY;
              const clipped = clipSegmentToPolygons(sx, sy, ex, ey, polygons);
              for (const seg of clipped) {
                allSegments.push([
                  new THREE.Vector3(seg[0], seg[1], 0),
                  new THREE.Vector3(seg[2], seg[3], 0),
                ]);
              }
            } else if (d === 0) {
              // Dot — zero-length element at current position
              const dotX = ox + t * dirX;
              const dotY = oy + t * dirY;
              if (isPointInsideHatch(dotX, dotY, polygons)) {
                allDots.push(new THREE.Vector3(dotX, dotY, 0));
              }
            }
            // d < 0 -> gap (advance without drawing)
            t += segLen;
          }
        }
      }
    }

    if (allSegments.length >= MAX_HATCH_SEGMENTS) break;
  }

  return { segments: allSegments, dots: allDots };
};
