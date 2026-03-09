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
import { generateEllipsePoints } from "./curvePoints";

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
    const pts = generateEllipsePoints(
      edge.center.x, edge.center.y, 0,
      edge.majorAxisEndPoint.x, edge.majorAxisEndPoint.y,
      edge.axisRatio, edge.startAngle, edge.endAngle,
      edge.ccw, 1,
    );
    return pts.length > 0 ? { x: pts[0].x, y: pts[0].y } : { x: 0, y: 0 };
  } else if (edge.type === "spline") {
    const pts = splineEdgeToPoints(edge);
    return pts.length > 0 ? { x: pts[0].x, y: pts[0].y } : { x: 0, y: 0 };
  }
  return { x: 0, y: 0 };
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

/**
 * Add a single boundary path as a new subpath to an existing ShapePath.
 * Each moveTo() starts a new subpath within the ShapePath.
 */
export const addBoundaryPathToShapePath = (shapePath: THREE.ShapePath, bp: HatchBoundaryPath): boolean => {
  if (bp.edges && bp.edges.length > 0) {
    const firstEdge = bp.edges[0];
    const firstPt = getEdgeStartPoint(firstEdge);
    shapePath.moveTo(firstPt.x, firstPt.y);

    for (const edge of bp.edges) {
      addEdgeToPath(shapePath, edge);
    }
    return true;
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
    return true;
  }
  return false;
};

export const boundaryPathToShapePath = (bp: HatchBoundaryPath): THREE.ShapePath | null => {
  const shapePath = new THREE.ShapePath();
  return addBoundaryPathToShapePath(shapePath, bp) ? shapePath : null;
};

/**
 * Build THREE.Shape array from HATCH boundary paths with even-odd hole detection.
 * Handles the common DXF case where inner boundaries have the same winding direction
 * as outer boundaries (both CCW). Uses area-based sorting and containment testing
 * to manually assign holes to their parent shapes.
 */
export const buildSolidHatchShapes = (boundaryPaths: HatchBoundaryPath[]): THREE.Shape[] => {
  // Convert each boundary path to an independent Shape
  const entries: { shape: THREE.Shape; area: number; pts: THREE.Vector2[] }[] = [];
  for (const bp of boundaryPaths) {
    const sp = new THREE.ShapePath();
    if (!addBoundaryPathToShapePath(sp, bp)) continue;
    for (const shape of sp.toShapes(false)) {
      const pts = shape.getPoints(12);
      entries.push({ shape, area: Math.abs(THREE.ShapeUtils.area(pts)), pts });
    }
  }

  if (entries.length <= 1) return entries.map((e) => e.shape);

  // Sort by area descending (outermost first)
  entries.sort((a, b) => b.area - a.area);

  // Determine nesting level per shape; even = outer, odd = hole
  const result: THREE.Shape[] = [];
  const isHoleFlag: boolean[] = [];

  for (let i = 0; i < entries.length; i++) {
    const testPt = entries[i].pts[0];
    let nestLevel = 0;

    for (let j = 0; j < i; j++) {
      if (pointInPolygon2D(testPt.x, testPt.y, entries[j].pts)) {
        nestLevel++;
      }
    }

    if (nestLevel % 2 === 0) {
      // Outer shape
      result.push(entries[i].shape);
      isHoleFlag[i] = false;
    } else {
      // Hole — add to the smallest containing outer shape
      isHoleFlag[i] = true;
      for (let j = i - 1; j >= 0; j--) {
        if (!isHoleFlag[j] && pointInPolygon2D(testPt.x, testPt.y, entries[j].pts)) {
          entries[j].shape.holes.push(new THREE.Path(entries[i].pts));
          break;
        }
      }
    }
  }

  return result;
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
    const pts = generateEllipsePoints(
      edge.center.x, edge.center.y, 0,
      edge.majorAxisEndPoint.x, edge.majorAxisEndPoint.y,
      edge.axisRatio, edge.startAngle, edge.endAngle,
      edge.ccw,
    );
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
        const ePts = generateEllipsePoints(
          edge.center.x, edge.center.y, 0,
          edge.majorAxisEndPoint.x, edge.majorAxisEndPoint.y,
          edge.axisRatio, edge.startAngle, edge.endAngle,
          edge.ccw,
        );
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

/** Convert boundary path to Point2D array (no Vector3 allocation) for polygon clipping */
export const boundaryPathToPoint2DArray = (bp: HatchBoundaryPath): Point2D[] => {
  const points: Point2D[] = [];

  if (bp.edges && bp.edges.length > 0) {
    for (const edge of bp.edges) {
      if (edge.type === "line") {
        if (points.length === 0) {
          points.push({ x: edge.start.x, y: edge.start.y });
        }
        points.push({ x: edge.end.x, y: edge.end.y });
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
          points.push({
            x: edge.center.x + edge.radius * Math.cos(a),
            y: edge.center.y + edge.radius * Math.sin(a),
          });
        }
      } else if (edge.type === "ellipse") {
        // Inline ellipse calculation to avoid Vector3 allocation (performance path)
        const majorX = edge.majorAxisEndPoint.x;
        const majorY = edge.majorAxisEndPoint.y;
        const majorLength = Math.sqrt(majorX * majorX + majorY * majorY);
        if (majorLength < EPSILON) continue;
        const minorLength = majorLength * edge.axisRatio;
        const rotation = Math.atan2(majorY, majorX);
        const cosR = Math.cos(rotation);
        const sinR = Math.sin(rotation);
        let startAngle = edge.startAngle;
        let endAngle = edge.endAngle;
        const isFullEllipse =
          Math.abs(endAngle - startAngle - 2 * Math.PI) < EPSILON ||
          Math.abs(endAngle - startAngle) < EPSILON;
        if (isFullEllipse) { startAngle = 0; endAngle = 2 * Math.PI; }
        let sweepAngle = endAngle - startAngle;
        if (edge.ccw) { if (sweepAngle < 0) sweepAngle += 2 * Math.PI; }
        else { if (sweepAngle > 0) sweepAngle -= 2 * Math.PI; }
        const segments = Math.max(
          MIN_ARC_SEGMENTS,
          Math.floor((Math.abs(sweepAngle) * CIRCLE_SEGMENTS) / (2 * Math.PI)),
        );
        const startIdx = points.length > 0 ? 1 : 0;
        for (let i = startIdx; i <= segments; i++) {
          const t = startAngle + (i / segments) * sweepAngle;
          const localX = majorLength * Math.cos(t);
          const localY = minorLength * Math.sin(t);
          points.push({
            x: edge.center.x + localX * cosR - localY * sinR,
            y: edge.center.y + localX * sinR + localY * cosR,
          });
        }
      } else if (edge.type === "spline") {
        const sPts = splineEdgeToPoints(edge);
        const startIdx = points.length > 0 ? 1 : 0;
        for (let i = startIdx; i < sPts.length; i++) {
          points.push({ x: sPts[i].x, y: sPts[i].y });
        }
      }
    }
  } else if (bp.polylineVertices && bp.polylineVertices.length > 1) {
    const verts = bp.polylineVertices;
    points.push({ x: verts[0].x, y: verts[0].y });
    for (let i = 0; i < verts.length - 1; i++) {
      const v1 = verts[i];
      const v2 = verts[i + 1];
      if (v1.bulge && Math.abs(v1.bulge) > EPSILON) {
        const dx = v2.x - v1.x;
        const dy = v2.y - v1.y;
        const chordLength = Math.sqrt(dx * dx + dy * dy);
        if (chordLength < EPSILON) {
          points.push({ x: v2.x, y: v2.y });
          continue;
        }
        const theta = 4 * Math.atan(v1.bulge);
        const radius = chordLength / (2 * Math.sin(theta / 2));
        const h = radius * Math.cos(theta / 2);
        const midX = (v1.x + v2.x) / 2;
        const midY = (v1.y + v2.y) / 2;
        const pX = -dy / chordLength;
        const pY = dx / chordLength;
        const cx = midX + pX * h;
        const cy = midY + pY * h;
        const sa = Math.atan2(v1.y - cy, v1.x - cx);
        const ea = Math.atan2(v2.y - cy, v2.x - cx);
        let sw = ea - sa;
        while (sw > Math.PI) sw -= 2 * Math.PI;
        while (sw < -Math.PI) sw += 2 * Math.PI;
        if (v1.bulge > 0 && sw < 0) sw += 2 * Math.PI;
        else if (v1.bulge < 0 && sw > 0) sw -= 2 * Math.PI;
        const segs = Math.max(
          MIN_ARC_SEGMENTS,
          Math.floor((Math.abs(sw) * CIRCLE_SEGMENTS) / (2 * Math.PI)),
        );
        const absR = Math.abs(radius);
        for (let j = 1; j <= segs; j++) {
          const angle = sa + sw * (j / segs);
          points.push({ x: cx + absR * Math.cos(angle), y: cy + absR * Math.sin(angle) });
        }
      } else {
        points.push({ x: v2.x, y: v2.y });
      }
    }
  }

  return points;
};

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

  const boundaries = [0, ...uniqueParams, 1];
  const result: [number, number, number, number][] = [];

  if (uniqueParams.length === 0) {
    // No intersections — single PIP test
    if (pointInPolygon2D(x1 + 0.5 * dx, y1 + 0.5 * dy, polygon)) {
      result.push([x1, y1, x2, y2]);
    }
    return result;
  }

  // Toggle-PIP: compute PIP for first interval, verify with last interval.
  // If verification passes, toggle state at each intersection (2 PIP calls total).
  // If not, fallback to per-interval PIP (tangential vertex touch).
  const firstMidT = boundaries[1] / 2;
  const inside = pointInPolygon2D(x1 + firstMidT * dx, y1 + firstMidT * dy, polygon);

  const lastMidT = (boundaries[boundaries.length - 2] + 1) / 2;
  const lastInside = pointInPolygon2D(x1 + lastMidT * dx, y1 + lastMidT * dy, polygon);
  const expectedLast = uniqueParams.length % 2 === 0 ? inside : !inside;

  if (lastInside !== expectedLast) {
    // Tangential touch — fallback to per-interval PIP
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
  }

  // Toggle logic — O(2) PIP calls instead of O(intervals)
  let state = inside;
  for (let i = 0; i < boundaries.length - 1; i++) {
    const tStart = boundaries[i];
    const tEnd = boundaries[i + 1];
    if (state && tEnd - tStart > 1e-9) {
      result.push([
        x1 + tStart * dx, y1 + tStart * dy,
        x1 + tEnd * dx, y1 + tEnd * dy,
      ]);
    }
    state = !state;
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

  for (let k = 0; k < params.length; k++) {
    const t = params[k];
    if (inside) {
      result.push([x1 + prevT * dx, y1 + prevT * dy, x1 + t * dx, y1 + t * dy]);
    }
    // Re-evaluate state at midpoint after crossing
    const midT = (t + (params[k + 1] ?? 1)) / 2;
    inside = isPointInsideHatch(x1 + midT * dx, y1 + midT * dy, polygons);
    prevT = t;
  }

  if (inside) {
    result.push([x1 + prevT * dx, y1 + prevT * dy, x2, y2]);
  }

  return result;
};

export interface HatchPatternGeometry {
  /** Flat: [x1,y1,z1, x2,y2,z2, ...] for LineSegments */
  segmentVertices: number[];
  /** Flat: [x,y,z, ...] for Points */
  dotPositions: number[];
}

/**
 * Generate HATCH pattern geometry clipped to boundary polygons.
 * Supports multiple boundaries with even-odd fill rule (donut shapes),
 * pattern scale/angle, and dot rendering.
 * Returns flat number arrays (no Vector3 allocation).
 */
export const generateHatchPattern = (
  patternLines: HatchPatternLine[],
  polygons: Point2D[][],
  patternScale = 1,
  patternAngle = 0,
  wcsOffset = false,
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

  const segVerts: number[] = [];
  const dotPos: number[] = [];
  const scale = patternScale || 1;
  const extraAngle = patternAngle || 0;

  for (const pl of patternLines) {
    const angleRad = ((pl.angle + extraAngle) * Math.PI) / 180;
    const dirX = Math.cos(angleRad);
    const dirY = Math.sin(angleRad);
    const perpX = -dirY;
    const perpY = dirX;

    // Compute per-line step vector and perpendicular spacing.
    // Embedded DXF patterns store offset in WCS (rotated by line angle).
    // Built-in dictionary patterns store offset in line-local coordinates
    // (offset.x = stagger along line, offset.y = perpendicular spacing).
    let spacing: number;
    let stagger: number;
    let stepX: number;
    let stepY: number;

    if (wcsOffset) {
      // Embedded DXF: offset is a WCS displacement vector.
      // Ensure the perpendicular component is positive so that loop bounds
      // (which use unsigned spacing) correctly map i to line positions.
      // Negating the step just reverses line numbering — same set of lines.
      stepX = pl.offset.x * scale;
      stepY = pl.offset.y * scale;
      const perpComp = stepX * perpX + stepY * perpY;
      if (perpComp < 0) {
        stepX = -stepX;
        stepY = -stepY;
      }
      spacing = Math.abs(perpComp);
      stagger = stepX * dirX + stepY * dirY;
    } else {
      // Built-in: offset.x = stagger, offset.y projected onto perp = spacing
      spacing = Math.abs(pl.offset.x * perpX + pl.offset.y * perpY) * scale;
      stagger = pl.offset.x * scale;
      stepX = spacing * perpX + stagger * dirX;
      stepY = spacing * perpY + stagger * dirY;
    }

    if (spacing < EPSILON) continue;

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
      if (segVerts.length / 6 >= MAX_HATCH_SEGMENTS) break;

      // Line origin: basePoint + i * step
      const ox = bpX + i * stepX;
      const oy = bpY + i * stepY;

      if (isSolid) {
        const x1 = ox - diag * dirX,
          y1 = oy - diag * dirY;
        const x2 = ox + diag * dirX,
          y2 = oy + diag * dirY;
        const clipped = clipSegmentToPolygons(x1, y1, x2, y2, polygons);
        for (const seg of clipped) {
          segVerts.push(seg[0], seg[1], 0, seg[2], seg[3], 0);
        }
      } else {
        // Batch clipping: clip the whole line once, then overlay dash pattern
        const lineStart = minDirProj - i * stagger - bboxDiag;
        const lineEnd = maxDirProj - i * stagger + bboxDiag;
        const lx1 = ox + lineStart * dirX, ly1 = oy + lineStart * dirY;
        const lx2 = ox + lineEnd * dirX, ly2 = oy + lineEnd * dirY;
        const clipped = clipSegmentToPolygons(lx1, ly1, lx2, ly2, polygons);

        for (const [cx1, cy1, cx2, cy2] of clipped) {
          // Project clipped endpoints back to t-coordinate along line direction
          const ct1 = (cx1 - ox) * dirX + (cy1 - oy) * dirY;
          const ct2 = (cx2 - ox) * dirX + (cy2 - oy) * dirY;

          // Align to dash pattern period
          let t = ct1 - (((ct1 % dashTotal) + dashTotal) % dashTotal);

          while (t < ct2) {
            for (const d of scaledDashes) {
              const segLen = Math.abs(d);
              if (d > 0) {
                // Dash segment — clamp to clipped interval
                const segStart = Math.max(t, ct1);
                const segEnd = Math.min(t + segLen, ct2);
                if (segEnd > segStart + 1e-9) {
                  segVerts.push(
                    ox + segStart * dirX, oy + segStart * dirY, 0,
                    ox + segEnd * dirX, oy + segEnd * dirY, 0,
                  );
                }
              } else if (d === 0) {
                // Dot — already inside clipped region
                if (t >= ct1 && t <= ct2) {
                  dotPos.push(ox + t * dirX, oy + t * dirY, 0);
                }
              }
              // d < 0 -> gap (advance without drawing)
              t += segLen;
            }
          }
        }
      }
    }

    if (segVerts.length / 6 >= MAX_HATCH_SEGMENTS) break;
  }

  return { segmentVertices: segVerts, dotPositions: dotPos };
};
