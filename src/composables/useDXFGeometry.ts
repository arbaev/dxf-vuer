import * as THREE from "three";
import { NURBSCurve } from "three/examples/jsm/curves/NURBSCurve.js";
import type { DxfVertex, DxfEntity, DxfData, DxfLayer, DxfSplineEntity, DxfTextEntity, DxfAttdefEntity, DxfMlineEntity, DxfXlineEntity, DxfPolylineVertex, DxfPolylineEntity } from "@/types/dxf";
import {
  isLineEntity,
  isCircleEntity,
  isArcEntity,
  isPolylineEntity,
  isSplineEntity,
  isTextEntity,
  isDimensionEntity,
  isInsertEntity,
  isSolidEntity,
  isEllipseEntity,
  isPointEntity,
  is3DFaceEntity,
  isHatchEntity,
  isLeaderEntity,
  isMLeaderEntity,
  isAttdefEntity,
} from "@/types/dxf";
import {
  TEXT_HEIGHT,
  CIRCLE_SEGMENTS,
  DEGREES_TO_RADIANS_DIVISOR,
  EPSILON,
  MIN_ARC_SEGMENTS,
  NURBS_SEGMENTS_MULTIPLIER,
  MIN_NURBS_SEGMENTS,
  CATMULL_ROM_SEGMENTS_MULTIPLIER,
  MIN_CATMULL_ROM_SEGMENTS,
  ARROW_SIZE,
  POINT_SYMBOL_SEGMENTS,
  POINT_SYMBOL_DEFAULT_SIZE,
  MAX_LINETYPE_REPETITIONS,
} from "@/constants";
import { HATCH_PATTERNS } from "@/constants/hatchPatterns";
import { resolveEntityColor, rgbNumberToHex } from "@/utils/colorResolver";
import ACI_PALETTE from "@/parser/acadColorIndex";
import { resolveEntityLinetype, applyLinetypePattern, computeAutoLtScale } from "@/utils/linetypeResolver";
import { buildOcsMatrix, transformOcsPoints, transformOcsPoint } from "@/utils/ocsTransform";
import { getInsUnitsScale } from "@/utils/insUnitsScale";

import {
  type EntityColorContext,
  degreesToRadians,
  getLineMaterial,
  getMeshMaterial,
  getPointsMaterial,
  createBulgeArc,
  createArrow,
  createTick,
  createLine,
  setLayerName,
} from "./geometry/primitives";
import {
  extractDimensionData,
  createDimensionGroup,
  createOrdinateDimension,
  createRadialDimension,
  createDiametricDimension,
  createAngularDimension,
  resolveDimVarsFromHeader,
  applyDimStyleVars,
  mergeEntityDimVars,
  isTickBlock,
  type DimFormatOptions,
} from "./geometry/dimensions";
import {
  replaceSpecialChars,
  parseTextWithUnderline,
  parseMTextContent,
} from "./geometry/text";
import {
  buildSolidHatchShapes,
  boundaryPathToLinePoints,
  boundaryPathToPoint2DArray,
  generateHatchPattern,
  type Point2D,
} from "./geometry/hatch";
import { GeometryCollector } from "./geometry/mergeCollectors";
import {
  addTextToCollector,
  addMTextToCollector,
  addDimensionTextToCollector,
  measureDimensionTextWidth,
  HAlign,
  VAlign,
} from "./geometry/vectorTextBuilder";
import {
  type BlockTemplate,
  type CollectEntityParams,
  type SharedBlockGeo,
  INSTANCING_THRESHOLD,
  buildBlockTemplate,
  instantiateBlockTemplate,
  buildSharedBlockGeo,
  addSharedBlockInstance,
} from "./geometry/blockTemplateCache";
import { resolveEntityFont, classifyFont } from "./geometry/fontClassifier";
import { loadSerifFont } from "./geometry/fontManager";
import { clearGlyphCache } from "./geometry/glyphCache";
import { clearMeasureTextCache } from "./geometry/vectorTextBuilder";

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Compute polyline points (with bulge arcs) from entity vertices.
 */
export const computePolylinePoints = (entity: DxfEntity & { vertices: DxfVertex[]; shape?: boolean }): THREE.Vector3[] => {
  const allPoints: THREE.Vector3[] = [];

  for (let i = 0; i < entity.vertices.length - 1; i++) {
    const v1 = entity.vertices[i];
    const v2 = entity.vertices[i + 1];
    if (!v1 || !v2) continue;

    const p1 = new THREE.Vector3(v1.x, v1.y, 0);
    const p2 = new THREE.Vector3(v2.x, v2.y, 0);

    if (i === 0) {
      allPoints.push(p1);
    }

    if (v1.bulge && Math.abs(v1.bulge) > EPSILON) {
      const arcPoints = createBulgeArc(p1, p2, v1.bulge);
      allPoints.push(...arcPoints.slice(1));
    } else {
      allPoints.push(p2);
    }
  }

  // Closing segment for closed polylines (shape = true)
  if (entity.shape && entity.vertices.length > 1) {
    const vLast = entity.vertices[entity.vertices.length - 1];
    const vFirst = entity.vertices[0];
    const pLast = new THREE.Vector3(vLast.x, vLast.y, 0);
    const pFirst = new THREE.Vector3(vFirst.x, vFirst.y, 0);

    if (vLast.bulge && Math.abs(vLast.bulge) > EPSILON) {
      const arcPoints = createBulgeArc(pLast, pFirst, vLast.bulge);
      allPoints.push(...arcPoints.slice(1));
    } else {
      allPoints.push(pFirst);
    }
  }

  return allPoints;
};

/**
 * Compute spline points using NURBS or CatmullRom fallback.
 */
const computeSplinePoints = (entity: DxfSplineEntity): THREE.Vector3[] | null => {
  if (
    entity.controlPoints &&
    entity.controlPoints.length > 1 &&
    entity.degreeOfSplineCurve !== undefined &&
    entity.knotValues &&
    entity.knotValues.length > 0
  ) {
    const degree = entity.degreeOfSplineCurve;
    const knots = entity.knotValues;

    const controlPoints = entity.controlPoints.map((vertex: DxfVertex, i: number) => {
      const weight = entity.weights?.[i] ?? 1.0;
      return new THREE.Vector4(vertex.x, vertex.y, 0, weight);
    });

    try {
      const startKnot = degree;
      const endKnot = controlPoints.length;
      const curve = new NURBSCurve(degree, knots, controlPoints, startKnot, endKnot);
      const segments = Math.max(
        controlPoints.length * NURBS_SEGMENTS_MULTIPLIER,
        MIN_NURBS_SEGMENTS,
      );
      const pts = curve.getPoints(segments) as THREE.Vector3[];
      // Close the spline by appending the first point if flagged as closed
      if (entity.closed && pts.length > 1) {
        pts.push(pts[0].clone());
      }
      return pts;
    } catch (error) {
      console.warn("NURBS creation error, using fallback:", error);
    }
  }

  // Fallback: fitPoints/vertices
  const splinePoints = entity.fitPoints || entity.vertices || entity.controlPoints;
  if (splinePoints && splinePoints.length > 1) {
    const points = splinePoints.map(
      (vertex: DxfVertex) => new THREE.Vector3(vertex.x, vertex.y, 0),
    );
    const curve = new THREE.CatmullRomCurve3(points, entity.closed === true, "centripetal");
    const segments = Math.max(
      points.length * CATMULL_ROM_SEGMENTS_MULTIPLIER,
      MIN_CATMULL_ROM_SEGMENTS,
    );
    return curve.getPoints(segments);
  }

  return null;
};

/**
 * Add line data to collector, handling linetype patterns.
 * Continuous lines → addLineFromPoints (segment pairs).
 * Patterned lines → applyLinetypePattern → addLineSegments + addLinetypeDots.
 */
const addLineToCollector = (
  collector: GeometryCollector,
  layer: string,
  color: string,
  points: THREE.Vector3[],
  pattern?: number[],
): void => {
  if (points.length < 2) return;

  if (pattern && pattern.length > 0) {
    // Estimate path length vs pattern cycle to avoid vertex explosion.
    // Long curves with fine patterns generate millions of sub-pixel dashes;
    // fall back to continuous line when repetitions exceed the threshold.
    let patternCycleLen = 0;
    for (const v of pattern) patternCycleLen += Math.abs(v);
    if (patternCycleLen > 0) {
      let totalLen = 0;
      for (let i = 0; i < points.length - 1; i++) {
        const dx = points[i + 1].x - points[i].x;
        const dy = points[i + 1].y - points[i].y;
        totalLen += Math.sqrt(dx * dx + dy * dy);
      }
      if (totalLen / patternCycleLen > MAX_LINETYPE_REPETITIONS) {
        collector.addLineFromPoints(layer, color, points);
        return;
      }
    }

    const pg = applyLinetypePattern(points, pattern);
    const hasSegments = pg.segments.length >= 6;
    const hasDots = pg.dots.length >= 3;

    if (hasSegments) {
      collector.addLineSegments(layer, color, pg.segments);
    }
    if (hasDots) {
      collector.addLinetypeDots(layer, color, pg.dots);
    }
    // If pattern produced nothing, add as continuous line
    if (!hasSegments && !hasDots) {
      collector.addLineFromPoints(layer, color, points);
    }
  } else {
    collector.addLineFromPoints(layer, color, points);
  }
};

/**
 * Extract flat vertices and indices from face points (SOLID, 3DFACE).
 */
const computeFaceData = (pts: DxfVertex[]): { vertices: number[]; indices: number[] } | null => {
  if (!pts || pts.length < 3) return null;

  const vertices: number[] = [];
  const indices: number[] = [];

  for (const p of pts) {
    vertices.push(p.x, p.y, p.z || 0);
  }

  indices.push(0, 1, 2);
  if (pts.length >= 4) {
    indices.push(0, 2, 3);
  }

  return { vertices, indices };
};

/**
 * Add 3DFACE edges as lines, respecting edge visibility flags (DXF code 70).
 * Bits 0-3: when set, the corresponding edge is INVISIBLE.
 * Edge 0: vertex 0→1, Edge 1: vertex 1→2, Edge 2: vertex 2→3, Edge 3: vertex 3→0.
 */
const add3DFaceEdges = (
  collector: GeometryCollector,
  layer: string,
  color: string,
  pts: DxfVertex[],
  edgeFlags?: number,
): void => {
  if (!pts || pts.length < 3) return;
  const flags = edgeFlags ?? 0;
  const n = pts.length;
  // Edge pairs: [0,1], [1,2], [2,3], [3,0] (or [2,0] for triangles)
  const edges: [number, number][] = n >= 4
    ? [[0, 1], [1, 2], [2, 3], [3, 0]]
    : [[0, 1], [1, 2], [2, 0]];
  for (let i = 0; i < edges.length; i++) {
    if (flags & (1 << i)) continue; // invisible edge
    const [a, b] = edges[i];
    const points = [
      new THREE.Vector3(pts[a].x, pts[a].y, pts[a].z || 0),
      new THREE.Vector3(pts[b].x, pts[b].y, pts[b].z || 0),
    ];
    collector.addLineFromPoints(layer, color, points);
  }
};

/**
 * Render a POLYLINE polyface mesh as wireframe edges.
 * Position vertices (vertexFlags & 64 or 128 set, no faceA) define point positions (1-based).
 * Face vertices (faceA defined) reference those positions; negative index = invisible edge.
 */
const addPolyfaceMeshEdges = (
  collector: GeometryCollector,
  layer: string,
  color: string,
  vertices: DxfPolylineVertex[],
  worldMatrix?: THREE.Matrix4,
): void => {
  // Separate position vertices from face vertices
  const positions: THREE.Vector3[] = [];
  const faces: DxfPolylineVertex[] = [];
  for (const v of vertices) {
    if (v.faceA !== undefined) {
      faces.push(v);
    } else {
      positions.push(new THREE.Vector3(v.x, v.y, v.z || 0));
    }
  }
  if (worldMatrix) {
    for (const p of positions) p.applyMatrix4(worldMatrix);
  }
  if (positions.length === 0 || faces.length === 0) return;

  // Each face has up to 4 vertex indices (1-based). Negative = invisible edge.
  for (const face of faces) {
    const indices = [face.faceA, face.faceB, face.faceC, face.faceD];
    const faceVerts: number[] = [];
    const visible: boolean[] = [];
    for (const idx of indices) {
      if (idx === undefined || idx === 0) continue;
      faceVerts.push(Math.abs(idx));
      visible.push(idx > 0);
    }
    for (let i = 0; i < faceVerts.length; i++) {
      if (!visible[i]) continue;
      const a = faceVerts[i] - 1;
      const b = faceVerts[(i + 1) % faceVerts.length] - 1;
      if (a < 0 || a >= positions.length || b < 0 || b >= positions.length) continue;
      collector.addLineFromPoints(layer, color, [positions[a], positions[b]]);
    }
  }
};

/**
 * Render a wide polyline (width > 0) as a filled mesh.
 * Generates the outline by offsetting the polyline path by ±width/2,
 * then triangulates the result using ShapeGeometry.
 */
const addWidePolylineToCollector = (
  collector: GeometryCollector,
  layer: string,
  color: string,
  entity: DxfPolylineEntity,
  ocsMatrix: THREE.Matrix4 | null,
  worldMatrix?: THREE.Matrix4,
): void => {
  const halfW = (entity.width || entity.defaultStartWidth || 0) / 2;
  if (halfW <= 0) return;

  // Build the polyline center path as dense points
  const centerPoints = computePolylinePoints(entity);
  if (centerPoints.length < 2) return;

  // Transform to WCS
  const pts = worldMatrix
    ? transformOcsPoints(centerPoints, ocsMatrix).map(p => p.applyMatrix4(worldMatrix))
    : transformOcsPoints(centerPoints, ocsMatrix);

  // Build left and right offset paths
  const left: THREE.Vector2[] = [];
  const right: THREE.Vector2[] = [];
  for (let i = 0; i < pts.length; i++) {
    let nx: number, ny: number;
    if (i === 0) {
      nx = -(pts[1].y - pts[0].y);
      ny = pts[1].x - pts[0].x;
    } else if (i === pts.length - 1) {
      nx = -(pts[i].y - pts[i - 1].y);
      ny = pts[i].x - pts[i - 1].x;
    } else {
      nx = -(pts[i + 1].y - pts[i - 1].y);
      ny = pts[i + 1].x - pts[i - 1].x;
    }
    const len = Math.sqrt(nx * nx + ny * ny);
    if (len < EPSILON) {
      // Degenerate: skip offset or use previous
      if (left.length > 0) {
        left.push(left[left.length - 1].clone());
        right.push(right[right.length - 1].clone());
      }
      continue;
    }
    nx /= len;
    ny /= len;
    left.push(new THREE.Vector2(pts[i].x + nx * halfW, pts[i].y + ny * halfW));
    right.push(new THREE.Vector2(pts[i].x - nx * halfW, pts[i].y - ny * halfW));
  }

  if (left.length < 2) return;

  // Build a closed shape: left path forward + right path backward
  const shape = new THREE.Shape();
  shape.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) {
    shape.lineTo(left[i].x, left[i].y);
  }
  // If closed polyline, connect last left to first left via right side
  for (let i = right.length - 1; i >= 0; i--) {
    shape.lineTo(right[i].x, right[i].y);
  }
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape);
  const posAttr = geometry.getAttribute("position");
  const idxAttr = geometry.getIndex();
  if (!posAttr || !idxAttr) { geometry.dispose(); return; }

  const vertices: number[] = [];
  for (let i = 0; i < posAttr.count; i++) {
    vertices.push(posAttr.getX(i), posAttr.getY(i), 0);
  }
  const indices: number[] = [];
  for (let i = 0; i < idxAttr.count; i++) {
    indices.push(idxAttr.getX(i));
  }
  geometry.dispose();

  collector.addMesh(layer, color, vertices, indices);
};

/**
 * Render a 3D polygon mesh (POLYLINE code 70 bit 4) as wireframe edges.
 * Vertices are laid out in an M×N grid. Edges connect adjacent cells
 * horizontally and vertically (no diagonals).
 * shape (bit 0) = closed in M direction, is3dPolygonMeshClosed (bit 5) = closed in N direction.
 */
const addPolygonMeshEdges = (
  collector: GeometryCollector,
  layer: string,
  color: string,
  entity: DxfPolylineEntity,
  worldMatrix?: THREE.Matrix4,
): void => {
  const M = entity.meshMVertexCount!;
  const N = entity.meshNVertexCount!;
  const verts = entity.vertices;
  if (verts.length < M * N) return;

  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < M * N; i++) {
    const v = verts[i];
    pts.push(new THREE.Vector3(v.x, v.y, v.z || 0));
  }
  if (worldMatrix) {
    for (const p of pts) p.applyMatrix4(worldMatrix);
  }

  const closedM = entity.shape === true;
  const closedN = entity.is3dPolygonMeshClosed === true;

  const idx = (m: number, n: number) => m * N + n;

  // Horizontal edges: along N direction
  for (let m = 0; m < M; m++) {
    const nEnd = closedN ? N : N - 1;
    for (let n = 0; n < nEnd; n++) {
      collector.addLineFromPoints(layer, color, [pts[idx(m, n)], pts[idx(m, (n + 1) % N)]]);
    }
  }
  // Vertical edges: along M direction
  for (let n = 0; n < N; n++) {
    const mEnd = closedM ? M : M - 1;
    for (let m = 0; m < mEnd; m++) {
      collector.addLineFromPoints(layer, color, [pts[idx(m, n)], pts[idx((m + 1) % M, n)]]);
    }
  }
};

// ─── PDMODE point symbol rendering ───────────────────────────────────

interface PointSymbolParams {
  collector: GeometryCollector;
  layer: string;
  color: string;
  x: number;
  y: number;
  z: number;
  pdMode: number;
  halfSize: number;
}

/**
 * Generate point symbol geometry based on $PDMODE and $PDSIZE.
 * Adds line segments, circle/square outlines, and/or a dot to the collector.
 */
const collectPointSymbol = (p: PointSymbolParams): void => {
  const { collector, layer, color, x, y, z, pdMode, halfSize } = p;
  const centerType = pdMode & 0xF;
  const hasCircle = (pdMode & 32) !== 0;
  const hasSquare = (pdMode & 64) !== 0;

  // When combined with outer shapes, the center marker extends beyond the boundary
  const armSize = (hasCircle || hasSquare) ? halfSize * 2 : halfSize;

  // Center marker
  switch (centerType) {
    case 0: // dot
      collector.addPoint(layer, color, x, y, z);
      break;
    case 1: // nothing
      break;
    case 2: // plus (+)
      collector.addLineSegments(layer, color, [
        x - armSize, y, z, x + armSize, y, z,
        x, y - armSize, z, x, y + armSize, z,
      ]);
      break;
    case 3: // X
      collector.addLineSegments(layer, color, [
        x - armSize, y - armSize, z, x + armSize, y + armSize, z,
        x - armSize, y + armSize, z, x + armSize, y - armSize, z,
      ]);
      break;
    case 4: // tick (short vertical line upward)
      collector.addLineSegments(layer, color, [
        x, y, z, x, y + armSize, z,
      ]);
      break;
  }

  // Circle
  if (hasCircle) {
    const data: number[] = [];
    for (let i = 0; i < POINT_SYMBOL_SEGMENTS; i++) {
      const a0 = (i / POINT_SYMBOL_SEGMENTS) * Math.PI * 2;
      const a1 = ((i + 1) / POINT_SYMBOL_SEGMENTS) * Math.PI * 2;
      data.push(
        x + halfSize * Math.cos(a0), y + halfSize * Math.sin(a0), z,
        x + halfSize * Math.cos(a1), y + halfSize * Math.sin(a1), z,
      );
    }
    collector.addLineSegments(layer, color, data);
  }

  // Square
  if (hasSquare) {
    collector.addLineSegments(layer, color, [
      x - halfSize, y - halfSize, z, x + halfSize, y - halfSize, z,
      x + halfSize, y - halfSize, z, x + halfSize, y + halfSize, z,
      x + halfSize, y + halfSize, z, x - halfSize, y + halfSize, z,
      x - halfSize, y + halfSize, z, x - halfSize, y - halfSize, z,
    ]);
  }
};

/**
 * Compute the effective point display size in drawing units from $PDSIZE header variable.
 * Returns half-size (radius) for use with point symbol rendering.
 */
export const computePointDisplaySize = (
  header: Record<string, unknown> | undefined,
): number => {
  if (!header) return POINT_SYMBOL_DEFAULT_SIZE;

  const pdSizeRaw = (header["$PDSIZE"] as number) ?? 0;

  if (pdSizeRaw > 0) return pdSizeRaw;

  if (pdSizeRaw < 0) return Math.abs(pdSizeRaw);

  // pdSizeRaw === 0: 5% of drawing area height
  const extMin = header["$EXTMIN"] as { x: number; y: number } | undefined;
  const extMax = header["$EXTMAX"] as { x: number; y: number } | undefined;
  if (extMin && extMax && extMax.x > extMin.x && extMax.y > extMin.y) {
    return (extMax.y - extMin.y) * 0.05;
  }

  return POINT_SYMBOL_DEFAULT_SIZE;
};

// ─── Collector-based entity processing ────────────────────────────────

/** Apply world matrix to points array in-place */
const applyWorld = (points: THREE.Vector3[], m?: THREE.Matrix4): THREE.Vector3[] => {
  if (m) for (const p of points) p.applyMatrix4(m);
  return points;
};

/**
 * Try to collect a simple entity into the GeometryCollector.
 * When worldMatrix is provided (block context), all points are transformed to world space.
 * Returns true if the entity was collected, false if it needs individual processing.
 */
const collectEntity = (p: CollectEntityParams): boolean => {
  const { entity, colorCtx, collector, layer, worldMatrix, overrideColor } = p;
  const entityColor = overrideColor ?? resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);
  const ltInfo = resolveEntityLinetype(
    entity,
    colorCtx.layers,
    colorCtx.lineTypes,
    colorCtx.globalLtScale,
    colorCtx.blockLineType,
    colorCtx.headerLtScale,
  );
  const pattern = ltInfo?.pattern;

  switch (entity.type) {
    case "LINE": {
      if (isLineEntity(entity)) {
        const v0 = entity.vertices[0];
        const v1 = entity.vertices[1];
        const points = [
          new THREE.Vector3(v0.x, v0.y, 0),
          new THREE.Vector3(v1.x, v1.y, 0),
        ];
        addLineToCollector(collector, layer, entityColor, applyWorld(points, worldMatrix), pattern);
        return true;
      }
      return false;
    }

    case "CIRCLE": {
      if (isCircleEntity(entity)) {
        const matrix = buildOcsMatrix(entity.extrusionDirection);
        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
          const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
          points.push(
            new THREE.Vector3(
              entity.center.x + entity.radius * Math.cos(angle),
              entity.center.y + entity.radius * Math.sin(angle),
              entity.center.z || 0,
            ),
          );
        }
        addLineToCollector(collector, layer, entityColor, applyWorld(transformOcsPoints(points, matrix), worldMatrix), pattern);
        return true;
      }
      return false;
    }

    case "ARC": {
      if (isArcEntity(entity)) {
        const matrix = buildOcsMatrix(entity.extrusionDirection);
        const startAngle = entity.startAngle;
        let endAngle = entity.endAngle;
        if (endAngle <= startAngle) {
          endAngle += Math.PI * 2;
        }
        const sweepAngle = endAngle - startAngle;
        const segments = Math.max(
          MIN_ARC_SEGMENTS,
          Math.floor((sweepAngle * CIRCLE_SEGMENTS) / (2 * Math.PI)),
        );

        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= segments; i++) {
          const angle = startAngle + (i / segments) * sweepAngle;
          points.push(
            new THREE.Vector3(
              entity.center.x + entity.radius * Math.cos(angle),
              entity.center.y + entity.radius * Math.sin(angle),
              entity.center.z || 0,
            ),
          );
        }
        addLineToCollector(collector, layer, entityColor, applyWorld(transformOcsPoints(points, matrix), worldMatrix), pattern);
        return true;
      }
      return false;
    }

    case "ELLIPSE": {
      if (isEllipseEntity(entity)) {
        // ELLIPSE center is in WCS — no OCS transform needed for position.
        // The major axis direction vector is in OCS, so transform it to WCS
        // for non-default extrusion (e.g. (0,0,-1) negates X, flipping arcs).
        let majorX = entity.majorAxisEndPoint.x;
        let majorY = entity.majorAxisEndPoint.y;
        const ocsMat = buildOcsMatrix(entity.extrusionDirection);
        if (ocsMat) {
          const dir = new THREE.Vector3(majorX, majorY, 0).applyMatrix4(ocsMat);
          majorX = dir.x;
          majorY = dir.y;
        }
        const majorLength = Math.sqrt(majorX * majorX + majorY * majorY);
        const minorLength = majorLength * entity.axisRatio;
        const rotation = Math.atan2(majorY, majorX);

        let startAngle = entity.startAngle;
        let endAngle = entity.endAngle;

        const isFullEllipse =
          Math.abs(endAngle - startAngle - 2 * Math.PI) < EPSILON ||
          Math.abs(endAngle - startAngle) < EPSILON;

        if (isFullEllipse) {
          startAngle = 0;
          endAngle = 2 * Math.PI;
        }

        let sweepAngle = endAngle - startAngle;
        // DXF ELLIPSE arcs are always CCW
        if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
        const segments = Math.max(
          MIN_ARC_SEGMENTS,
          Math.floor((Math.abs(sweepAngle) * CIRCLE_SEGMENTS) / (2 * Math.PI)),
        );

        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= segments; i++) {
          const t = startAngle + (i / segments) * sweepAngle;
          const localX = majorLength * Math.cos(t);
          const localY = minorLength * Math.sin(t);
          const worldX =
            entity.center.x + localX * Math.cos(rotation) - localY * Math.sin(rotation);
          const worldY =
            entity.center.y + localX * Math.sin(rotation) + localY * Math.cos(rotation);
          points.push(new THREE.Vector3(worldX, worldY, entity.center.z || 0));
        }

        addLineToCollector(collector, layer, entityColor, applyWorld(points, worldMatrix), pattern);
        return true;
      }
      return false;
    }

    case "LWPOLYLINE":
    case "POLYLINE": {
      if (isPolylineEntity(entity) && entity.vertices.length > 1) {
        // Polyface mesh: vertices define positions + face indices
        if (entity.isPolyfaceMesh) {
          addPolyfaceMeshEdges(collector, layer, entityColor, entity.vertices, worldMatrix);
          return true;
        }
        // 3D polygon mesh: vertices in M×N grid
        if (entity.is3dPolygonMesh && entity.meshMVertexCount && entity.meshNVertexCount) {
          addPolygonMeshEdges(collector, layer, entityColor, entity, worldMatrix);
          return true;
        }
        // Wide polyline: render as filled shape
        const polyWidth = entity.width || entity.defaultStartWidth || 0;
        if (polyWidth > 0) {
          const matrix = buildOcsMatrix(entity.extrusionDirection);
          addWidePolylineToCollector(collector, layer, entityColor, entity, matrix, worldMatrix);
          return true;
        }
        const matrix = buildOcsMatrix(entity.extrusionDirection);
        const allPoints = computePolylinePoints(entity);
        addLineToCollector(collector, layer, entityColor, applyWorld(transformOcsPoints(allPoints, matrix), worldMatrix), pattern);
        return true;
      }
      return false;
    }

    case "MLINE": {
      const mline = entity as DxfMlineEntity;
      if (mline.vertices?.length > 1 && mline.numElements > 0) {
        const matrix = buildOcsMatrix(mline.extrusionDirection);
        const closed = (mline.flags & 2) !== 0;
        for (let i = 0; i < mline.numElements; i++) {
          const points: THREE.Vector3[] = [];
          for (const v of mline.vertices) {
            const offset = v.elementParams[i]?.params[0] ?? 0;
            points.push(new THREE.Vector3(
              v.x + offset * v.miter.x,
              v.y + offset * v.miter.y,
              (v.z || 0) + offset * (v.miter.z || 0),
            ));
          }
          if (closed && points.length > 1) points.push(points[0].clone());
          addLineToCollector(collector, layer, entityColor,
            applyWorld(transformOcsPoints(points, matrix), worldMatrix), pattern);
        }
        return true;
      }
      return false;
    }

    case "SPLINE": {
      if (isSplineEntity(entity)) {
        const points = computeSplinePoints(entity);
        if (points) {
          addLineToCollector(collector, layer, entityColor, applyWorld(points, worldMatrix), pattern);
          return true;
        }
      }
      return false;
    }

    case "XLINE":
    case "RAY": {
      const xline = entity as DxfXlineEntity;
      if (xline.basePoint && xline.direction) {
        const bp = xline.basePoint;
        const dir = xline.direction;
        const clip = colorCtx.xlineClipSize ?? 1000;
        const t1 = entity.type === "RAY" ? 0 : -clip;
        const points = [
          new THREE.Vector3(bp.x + t1 * dir.x, bp.y + t1 * dir.y, (bp.z || 0) + t1 * (dir.z || 0)),
          new THREE.Vector3(bp.x + clip * dir.x, bp.y + clip * dir.y, (bp.z || 0) + clip * (dir.z || 0)),
        ];
        addLineToCollector(collector, layer, entityColor, applyWorld(points, worldMatrix), pattern);
        return true;
      }
      return false;
    }

    case "POINT": {
      if (isPointEntity(entity)) {
        const matrix = buildOcsMatrix(entity.extrusionDirection);
        const pos = transformOcsPoint(
          new THREE.Vector3(entity.position.x, entity.position.y, entity.position.z || 0),
          matrix,
        );
        if (worldMatrix) pos.applyMatrix4(worldMatrix);

        const pdMode = colorCtx.pdMode ?? 0;
        if (pdMode === 0) {
          // Default: simple dot
          collector.addPoint(layer, entityColor, pos.x, pos.y, pos.z);
        } else {
          const halfSize = (colorCtx.pointDisplaySize ?? POINT_SYMBOL_DEFAULT_SIZE) / 2;
          collectPointSymbol({ collector, layer, color: entityColor, x: pos.x, y: pos.y, z: pos.z, pdMode, halfSize });
        }
        return true;
      }
      return false;
    }

    case "SOLID": {
      if (isSolidEntity(entity)) {
        const matrix = buildOcsMatrix(entity.extrusionDirection);
        let pts: DxfVertex[] = entity.points;
        if (matrix) {
          pts = entity.points.map((p) => {
            const v = new THREE.Vector3(p.x, p.y, p.z || 0).applyMatrix4(matrix);
            return { x: v.x, y: v.y, z: v.z } as DxfVertex;
          });
        }
        if (worldMatrix) {
          pts = pts.map((p) => {
            const v = new THREE.Vector3(p.x, p.y, p.z || 0).applyMatrix4(worldMatrix);
            return { x: v.x, y: v.y, z: v.z } as DxfVertex;
          });
        }
        const faceData = computeFaceData(pts);
        if (faceData) {
          collector.addMesh(layer, entityColor, faceData.vertices, faceData.indices);
          return true;
        }
      }
      return false;
    }

    case "3DFACE": {
      if (is3DFaceEntity(entity)) {
        let pts: DxfVertex[] = entity.vertices;
        if (worldMatrix) {
          pts = pts.map((p) => {
            const v = new THREE.Vector3(p.x, p.y, p.z || 0).applyMatrix4(worldMatrix);
            return { x: v.x, y: v.y, z: v.z } as DxfVertex;
          });
        }
        add3DFaceEdges(collector, layer, entityColor, pts, entity.edgeFlags);
        return true;
      }
      return false;
    }

    case "HATCH": {
      if (isHatchEntity(entity) && entity.boundaryPaths.length > 0) {
        const hatchMatrix = buildOcsMatrix(entity.extrusionDirection);

        if (entity.solid) {
          // Build shapes with even-odd hole detection (handles DXF boundaries
          // where inner and outer arcs share the same winding direction).
          const shapes = buildSolidHatchShapes(entity.boundaryPaths);
          if (shapes.length === 0) return false;

          const v = new THREE.Vector3();
          for (const shape of shapes) {
            const shapePoints = shape.extractPoints(12);
            const triangles = THREE.ShapeUtils.triangulateShape(shapePoints.shape, shapePoints.holes);
            if (triangles.length === 0) continue;

            const allPts = shapePoints.shape.concat(...shapePoints.holes);
            const vertices: number[] = [];
            for (const pt of allPts) {
              v.set(pt.x, pt.y, 0);
              if (hatchMatrix) v.applyMatrix4(hatchMatrix);
              if (worldMatrix) v.applyMatrix4(worldMatrix);
              vertices.push(v.x, v.y, v.z);
            }
            const indices: number[] = [];
            for (const tri of triangles) {
              indices.push(tri[0], tri[1], tri[2]);
            }
            collector.addMesh(layer, entityColor, vertices, indices);
          }
          return true;
        } else {
          // Pattern hatch — flat arrays, direct collector write
          const polygons: Point2D[][] = entity.boundaryPaths
            .map((bp) => boundaryPathToPoint2DArray(bp))
            .filter((p) => p.length > 2);

          const hasEmbedded = entity.patternLines && entity.patternLines.length > 0;
          const patternLines = hasEmbedded
            ? entity.patternLines
            : HATCH_PATTERNS[entity.patternName.toUpperCase()];
          const effectiveScale = hasEmbedded ? 1 : entity.patternScale;
          const effectiveAngle = hasEmbedded ? 0 : entity.patternAngle;

          if (patternLines && polygons.length > 0) {
            const { segmentVertices, dotPositions } = generateHatchPattern(
              patternLines,
              polygons,
              effectiveScale,
              effectiveAngle,
              hasEmbedded,
            );

            // In-place OCS/world transform on flat arrays
            if ((hatchMatrix || worldMatrix) && segmentVertices.length > 0) {
              const v = new THREE.Vector3();
              for (let i = 0; i < segmentVertices.length; i += 3) {
                v.set(segmentVertices[i], segmentVertices[i + 1], segmentVertices[i + 2]);
                if (hatchMatrix) v.applyMatrix4(hatchMatrix);
                if (worldMatrix) v.applyMatrix4(worldMatrix);
                segmentVertices[i] = v.x;
                segmentVertices[i + 1] = v.y;
                segmentVertices[i + 2] = v.z;
              }
            }
            if (segmentVertices.length > 0) {
              collector.addLineSegments(layer, entityColor, segmentVertices);
            }

            if (dotPositions.length > 0) {
              if (hatchMatrix || worldMatrix) {
                const v = new THREE.Vector3();
                for (let i = 0; i < dotPositions.length; i += 3) {
                  v.set(dotPositions[i], dotPositions[i + 1], dotPositions[i + 2]);
                  if (hatchMatrix) v.applyMatrix4(hatchMatrix);
                  if (worldMatrix) v.applyMatrix4(worldMatrix);
                  dotPositions[i] = v.x;
                  dotPositions[i + 1] = v.y;
                  dotPositions[i + 2] = v.z;
                }
              }
              collector.addPoints(layer, entityColor, dotPositions);
            }
          } else {
            // No pattern lines — draw boundary outlines only
            for (const bp of entity.boundaryPaths) {
              const pts = boundaryPathToLinePoints(bp);
              if (pts.length > 1) {
                addLineToCollector(
                  collector,
                  layer,
                  entityColor,
                  applyWorld(transformOcsPoints(pts, hatchMatrix), worldMatrix),
                  pattern,
                );
              }
            }
          }
          return true;
        }
      }
      return false;
    }

    default:
      return false;
  }
};

// ─── Vector text collection ───────────────────────────────────────────

/**
 * Collect TEXT or MTEXT entity as vector glyphs into GeometryCollector.
 * Handles OCS transform and optional world matrix (for block inserts).
 */
const collectTextOrMText = (
  entity: DxfTextEntity,
  colorCtx: EntityColorContext,
  collector: GeometryCollector,
  layer: string,
  worldMatrix?: THREE.Matrix4,
): void => {
  const font = resolveEntityFont(entity.textStyle, colorCtx.styles, colorCtx.serifFont, colorCtx.font!);
  const entityColor = resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);
  const textContent = entity.text;
  if (!textContent) return;

  if (entity.type === "TEXT") {
    const textHeight = entity.height || entity.textHeight || colorCtx.defaultTextHeight;
    const ocsMatrix = buildOcsMatrix(entity.extrusionDirection);

    // Use endPoint for justified text, startPoint for LEFT/BASELINE
    const hasJustification =
      (entity.halign && entity.halign > 0) || (entity.valign && entity.valign > 0);
    const posCoord = hasJustification && entity.endPoint
      ? entity.endPoint
      : entity.position || entity.startPoint;
    if (!posCoord) return;

    let pos = transformOcsPoint(
      new THREE.Vector3(posCoord.x, posCoord.y, posCoord.z || 0),
      ocsMatrix,
    );
    let rotation = entity.rotation ? degreesToRadians(entity.rotation) : 0;
    let height = textHeight;

    // endPoint for FIT/ALIGNED modes
    let endX: number | undefined;
    let endY: number | undefined;
    if (entity.endPoint && entity.startPoint) {
      const ep = transformOcsPoint(
        new THREE.Vector3(entity.endPoint.x, entity.endPoint.y, entity.endPoint.z || 0),
        ocsMatrix,
      );
      const sp = transformOcsPoint(
        new THREE.Vector3(entity.startPoint.x, entity.startPoint.y, entity.startPoint.z || 0),
        ocsMatrix,
      );
      // For FIT/ALIGNED, addTextToCollector uses startPoint as posX/posY
      if (entity.halign === HAlign.FIT || entity.halign === HAlign.ALIGNED) {
        pos = sp;
        endX = ep.x;
        endY = ep.y;
      }
    }

    let mirrorWidthFactor = 1;
    if (worldMatrix) {
      pos.applyMatrix4(worldMatrix);
      if (endX !== undefined && endY !== undefined) {
        const ep = new THREE.Vector3(endX, endY, 0).applyMatrix4(worldMatrix);
        endX = ep.x;
        endY = ep.y;
      }
      const m = worldMatrix.elements;
      const det2x2 = m[0] * m[5] - m[1] * m[4];
      const isMirrored = det2x2 < 0;
      // When mirrored, negate direction to extract correct rotation without flip
      rotation += isMirrored
        ? Math.atan2(-m[1], -m[0])
        : Math.atan2(m[1], m[0]);
      height *= Math.sqrt(m[4] * m[4] + m[5] * m[5]);
      // $MIRRTEXT=1: mirror text with geometry; default (0): keep text readable
      if (isMirrored && colorCtx.mirrText) {
        mirrorWidthFactor = -1;
      }
    }

    const parsed = parseTextWithUnderline(textContent);
    addTextToCollector({
      collector, layer, color: entityColor, font,
      text: parsed.text, height,
      posX: pos.x, posY: pos.y, posZ: pos.z, rotation,
      hAlign: entity.halign ?? HAlign.LEFT,
      vAlign: entity.valign ?? VAlign.BASELINE,
      widthFactor: (entity.xScale ?? 1) * mirrorWidthFactor,
      endPosX: endX, endPosY: endY,
      underline: parsed.underline,
    });

  } else {
    // MTEXT
    const defaultHeight = entity.height || entity.textHeight || colorCtx.defaultTextHeight;
    const ocsMatrix = buildOcsMatrix(entity.extrusionDirection);
    const textPosition = entity.position || entity.startPoint;
    if (!textPosition) return;

    let pos = transformOcsPoint(
      new THREE.Vector3(textPosition.x, textPosition.y, textPosition.z || 0),
      ocsMatrix,
    );
    let rotation = entity.rotation ? degreesToRadians(entity.rotation) : 0;
    if (!entity.rotation && entity.directionVector) {
      rotation = Math.atan2(entity.directionVector.y, entity.directionVector.x);
    }
    let height = defaultHeight;

    if (worldMatrix) {
      pos.applyMatrix4(worldMatrix);
      const m = worldMatrix.elements;
      const det2x2 = m[0] * m[5] - m[1] * m[4];
      const isMirrored = det2x2 < 0;
      rotation += isMirrored
        ? Math.atan2(-m[1], -m[0])
        : Math.atan2(m[1], m[0]);
      height *= Math.sqrt(m[4] * m[4] + m[5] * m[5]);
    }

    const lines = parseMTextContent(textContent, height);
    addMTextToCollector({
      collector, layer, color: entityColor, font, lines, defaultHeight: height,
      posX: pos.x, posY: pos.y, posZ: pos.z, rotation,
      attachmentPoint: entity.attachmentPoint,
      // Skip word wrapping when width (code 41) is narrower than one character
      // (width < text height) — wrapping would put every character on its own line
      width: entity.width && entity.width >= height ? entity.width : undefined,
      serifFont: colorCtx.serifFont,
      lineSpacingFactor: entity.lineSpacingFactor,
    });

  }
};

/**
 * Collect ATTDEF entity as visible text into GeometryCollector.
 * AutoCAD displays ATTDEF tag (code 2) in model space when default value (code 1) is empty.
 */
const collectAttdefEntity = (
  entity: DxfAttdefEntity,
  colorCtx: EntityColorContext,
  collector: GeometryCollector,
  layer: string,
): void => {
  if (entity.invisible) return;
  const text = entity.text || entity.tag;
  if (!text) return;
  const posCoord = entity.startPoint;
  if (!posCoord) return;

  const entityColor = resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);
  const textHeight = entity.textHeight || colorCtx.defaultTextHeight;
  const ocsMatrix = buildOcsMatrix(entity.extrusionDirection);
  const pos = transformOcsPoint(
    new THREE.Vector3(posCoord.x, posCoord.y, posCoord.z || 0),
    ocsMatrix,
  );
  const rotation = entity.rotation ? degreesToRadians(entity.rotation) : 0;
  const font = resolveEntityFont(entity.textStyle, colorCtx.styles, colorCtx.serifFont, colorCtx.font!);

  addTextToCollector({
    collector, layer, color: entityColor, font,
    text: replaceSpecialChars(text), height: textHeight,
    posX: pos.x, posY: pos.y, posZ: pos.z, rotation,
    hAlign: entity.horizontalJustification ?? HAlign.LEFT,
    vAlign: entity.verticalJustification ?? VAlign.BASELINE,
    widthFactor: entity.scale,
    obliqueAngle: entity.obliqueAngle,
  });
};

/**
 * Collect DIMENSION entity: geometry (lines/arrows) decomposed into collector,
 * text rendered as vector glyphs directly into collector.
 */
const collectDimensionEntity = (
  entity: DxfEntity,
  _dxf: DxfData,
  colorCtx: EntityColorContext,
  collector: GeometryCollector,
  layer: string,
  worldMatrix?: THREE.Matrix4,
): void => {
  if (!isDimensionEntity(entity)) return;
  const font = resolveEntityFont(entity.styleName, colorCtx.styles, colorCtx.serifFont, colorCtx.font!);
  const entityColor = resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);
  const baseDimType = (entity.dimensionType ?? 0) & 0x0f;
  // Extract Matrix4 elements for text vertex transform inside block INSERTs
  const transform = worldMatrix ? Array.from(worldMatrix.elements) : undefined;
  const matrix = worldMatrix ?? new THREE.Matrix4();

  // Resolve dimension variables: header → DIMSTYLE → entity XDATA overrides
  const dimStyleEntry = entity.styleName && colorCtx.dimStyles?.[entity.styleName];
  let baseDv = colorCtx.dimVars ?? resolveDimVarsFromHeader(undefined);
  // Apply DIMSTYLE-level overrides (DIMSCALE, DIMTXT, DIMASZ) between header and entity
  if (dimStyleEntry) {
    baseDv = applyDimStyleVars(baseDv, dimStyleEntry, _dxf.header ?? undefined);
  }
  const dv = mergeEntityDimVars(baseDv, entity);

  // Resolve DIMLUNIT: DIMSTYLE → header → undefined (defaults)
  const dimlunit = dimStyleEntry ? dimStyleEntry.dimlunit : colorCtx.headerDimlunit;
  const dimzin = dimStyleEntry ? dimStyleEntry.dimzin : undefined;
  const dimFmt: DimFormatOptions | undefined = dimlunit !== undefined ? { dimlunit, dimzin } : undefined;

  // DIMCLRT: dimension text color from DIMSTYLE (ACI index)
  let textColor = entityColor;
  if (dimStyleEntry && dimStyleEntry.dimclrt !== undefined && dimStyleEntry.dimclrt > 0 && dimStyleEntry.dimclrt <= 255) {
    textColor = rgbNumberToHex(ACI_PALETTE[dimStyleEntry.dimclrt]);
  }

  // DIMTSZ / DIMBLK from DIMSTYLE overrides header values
  if (dimStyleEntry) {
    // Use DIMSTYLE's own DIMSCALE for tick scaling
    const styleDimScale = dimStyleEntry.dimscale;
    const headerDimScale = (_dxf.header?.["$DIMSCALE"] as number | undefined) ?? 1;
    const dimScale = (entity.dimScale ?? styleDimScale ?? headerDimScale) || 1;

    if (dimStyleEntry.dimtsz !== undefined && dimStyleEntry.dimtsz > 0) {
      dv.useTicks = true;
      dv.tickSize = dimStyleEntry.dimtsz * dimScale;
    } else if (dimStyleEntry.dimblkHandle && colorCtx.blockHandleToName) {
      const blockName = colorCtx.blockHandleToName.get(dimStyleEntry.dimblkHandle);
      if (blockName && isTickBlock(blockName)) {
        dv.useTicks = true;
        // No explicit DIMTSZ → tick size always follows arrow size
        // (entity XDATA may override arrowSize after base tickSize was set)
        dv.tickSize = dv.arrowSize;
      }
    }
  }

  let result: THREE.Object3D[] | null = null;

  // Ordinate dimension (type 6 = Y-ordinate, type 7 = X-ordinate)
  const dimParams = { entity, color: entityColor, font, collector, layer, transform, dv };
  if ((baseDimType & 0x0e) === 6) {
    result = createOrdinateDimension(dimParams);
  } else if (baseDimType === 2) {
    result = createAngularDimension(dimParams);
  } else if (baseDimType === 3) {
    result = createDiametricDimension(dimParams);
  } else if (baseDimType === 4) {
    result = createRadialDimension(dimParams);
  } else {
    // Linear/aligned dimension
    const dimData = extractDimensionData(entity, dv, dimFmt);
    if (!dimData) return;

    let dimAngle = dimData.angle;
    if (baseDimType === 1 && dimAngle === 0) {
      const dx = dimData.point2.x - dimData.point1.x;
      const dy = dimData.point2.y - dimData.point1.y;
      dimAngle = (Math.atan2(dy, dx) * DEGREES_TO_RADIANS_DIVISOR) / Math.PI;
    }

    // Compute text gap from actual text width so dimension line doesn't overlap text
    if (dimData.textPos && dimData.dimensionText && font) {
      const textWidth = measureDimensionTextWidth(font, dimData.dimensionText, dimData.textHeight);
      const padding = dimData.textHeight * 0.5;
      dv.textGap = Math.max(dv.textGap, textWidth + padding);
    }

    const dimGroup = createDimensionGroup({
      point1: dimData.point1, point2: dimData.point2, anchorPoint: dimData.anchorPoint,
      textPos: dimData.textPos, textHeight: dimData.textHeight, isRadial: dimData.isRadial,
      color: entityColor, angle: dimAngle, forceRotated: baseDimType === 0, dv,
    });
    result = [dimGroup];

    if (dimData.textPos) {
      let dimAngleRad = dimAngle !== 0 ? degreesToRadians(dimAngle) : 0;
      // Readability: flip text 180° if it would be upside-down
      if (dimAngleRad > Math.PI / 2) dimAngleRad -= Math.PI;
      if (dimAngleRad < -Math.PI / 2) dimAngleRad += Math.PI;
      addDimensionTextToCollector({
        collector, layer, color: textColor, font,
        rawText: dimData.dimensionText, height: dimData.textHeight,
        posX: dimData.textPos.x, posY: dimData.textPos.y, posZ: 0.2,
        rotation: dimAngleRad, hAlign: "center", transform,
      });
    }
  }

  // Decompose geometry objects (lines, arrows) into collector
  if (result) {
    for (const obj of result) {
      if (obj instanceof THREE.Group) {
        obj.updateMatrixWorld(true);
        obj.traverse((child) => {
          if (child === obj || child instanceof THREE.Group) return;
          const geo = (child as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
          if (!geo) return;
          const posAttr = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
          if (!posAttr) return;
          const mat = (child as THREE.Mesh).material as THREE.Material & { color?: THREE.Color };
          const childColor = mat?.color ? "#" + mat.color.getHexString() : entityColor;
          const v = new THREE.Vector3();

          if (child instanceof THREE.LineSegments || child instanceof THREE.Line) {
            const count = posAttr.count;
            for (let i = 0; i < count - 1; i += (child instanceof THREE.LineSegments ? 2 : 1)) {
              v.fromBufferAttribute(posAttr, i).applyMatrix4(child.matrixWorld).applyMatrix4(matrix);
              const x1 = v.x, y1 = v.y, z1 = v.z;
              v.fromBufferAttribute(posAttr, i + 1).applyMatrix4(child.matrixWorld).applyMatrix4(matrix);
              collector.addLineSegments(layer, childColor, [x1, y1, z1, v.x, v.y, v.z]);
            }
          } else if (child instanceof THREE.Mesh) {
            const count = posAttr.count;
            const positions: number[] = [];
            for (let i = 0; i < count; i++) {
              v.fromBufferAttribute(posAttr, i).applyMatrix4(child.matrixWorld).applyMatrix4(matrix);
              positions.push(v.x, v.y, v.z);
            }
            const index = geo.getIndex();
            const indices = index ? Array.from(index.array) : [];
            if (indices.length === 0) {
              for (let i = 0; i < count; i++) indices.push(i);
            }
            collector.addMesh(layer, childColor, positions, indices);
          }
        });
      } else {
        // Single object (Line, Mesh)
        const geo = (obj as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (!geo) continue;
        const posAttr = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
        if (!posAttr) continue;
        const mat = (obj as THREE.Mesh).material as THREE.Material & { color?: THREE.Color };
        const objColor = mat?.color ? "#" + mat.color.getHexString() : entityColor;
        const v = new THREE.Vector3();

        if (obj instanceof THREE.LineSegments || obj instanceof THREE.Line) {
          const count = posAttr.count;
          for (let i = 0; i < count - 1; i += (obj instanceof THREE.LineSegments ? 2 : 1)) {
            v.fromBufferAttribute(posAttr, i).applyMatrix4(matrix);
            const x1 = v.x, y1 = v.y, z1 = v.z;
            v.fromBufferAttribute(posAttr, i + 1).applyMatrix4(matrix);
            collector.addLineSegments(layer, objColor, [x1, y1, z1, v.x, v.y, v.z]);
          }
        } else if (obj instanceof THREE.Mesh) {
          const count = posAttr.count;
          const positions: number[] = [];
          for (let i = 0; i < count; i++) {
            v.fromBufferAttribute(posAttr, i).applyMatrix4(matrix);
            positions.push(v.x, v.y, v.z);
          }
          const index = geo.getIndex();
          const indices = index ? Array.from(index.array) : [];
          if (indices.length === 0) {
            for (let i = 0; i < count; i++) indices.push(i);
          }
          collector.addMesh(layer, objColor, positions, indices);
        }
      }
    }
  }
};

/**
 * Catmull-Rom spline interpolation through given points.
 * Returns a smooth polyline that passes through all input points.
 */
const catmullRomSpline = (points: THREE.Vector3[], segmentsPerSpan = 12): THREE.Vector3[] => {
  if (points.length <= 2) return points;
  const result: THREE.Vector3[] = [];
  const n = points.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];
    for (let t = 0; t < segmentsPerSpan; t++) {
      const s = t / segmentsPerSpan;
      const s2 = s * s;
      const s3 = s2 * s;
      result.push(new THREE.Vector3(
        0.5 * (2 * p1.x + (-p0.x + p2.x) * s + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s3),
        0.5 * (2 * p1.y + (-p0.y + p2.y) * s + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s3),
        0.5 * (2 * p1.z + (-p0.z + p2.z) * s + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * s2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * s3),
      ));
    }
  }
  result.push(points[n - 1]);
  return result;
};

/**
 * Collect LEADER/MULTILEADER entity: lines and arrows decomposed into collector,
 * text rendered as vector glyphs directly into collector.
 */
const collectLeaderEntity = (
  entity: DxfEntity,
  _dxf: DxfData,
  colorCtx: EntityColorContext,
  collector: GeometryCollector,
  layer: string,
  worldMatrix?: THREE.Matrix4,
): void => {
  const styleName = isLeaderEntity(entity) ? entity.styleName : undefined;
  const font = resolveEntityFont(styleName, colorCtx.styles, colorCtx.serifFont, colorCtx.font!);
  const entityColor = resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);
  const matrix = worldMatrix ?? new THREE.Matrix4();
  const v = new THREE.Vector3();

  const addLineToCollector = (points: THREE.Vector3[]) => {
    for (let i = 0; i < points.length - 1; i++) {
      v.copy(points[i]).applyMatrix4(matrix);
      const x1 = v.x, y1 = v.y, z1 = v.z;
      v.copy(points[i + 1]).applyMatrix4(matrix);
      collector.addLineSegments(layer, entityColor, [x1, y1, z1, v.x, v.y, v.z]);
    }
  };

  const addArrowToCollector = (from: THREE.Vector3, to: THREE.Vector3, size: number) => {
    const arrow = createArrow(from, to, size, getMeshMaterial(entityColor, colorCtx.meshMaterialCache));
    const geo = arrow.geometry as THREE.BufferGeometry;
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
    const count = posAttr.count;
    const positions: number[] = [];
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(matrix);
      positions.push(v.x, v.y, v.z);
    }
    const index = geo.getIndex();
    const indices = index ? Array.from(index.array) : [];
    if (indices.length === 0) {
      for (let i = 0; i < count; i++) indices.push(i);
    }
    collector.addMesh(layer, entityColor, positions, indices);
  };

  // Resolve arrow block for LEADER: DIMSTYLE code 341 (DIMLDRBLK) → block name
  const leaderStyleName = isLeaderEntity(entity) ? entity.styleName : undefined;
  const leaderDimStyle = leaderStyleName ? colorCtx.dimStyles?.[leaderStyleName] : undefined;
  const baseDv = colorCtx.dimVars ?? resolveDimVarsFromHeader(undefined);

  // Resolve leader arrow block name from DIMLDRBLK (code 341) only.
  // Do NOT fall back to DIMBLK (code 342) — that's for dimension arrowheads.
  // When DIMLDRBLK is unset, leaders use the default filled arrow.
  let leaderArrowBlockName: string | undefined;
  if (colorCtx.blockHandleToName) {
    const ldrHandle = leaderDimStyle?.dimldrblkHandle;
    if (ldrHandle) leaderArrowBlockName = colorCtx.blockHandleToName.get(ldrHandle);
  }

  // Render a block definition at a point with rotation (for custom arrow blocks)
  const addBlockArrowToCollector = (
    blockName: string, tip: THREE.Vector3, angle: number, scale: number,
  ) => {
    const block = _dxf.blocks?.[blockName];
    if (!block?.entities) return false;
    const blockMatrix = new THREE.Matrix4()
      .makeTranslation(tip.x, tip.y, tip.z)
      .multiply(new THREE.Matrix4().makeRotationZ(angle))
      .multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
    if (worldMatrix) blockMatrix.premultiply(worldMatrix);
    for (const be of block.entities) {
      if (be.type === "LINE" && "vertices" in be) {
        const verts = be.vertices as { x: number; y: number; z?: number }[];
        if (verts.length >= 2) {
          v.set(verts[0].x, verts[0].y, verts[0].z || 0).applyMatrix4(blockMatrix);
          const x1 = v.x, y1 = v.y, z1 = v.z;
          v.set(verts[1].x, verts[1].y, verts[1].z || 0).applyMatrix4(blockMatrix);
          collector.addLineSegments(layer, entityColor, [x1, y1, z1, v.x, v.y, v.z]);
        }
      }
    }
    return true;
  };

  const addTickToCollector = (point: THREE.Vector3, dimAngle: number) => {
    const tick = createTick(point, baseDv.tickSize || baseDv.arrowSize, dimAngle,
      getLineMaterial(entityColor, colorCtx.materialCache));
    const geo = tick.geometry as THREE.BufferGeometry;
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
    const verts: number[] = [];
    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(matrix);
      verts.push(v.x, v.y, v.z);
    }
    collector.addLineSegments(layer, entityColor, verts);
  };

  if (entity.type === "LEADER" && isLeaderEntity(entity) && entity.vertices.length >= 2) {
    const rawPoints = entity.vertices.map(
      (vt) => new THREE.Vector3(vt.x, vt.y, vt.z || 0),
    );
    // Spline path (code 72 = 1): interpolate as Catmull-Rom curve
    const points = entity.pathType === 1 ? catmullRomSpline(rawPoints) : rawPoints;
    addLineToCollector(points);

    // arrowHeadFlag: 0 = no arrow, 1 or undefined = with arrow (DXF default)
    if (entity.arrowHeadFlag !== 0 && rawPoints.length >= 2) {
      // Arrow direction from spline tangent at tip (first two interpolated points)
      const dx = points[0].x - points[1].x;
      const dy = points[0].y - points[1].y;
      const angle = Math.atan2(dy, dx);
      let drawn = false;
      // Try custom arrow block from DIMLDRBLK
      if (leaderArrowBlockName && !isTickBlock(leaderArrowBlockName)) {
        drawn = addBlockArrowToCollector(leaderArrowBlockName, points[0], angle, baseDv.arrowSize);
      }
      if (!drawn) {
        // Leaders use ticks only if DIMLDRBLK explicitly specifies a tick block.
        // Do NOT inherit useTicks from baseDv — that's for dimension arrowheads.
        if (leaderArrowBlockName && isTickBlock(leaderArrowBlockName)) {
          addTickToCollector(points[0], angle);
        } else {
          addArrowToCollector(points[1], points[0], baseDv.arrowSize);
        }
      }
    }
  } else if ((entity.type === "MULTILEADER" || entity.type === "MLEADER") && isMLeaderEntity(entity) && entity.leaders.length > 0) {
    const arrowSize = entity.arrowSize || ARROW_SIZE;

    for (const leader of entity.leaders) {
      for (const line of leader.lines) {
        if (line.vertices.length < 2) continue;
        const points = line.vertices.map(
          (vt) => new THREE.Vector3(vt.x, vt.y, vt.z || 0),
        );
        if (leader.lastLeaderPoint) {
          points.push(new THREE.Vector3(
            leader.lastLeaderPoint.x,
            leader.lastLeaderPoint.y,
            leader.lastLeaderPoint.z || 0,
          ));
        }
        addLineToCollector(points);

        if (entity.hasArrowHead !== false && points.length >= 2) {
          addArrowToCollector(points[1], points[0], arrowSize);
        }
      }
    }

    if (entity.text && entity.textPosition) {
      const textHeight = entity.textHeight || colorCtx.defaultTextHeight;
      const textContent = replaceSpecialChars(entity.text);
      if (textContent) {
        let posX = entity.textPosition.x;
        let posY = entity.textPosition.y;
        if (worldMatrix) {
          v.set(posX, posY, 0).applyMatrix4(worldMatrix);
          posX = v.x;
          posY = v.y;
        }
        addTextToCollector({
          collector, layer, color: entityColor, font, text: textContent, height: textHeight,
          posX, posY, posZ: 0, hAlign: HAlign.LEFT, vAlign: VAlign.MIDDLE,
        });
      }
    }
  }
};

// ─── INSERT block collection ──────────────────────────────────────────

const MAX_RECURSION_DEPTH = 10;

/**
 * Collect INSERT block entities into the GeometryCollector.
 * Simple entities are merged; complex ones (TEXT, DIMENSION, LEADER)
 * are created as individual objects and added to fallbackGroup.
 */
const collectInsertEntity = async (
  insertEntity: DxfEntity,
  dxf: DxfData,
  colorCtx: EntityColorContext,
  collector: GeometryCollector,
  insertLayer: string,
  parentMatrix: THREE.Matrix4 | null,
  fallbackGroup: THREE.Group,
  depth: number,
  yieldState: YieldState,
  blockTemplates?: Map<string, BlockTemplate>,
  sharedBlockGeos?: Map<string, SharedBlockGeo>,
): Promise<void> => {
  if (depth > MAX_RECURSION_DEPTH || !isInsertEntity(insertEntity)) return;
  if (!dxf.blocks || typeof dxf.blocks !== "object") return;

  const block = dxf.blocks[insertEntity.name];
  if (!block?.entities?.length) return;

  // Array INSERT: columnCount × rowCount grid of block instances
  const cols = insertEntity.columnCount ?? 1;
  const rows = insertEntity.rowCount ?? 1;
  const colSpacing = insertEntity.columnSpacing ?? 0;
  const rowSpacing = insertEntity.rowSpacing ?? 0;

  // Block color context for ByBlock inheritance (shared across all array instances)
  const insertColor = resolveEntityColor(insertEntity, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);
  const blockColorCtx: EntityColorContext = {
    ...colorCtx,
    blockColor: insertColor,
    blockLineType: insertEntity.lineType || colorCtx.blockLineType,
  };

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {

  // Compute INSERT transform matrix: position + rotation + scale + array offset
  const pos = insertEntity.position;

  // Auto-scale blocks by $INSUNITS vs BLOCK_RECORD units
  const drawingUnits = (dxf.header?.["$INSUNITS"] as number) ?? 0;
  const blockRecord = dxf.tables?.blockRecord;
  const blockUnits = (blockRecord as { blockRecords?: Record<string, { units: number }> })?.blockRecords?.[insertEntity.name]?.units ?? 0;
  const unitScale = getInsUnitsScale(drawingUnits, blockUnits);

  const insertMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(
      pos.x + col * colSpacing,
      pos.y + row * rowSpacing,
      pos.z || 0,
    ),
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      insertEntity.rotation ? degreesToRadians(insertEntity.rotation) : 0,
    ),
    new THREE.Vector3(
      (insertEntity.xScale || 1) * unitScale,
      (insertEntity.yScale || 1) * unitScale,
      (insertEntity.zScale || 1) * unitScale,
    ),
  );

  // Apply OCS transform
  const ocsMatrix = buildOcsMatrix(insertEntity.extrusionDirection);
  if (ocsMatrix) insertMatrix.premultiply(ocsMatrix);

  // Compose with parent matrix (for nested blocks)
  const worldMatrix = parentMatrix
    ? new THREE.Matrix4().multiplyMatrices(parentMatrix, insertMatrix)
    : insertMatrix;

  // Fast path: use cached template if available
  const template = blockTemplates?.get(insertEntity.name);
  if (template) {
    // Shared geometry path: GPU stores block geometry once, each INSERT is just a matrix
    const shared = sharedBlockGeos?.get(insertEntity.name);
    if (shared) {
      addSharedBlockInstance(shared, fallbackGroup, insertLayer, insertColor, worldMatrix, colorCtx);
    } else {
      // Flat copy fallback (should not normally happen)
      instantiateBlockTemplate(template, collector, insertLayer, insertColor, worldMatrix);
    }

    // Process fallback entities individually (TEXT, nested INSERT, etc.)
    for (const idx of template.fallbackEntityIndices) {
      const entity = block.entities[idx];
      if (entity.visible === false) continue;
      try {
        const entityLayer = (!entity.layer || entity.layer === "0") ? insertLayer : entity.layer;

        // Nested INSERT: recurse (with blockTemplates for nested fast path)
        if (entity.type === "INSERT" && isInsertEntity(entity)) {
          await collectInsertEntity(entity, dxf, blockColorCtx, collector, entityLayer, worldMatrix, fallbackGroup, depth + 1, yieldState, blockTemplates, sharedBlockGeos);
          continue;
        }

        // Try simple collection
        if (COLLECTABLE_TYPES.has(entity.type)) {
          if (collectEntity({ entity, colorCtx: blockColorCtx, collector, layer: entityLayer, worldMatrix })) {
            continue;
          }
        }

        // Vector text intercepts for block entities
        if ((entity.type === "TEXT" || entity.type === "MTEXT") && isTextEntity(entity)) {
          collectTextOrMText(entity, blockColorCtx, collector, entityLayer, worldMatrix);
          continue;
        }
        if (entity.type === "DIMENSION" && isDimensionEntity(entity)) {
          collectDimensionEntity(entity, dxf, blockColorCtx, collector, entityLayer, worldMatrix);
          continue;
        }
        if (entity.type === "LEADER" || entity.type === "MULTILEADER" || entity.type === "MLEADER") {
          collectLeaderEntity(entity, dxf, blockColorCtx, collector, entityLayer, worldMatrix);
          continue;
        }

        // Complex entities — fallback to individual Three.js objects
        const obj = processEntity(entity, dxf, blockColorCtx, depth + 1);
        if (obj) {
          if (Array.isArray(obj)) {
            for (const o of obj) {
              o.applyMatrix4(worldMatrix);
              o.userData.layerName = entityLayer;
              fallbackGroup.add(o);
            }
          } else {
            obj.applyMatrix4(worldMatrix);
            obj.userData.layerName = entityLayer;
            fallbackGroup.add(obj);
          }
        }
      } catch (error) {
        console.warn(`Error processing fallback entity in block "${insertEntity.name}":`, error);
      }
    }

    // Handle ATTRIBs for template path (only for first array instance)
    if (row === 0 && col === 0 && insertEntity.attribs && insertEntity.attribs.length > 0) {
      for (const attrib of insertEntity.attribs) {
        if (attrib.invisible) continue;
        const text = attrib.text;
        if (!text) continue;

        const attribColor = resolveEntityColor(attrib, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);
        const textHeight = attrib.textHeight || colorCtx.defaultTextHeight;

        const hasJustification =
          (attrib.horizontalJustification && attrib.horizontalJustification > 0) ||
          (attrib.verticalJustification && attrib.verticalJustification > 0);
        const posCoord = hasJustification && attrib.endPoint
          ? attrib.endPoint
          : attrib.startPoint;
        if (!posCoord) continue;

        const attribMatrix = buildOcsMatrix(attrib.extrusionDirection);
        const attribPos = transformOcsPoint(
          new THREE.Vector3(posCoord.x, posCoord.y, 0),
          attribMatrix,
        );

        const rotation = attrib.rotation ? degreesToRadians(attrib.rotation) : 0;
        const attribFont = resolveEntityFont(attrib.textStyle, colorCtx.styles, colorCtx.serifFont, colorCtx.font!);
        addTextToCollector({
          collector, layer: insertLayer, color: attribColor, font: attribFont,
          text: replaceSpecialChars(text), height: textHeight,
          posX: attribPos.x, posY: attribPos.y, posZ: attribPos.z, rotation,
          hAlign: attrib.horizontalJustification ?? HAlign.LEFT,
          vAlign: attrib.verticalJustification ?? VAlign.BASELINE,
          widthFactor: attrib.scale,
          obliqueAngle: attrib.obliqueAngle,
        });
      }
    }

    continue;
  }

  // Slow path: process every entity individually
  for (const entity of block.entities) {
    if (entity.visible === false) continue;
    try {
      // Layer "0" inside block inherits INSERT's layer
      const entityLayer = (!entity.layer || entity.layer === "0") ? insertLayer : entity.layer;

      // Nested INSERT: recurse (with blockTemplates for nested fast path)
      if (entity.type === "INSERT" && isInsertEntity(entity)) {
        await collectInsertEntity(entity, dxf, blockColorCtx, collector, entityLayer, worldMatrix, fallbackGroup, depth + 1, yieldState, blockTemplates, sharedBlockGeos);
        continue;
      }

      // Try to collect simple geometry with world matrix
      if (COLLECTABLE_TYPES.has(entity.type)) {
        if (collectEntity({ entity, colorCtx: blockColorCtx, collector, layer: entityLayer, worldMatrix })) {
          continue;
        }
      }

      // Vector text intercepts for block entities
      if ((entity.type === "TEXT" || entity.type === "MTEXT") && isTextEntity(entity)) {
        collectTextOrMText(entity, blockColorCtx, collector, entityLayer, worldMatrix);
        continue;
      }
      if (entity.type === "DIMENSION" && isDimensionEntity(entity)) {
        collectDimensionEntity(entity, dxf, blockColorCtx, collector, entityLayer, worldMatrix);
        continue;
      }
      if (entity.type === "LEADER" || entity.type === "MULTILEADER" || entity.type === "MLEADER") {
        collectLeaderEntity(entity, dxf, blockColorCtx, collector, entityLayer, worldMatrix);
        continue;
      }

      const obj = processEntity(entity, dxf, blockColorCtx, depth + 1);
      if (obj) {
        if (Array.isArray(obj)) {
          for (const o of obj) {
            o.applyMatrix4(worldMatrix);
            o.userData.layerName = entityLayer;
            fallbackGroup.add(o);
          }
        } else {
          obj.applyMatrix4(worldMatrix);
          obj.userData.layerName = entityLayer;
          fallbackGroup.add(obj);
        }
      }
    } catch (error) {
      console.warn(`Error processing entity in block "${insertEntity.name}":`, error);
    }

    // Yield to browser to keep UI responsive during large blocks
    if (performance.now() - yieldState.lastYield > CHUNK_TIME_MS) {
      if (yieldState.signal?.cancelled) return;
      await yieldToMain();
      yieldState.lastYield = performance.now();
    }
  }

  // Handle ATTRIB entities (only for first array instance)
  if (row === 0 && col === 0 && insertEntity.attribs && insertEntity.attribs.length > 0) {
    for (const attrib of insertEntity.attribs) {
      if (attrib.invisible) continue;
      const text = attrib.text;
      if (!text) continue;

      const attribColor = resolveEntityColor(attrib, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);
      const textHeight = attrib.textHeight || colorCtx.defaultTextHeight;

      const hasJustification =
        (attrib.horizontalJustification && attrib.horizontalJustification > 0) ||
        (attrib.verticalJustification && attrib.verticalJustification > 0);
      const posCoord = hasJustification && attrib.endPoint
        ? attrib.endPoint
        : attrib.startPoint;
      if (!posCoord) continue;

      const attribMatrix = buildOcsMatrix(attrib.extrusionDirection);
      const attribPos = transformOcsPoint(
        new THREE.Vector3(posCoord.x, posCoord.y, 0),
        attribMatrix,
      );

      const rotation = attrib.rotation ? degreesToRadians(attrib.rotation) : 0;
      const attribFont = resolveEntityFont(attrib.textStyle, colorCtx.styles, colorCtx.serifFont, colorCtx.font!);
      addTextToCollector({
        collector, layer: insertLayer, color: attribColor, font: attribFont,
        text: replaceSpecialChars(text), height: textHeight,
        posX: attribPos.x, posY: attribPos.y, posZ: attribPos.z, rotation,
        hAlign: attrib.horizontalJustification ?? HAlign.LEFT,
        vAlign: attrib.verticalJustification ?? VAlign.BASELINE,
        widthFactor: attrib.scale,
        obliqueAngle: attrib.obliqueAngle,
      });
    }
  }

  } // for col
  } // for row
};

// ─── Object-based entity processing (for blocks and complex entities) ──

const createFaceMesh = (
  pts: DxfVertex[],
  material: THREE.MeshBasicMaterial,
): THREE.Mesh | null => {
  if (!pts || pts.length < 3) return null;

  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const indices: number[] = [];

  for (const p of pts) {
    vertices.push(p.x, p.y, p.z || 0);
  }

  indices.push(0, 1, 2);
  if (pts.length >= 4) {
    indices.push(0, 2, 3);
  }

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);

  return new THREE.Mesh(geometry, material);
};

/**
 * Process entity into Three.js objects. Used for entity types that cannot
 * be collected/merged (HATCH, SOLID, 3DFACE, POINT).
 */
const processEntity = (
  entity: DxfEntity,
  _dxf: DxfData,
  colorCtx: EntityColorContext,
  _depth = 0,
): THREE.Object3D | THREE.Object3D[] | null => {
  const entityColor = resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);
  const ltInfo = resolveEntityLinetype(
    entity,
    colorCtx.layers,
    colorCtx.lineTypes,
    colorCtx.globalLtScale,
    colorCtx.blockLineType,
    colorCtx.headerLtScale,
  );
  const lineMaterial = getLineMaterial(entityColor, colorCtx.materialCache);

  switch (entity.type) {
    case "LINE": {
      if (isLineEntity(entity)) {
        const vertex0 = entity.vertices[0];
        const vertex1 = entity.vertices[1];
        const points = [
          new THREE.Vector3(vertex0.x, vertex0.y, 0),
          new THREE.Vector3(vertex1.x, vertex1.y, 0),
        ];
        return createLine(points, lineMaterial, ltInfo?.pattern);
      }
      break;
    }

    case "CIRCLE": {
      if (isCircleEntity(entity)) {
        const matrix = buildOcsMatrix(entity.extrusionDirection);
        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
          const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
          points.push(
            new THREE.Vector3(
              entity.center.x + entity.radius * Math.cos(angle),
              entity.center.y + entity.radius * Math.sin(angle),
              entity.center.z || 0,
            ),
          );
        }
        return createLine(transformOcsPoints(points, matrix), lineMaterial, ltInfo?.pattern);
      }
      break;
    }

    case "ARC": {
      if (isArcEntity(entity)) {
        const matrix = buildOcsMatrix(entity.extrusionDirection);
        const startAngle = entity.startAngle;
        let endAngle = entity.endAngle;
        if (endAngle <= startAngle) {
          endAngle += Math.PI * 2;
        }
        const sweepAngle = endAngle - startAngle;
        const segments = Math.max(
          MIN_ARC_SEGMENTS,
          Math.floor((sweepAngle * CIRCLE_SEGMENTS) / (2 * Math.PI)),
        );

        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= segments; i++) {
          const angle = startAngle + (i / segments) * sweepAngle;
          points.push(
            new THREE.Vector3(
              entity.center.x + entity.radius * Math.cos(angle),
              entity.center.y + entity.radius * Math.sin(angle),
              entity.center.z || 0,
            ),
          );
        }
        return createLine(transformOcsPoints(points, matrix), lineMaterial, ltInfo?.pattern);
      }
      break;
    }

    case "ELLIPSE": {
      if (isEllipseEntity(entity)) {
        // ELLIPSE center is in WCS — no OCS transform for position.
        // Major axis direction is in OCS — transform for non-default extrusion.
        let majorX = entity.majorAxisEndPoint.x;
        let majorY = entity.majorAxisEndPoint.y;
        const ocsMat = buildOcsMatrix(entity.extrusionDirection);
        if (ocsMat) {
          const dir = new THREE.Vector3(majorX, majorY, 0).applyMatrix4(ocsMat);
          majorX = dir.x;
          majorY = dir.y;
        }
        const majorLength = Math.sqrt(majorX * majorX + majorY * majorY);
        const minorLength = majorLength * entity.axisRatio;
        const rotation = Math.atan2(majorY, majorX);

        let startAngle = entity.startAngle;
        let endAngle = entity.endAngle;

        const isFullEllipse =
          Math.abs(endAngle - startAngle - 2 * Math.PI) < EPSILON ||
          Math.abs(endAngle - startAngle) < EPSILON;

        if (isFullEllipse) {
          startAngle = 0;
          endAngle = 2 * Math.PI;
        }

        let sweepAngle = endAngle - startAngle;
        // DXF ELLIPSE arcs are always CCW
        if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
        const segments = Math.max(
          MIN_ARC_SEGMENTS,
          Math.floor((Math.abs(sweepAngle) * CIRCLE_SEGMENTS) / (2 * Math.PI)),
        );

        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= segments; i++) {
          const t = startAngle + (i / segments) * sweepAngle;
          const localX = majorLength * Math.cos(t);
          const localY = minorLength * Math.sin(t);
          const worldX =
            entity.center.x + localX * Math.cos(rotation) - localY * Math.sin(rotation);
          const worldY =
            entity.center.y + localX * Math.sin(rotation) + localY * Math.cos(rotation);
          points.push(new THREE.Vector3(worldX, worldY, entity.center.z || 0));
        }

        return createLine(points, lineMaterial, ltInfo?.pattern);
      }
      break;
    }

    case "LWPOLYLINE":
    case "POLYLINE": {
      if (isPolylineEntity(entity) && entity.vertices.length > 1) {
        if (entity.isPolyfaceMesh || (entity.is3dPolygonMesh && entity.meshMVertexCount && entity.meshNVertexCount)) {
          const tmpCollector = new GeometryCollector();
          if (entity.isPolyfaceMesh) {
            addPolyfaceMeshEdges(tmpCollector, entity.layer || "0", entityColor, entity.vertices);
          } else {
            addPolygonMeshEdges(tmpCollector, entity.layer || "0", entityColor, entity);
          }
          const objects = tmpCollector.flush(colorCtx.materialCache, colorCtx.meshMaterialCache, colorCtx.pointsMaterialCache);
          if (objects.length > 0) {
            const group = new THREE.Group();
            for (const obj of objects) group.add(obj);
            return group;
          }
          return null;
        }
        const polyWidth = entity.width || entity.defaultStartWidth || 0;
        if (polyWidth > 0) {
          const tmpCollector = new GeometryCollector();
          const matrix = buildOcsMatrix(entity.extrusionDirection);
          addWidePolylineToCollector(tmpCollector, entity.layer || "0", entityColor, entity, matrix);
          const objects = tmpCollector.flush(colorCtx.materialCache, colorCtx.meshMaterialCache, colorCtx.pointsMaterialCache);
          if (objects.length > 0) {
            const group = new THREE.Group();
            for (const obj of objects) group.add(obj);
            return group;
          }
          return null;
        }
        const matrix = buildOcsMatrix(entity.extrusionDirection);
        const allPoints = computePolylinePoints(entity);
        return createLine(transformOcsPoints(allPoints, matrix), lineMaterial, ltInfo?.pattern);
      }
      break;
    }

    case "SPLINE": {
      if (isSplineEntity(entity)) {
        const points = computeSplinePoints(entity);
        if (points) {
          return createLine(points, lineMaterial, ltInfo?.pattern);
        }
      }
      break;
    }

    // TEXT and MTEXT are handled by the vector text path (collectTextOrMText)
    case "TEXT":
    case "MTEXT":
      break;

    // DIMENSION is handled by the vector text path (collectDimensionEntity)
    case "DIMENSION":
      break;

    case "SOLID": {
      if (isSolidEntity(entity)) {
        const matrix = buildOcsMatrix(entity.extrusionDirection);
        const meshMat = getMeshMaterial(entityColor, colorCtx.meshMaterialCache);
        if (matrix) {
          const transformed = entity.points.map((p) => {
            const v = new THREE.Vector3(p.x, p.y, p.z || 0).applyMatrix4(matrix);
            return { x: v.x, y: v.y, z: v.z } as DxfVertex;
          });
          return createFaceMesh(transformed, meshMat);
        }
        return createFaceMesh(entity.points, meshMat);
      }
      break;
    }

    case "3DFACE": {
      if (is3DFaceEntity(entity)) {
        const pts = entity.vertices;
        const flags = entity.edgeFlags ?? 0;
        const n = pts.length;
        if (n < 3) break;
        const edges: [number, number][] = n >= 4
          ? [[0, 1], [1, 2], [2, 3], [3, 0]]
          : [[0, 1], [1, 2], [2, 0]];
        const verts: number[] = [];
        for (let i = 0; i < edges.length; i++) {
          if (flags & (1 << i)) continue;
          const [a, b] = edges[i];
          verts.push(pts[a].x, pts[a].y, pts[a].z || 0, pts[b].x, pts[b].y, pts[b].z || 0);
        }
        if (verts.length === 0) break;
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
        const lineMat = getLineMaterial(entityColor, colorCtx.materialCache);
        return new THREE.LineSegments(geom, lineMat);
      }
      break;
    }

    case "POINT": {
      if (isPointEntity(entity)) {
        const matrix = buildOcsMatrix(entity.extrusionDirection);
        const pos = transformOcsPoint(
          new THREE.Vector3(entity.position.x, entity.position.y, entity.position.z || 0),
          matrix,
        );

        const pdMode = colorCtx.pdMode ?? 0;
        if (pdMode === 0) {
          const geometry = new THREE.BufferGeometry().setFromPoints([pos]);
          const pointMat = getPointsMaterial(entityColor, colorCtx.pointsMaterialCache);
          return new THREE.Points(geometry, pointMat);
        }

        // Use a temporary collector to generate PDMODE symbol geometry
        const tmpCollector = new GeometryCollector();
        const halfSize = (colorCtx.pointDisplaySize ?? POINT_SYMBOL_DEFAULT_SIZE) / 2;
        collectPointSymbol({ collector: tmpCollector, layer: entity.layer || "0", color: entityColor, x: pos.x, y: pos.y, z: pos.z, pdMode, halfSize });
        const objects = tmpCollector.flush(colorCtx.materialCache, colorCtx.meshMaterialCache, colorCtx.pointsMaterialCache);
        if (objects.length > 0) {
          const grp = new THREE.Group();
          for (const obj of objects) grp.add(obj);
          return grp;
        }
      }
      break;
    }

    // INSERT is handled by collectInsertEntity (merged geometry path)
    case "INSERT":
      break;

    case "HATCH": {
      if (isHatchEntity(entity) && entity.boundaryPaths.length > 0) {
        const hatchMatrix = buildOcsMatrix(entity.extrusionDirection);
        if (entity.solid) {
          const shapes = buildSolidHatchShapes(entity.boundaryPaths);

          if (shapes.length === 0) break;

          const geometry = new THREE.ShapeGeometry(shapes);
          const meshMat = getMeshMaterial(entityColor, colorCtx.meshMaterialCache);
          const mesh = new THREE.Mesh(geometry, meshMat);
          if (hatchMatrix) mesh.applyMatrix4(hatchMatrix);
          return mesh;
        } else {
          const objects: THREE.Object3D[] = [];

          // Build clipping polygons from all boundary paths
          const polygons: Point2D[][] = entity.boundaryPaths
            .map((bp) => boundaryPathToPoint2DArray(bp))
            .filter((p) => p.length > 2);

          // Embedded pattern lines are pre-scaled by AutoCAD — don't apply patternScale again.
          // Fallback dictionary patterns need patternScale applied.
          const hasEmbedded = entity.patternLines && entity.patternLines.length > 0;
          const patternLines = hasEmbedded
            ? entity.patternLines
            : HATCH_PATTERNS[entity.patternName.toUpperCase()];
          const effectiveScale = hasEmbedded ? 1 : entity.patternScale;
          const effectiveAngle = hasEmbedded ? 0 : entity.patternAngle;

          if (patternLines && polygons.length > 0) {
            const { segmentVertices, dotPositions } = generateHatchPattern(
              patternLines,
              polygons,
              effectiveScale,
              effectiveAngle,
              hasEmbedded,
            );

            // Transform flat segment vertices and build LineSegments
            if (segmentVertices.length >= 6) {
              if (hatchMatrix) {
                const v = new THREE.Vector3();
                for (let i = 0; i < segmentVertices.length; i += 3) {
                  v.set(segmentVertices[i], segmentVertices[i + 1], segmentVertices[i + 2]);
                  v.applyMatrix4(hatchMatrix);
                  segmentVertices[i] = v.x;
                  segmentVertices[i + 1] = v.y;
                  segmentVertices[i + 2] = v.z;
                }
              }
              const geo = new THREE.BufferGeometry();
              geo.setAttribute("position", new THREE.Float32BufferAttribute(segmentVertices, 3));
              objects.push(new THREE.LineSegments(geo, lineMaterial));
            }

            if (dotPositions.length >= 3) {
              if (hatchMatrix) {
                const v = new THREE.Vector3();
                for (let i = 0; i < dotPositions.length; i += 3) {
                  v.set(dotPositions[i], dotPositions[i + 1], dotPositions[i + 2]);
                  v.applyMatrix4(hatchMatrix);
                  dotPositions[i] = v.x;
                  dotPositions[i + 1] = v.y;
                  dotPositions[i + 2] = v.z;
                }
              }
              const dotGeometry = new THREE.BufferGeometry();
              dotGeometry.setAttribute("position", new THREE.Float32BufferAttribute(dotPositions, 3));
              const pointMat = getPointsMaterial(entityColor, colorCtx.pointsMaterialCache);
              objects.push(new THREE.Points(dotGeometry, pointMat));
            }
          } else {
            // No pattern lines — draw boundary outlines only
            for (const bp of entity.boundaryPaths) {
              const pts = boundaryPathToLinePoints(bp);
              if (pts.length > 1) {
                objects.push(createLine(transformOcsPoints(pts, hatchMatrix), lineMaterial, ltInfo?.pattern));
              }
            }
          }

          return objects.length > 0 ? objects : null;
        }
      }
      break;
    }

    // LEADER/MULTILEADER are handled by collectLeaderEntity (merged geometry path)
    case "LEADER":
    case "MULTILEADER":
    case "MLEADER":
      break;

    // Recognized but non-renderable entities — silent skip (not unsupported)
    case "VIEWPORT":
    case "IMAGE":
    case "WIPEOUT":
    case "3DSOLID":
      return new THREE.Group();

    default:
      return null;
  }

  return null;
};

// ─── Main entry point ─────────────────────────────────────────────────

/** Entity types that are collected (merged) rather than processed individually */
const COLLECTABLE_TYPES = new Set([
  "LINE", "CIRCLE", "ARC", "ELLIPSE",
  "LWPOLYLINE", "POLYLINE", "SPLINE",
  "POINT", "SOLID", "3DFACE", "HATCH",
  "MLINE", "XLINE", "RAY",
]);

/** Yield control to the browser so the UI stays responsive */
const yieldToMain = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Time budget per chunk before yielding (ms) */
const CHUNK_TIME_MS = 16;

export interface DisplaySignal {
  cancelled: boolean;
  onProgress?: (progress: number) => void;
}

/** Shared state for cooperative yielding across async processing */
interface YieldState {
  lastYield: number;
  signal?: DisplaySignal;
}

/** Dispose all cached materials (used on cancellation to prevent leaks) */
function disposeMaterialCaches(colorCtx: EntityColorContext): void {
  for (const mat of colorCtx.materialCache.values()) mat.dispose();
  colorCtx.materialCache.clear();
  for (const mat of colorCtx.meshMaterialCache.values()) mat.dispose();
  colorCtx.meshMaterialCache.clear();
  for (const mat of colorCtx.pointsMaterialCache.values()) mat.dispose();
  colorCtx.pointsMaterialCache.clear();
}

export async function createThreeObjectsFromDXF(
  dxf: DxfData,
  signal?: DisplaySignal,
  darkTheme?: boolean,
  font?: import("opentype.js").Font,
): Promise<{
  group: THREE.Group;
  warnings?: string;
  unsupportedEntities?: string[];
}> {
  // Clear caches to prevent unbounded memory growth across reloads
  clearGlyphCache();
  clearMeasureTextCache();

  const tStart = performance.now();
  const group = new THREE.Group();

  if (!dxf.entities || dxf.entities.length === 0) {
    console.warn("DXF does not contain entities!");
    return { group };
  }

  const layers: Record<string, DxfLayer> = {};
  if (dxf.tables?.layer?.layers) {
    Object.assign(layers, dxf.tables.layer.layers);
  }

  const lineTypes = dxf.tables?.lineType?.lineTypes ?? {};
  const headerLtScale = (dxf.header?.["$LTSCALE"] as number) ?? 1;
  const globalLtScale = headerLtScale === 1
    ? computeAutoLtScale(dxf.header, lineTypes)
    : headerLtScale;

  // Point display mode ($PDMODE / $PDSIZE)
  const pdMode = (dxf.header?.["$PDMODE"] as number) ?? 0;
  const pointDisplaySize = pdMode !== 0 ? computePointDisplaySize(dxf.header) : undefined;

  // Dimension variables ($DIMSCALE, $DIMASZ, $DIMTXT, $DIMGAP)
  const dimVars = resolveDimVarsFromHeader(dxf.header);

  // Default text height from $TEXTSIZE header variable
  const headerTextSize = dxf.header?.["$TEXTSIZE"] as number | undefined;
  const defaultTextHeight = (headerTextSize && headerTextSize > 0) ? headerTextSize : TEXT_HEIGHT;

  // $MIRRTEXT: 0 (default) = keep text readable in mirrored blocks, 1 = mirror text with geometry
  const mirrText = (dxf.header?.["$MIRRTEXT"] as number | undefined) === 1;

  // Load serif font if any STYLE entry or MTEXT inline \f references a serif font
  const styles = dxf.tables?.style?.styles;
  let loadedSerifFont: import("opentype.js").Font | undefined;
  if (font) {
    let needsSerif = false;

    // Check STYLE table fontFile entries
    if (styles) {
      needsSerif = Object.values(styles).some(
        (s) => s.fontFile && classifyFont(s.fontFile) === "serif",
      );
    }

    // Check MTEXT inline \f font references in entities and blocks
    if (!needsSerif) {
      const inlineFontRegex = /\\f([^|;]*)/g;
      const checkText = (text: string): boolean => {
        let match;
        while ((match = inlineFontRegex.exec(text)) !== null) {
          if (classifyFont(match[1]) === "serif") return true;
        }
        return false;
      };

      for (const entity of dxf.entities) {
        if (entity.type === "MTEXT" && isTextEntity(entity) && entity.text && checkText(entity.text)) {
          needsSerif = true;
          break;
        }
      }

      if (!needsSerif && dxf.blocks) {
        outer:
        for (const block of Object.values(dxf.blocks)) {
          for (const entity of block.entities ?? []) {
            if (entity.type === "MTEXT" && isTextEntity(entity) && entity.text && checkText(entity.text)) {
              needsSerif = true;
              break outer;
            }
          }
        }
      }
    }

    if (needsSerif) {
      loadedSerifFont = await loadSerifFont();
    }
  }

  // DIMSTYLE table and header $DIMLUNIT for architectural dimension formatting
  const dimStyles = dxf.tables?.dimStyle?.dimStyles;
  const headerDimlunit = dxf.header?.["$DIMLUNIT"] as number | undefined;

  // Build handle → name map from BLOCK_RECORD for DIMBLK resolution
  let blockHandleToName: Map<string, string> | undefined;
  const blockRecords = dxf.tables?.blockRecord?.blockRecords;
  if (blockRecords) {
    blockHandleToName = new Map();
    for (const rec of Object.values(blockRecords)) {
      if (rec.handle) blockHandleToName.set(rec.handle, rec.name);
    }
  }

  const colorCtx: EntityColorContext = {
    layers,
    materialCache: new Map(),
    meshMaterialCache: new Map(),
    pointsMaterialCache: new Map(),
    lineTypes,
    globalLtScale,
    headerLtScale,
    darkTheme,
    font,
    serifFont: loadedSerifFont,
    styles,
    pdMode,
    pointDisplaySize,
    dimVars,
    defaultTextHeight,
    mirrText,
    dimStyles,
    headerDimlunit,
    blockHandleToName,
  };

  // Compute clip size for XLINE/RAY from drawing extents
  const extMin = dxf.header?.["$EXTMIN"] as { x: number; y: number } | undefined;
  const extMax = dxf.header?.["$EXTMAX"] as { x: number; y: number } | undefined;
  if (extMin && extMax && extMax.x > extMin.x && extMax.y > extMin.y) {
    const dx = extMax.x - extMin.x;
    const dy = extMax.y - extMin.y;
    colorCtx.xlineClipSize = Math.sqrt(dx * dx + dy * dy) * 2;
  }

  const collector = new GeometryCollector();
  const errors: string[] = [];
  const unsupportedTypes: string[] = [];

  const yieldState: YieldState = { lastYield: performance.now(), signal };

  // Pre-pass: count INSERT usage and build templates for frequently-used blocks
  let tTemplates = performance.now();
  const blockRefCounts = new Map<string, number>();
  for (const entity of dxf.entities) {
    if (entity.type === "INSERT" && !entity.inPaperSpace && isInsertEntity(entity)) {
      blockRefCounts.set(entity.name, (blockRefCounts.get(entity.name) ?? 0) + 1);
    }
  }

  // Propagate counts through nested blocks: if block A is used N times and
  // contains M INSERT refs to block B, then B is used at least N*M times.
  // Process ALL referenced blocks (not just those ≥ threshold) because a block
  // used once may contain hundreds of INSERTs to sub-blocks that need templates.
  if (dxf.blocks) {
    const visited = new Set<string>();
    const queue = [...blockRefCounts.keys()];
    while (queue.length > 0) {
      const name = queue.shift()!;
      if (visited.has(name)) continue;
      visited.add(name);
      const parentCount = blockRefCounts.get(name) ?? 0;
      if (parentCount === 0) continue;
      const block = dxf.blocks[name];
      if (!block?.entities) continue;
      for (const entity of block.entities) {
        if (entity.type === "INSERT" && isInsertEntity(entity)) {
          blockRefCounts.set(entity.name, (blockRefCounts.get(entity.name) ?? 0) + parentCount);
          if (!visited.has(entity.name)) {
            queue.push(entity.name);
          }
        }
      }
    }
  }

  const blockTemplates = new Map<string, BlockTemplate>();
  if (dxf.blocks) {
    for (const [name, count] of blockRefCounts) {
      if (count >= INSTANCING_THRESHOLD) {
        const block = dxf.blocks[name];
        if (block?.entities?.length) {
          blockTemplates.set(name, buildBlockTemplate(name, block.entities as DxfEntity[], colorCtx, collectEntity));
        }
      }
    }
  }

  // Build shared GPU geometries for all templates — each INSERT becomes
  // a matrix transform instead of copying all vertices
  const sharedBlockGeos = new Map<string, SharedBlockGeo>();
  for (const [name, template] of blockTemplates) {
    sharedBlockGeos.set(name, buildSharedBlockGeo(template));
  }
  console.log(`[DXF]   Templates: ${blockTemplates.size} blocks, ${sharedBlockGeos.size} shared (${Math.round(performance.now() - tTemplates)}ms)`);

  const tEntities = performance.now();
  const typeTimers = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  for (let index = 0; index < dxf.entities.length; index++) {
    if (signal?.cancelled) {
      disposeMaterialCaches(colorCtx);
      return { group };
    }

    const entity = dxf.entities[index];

    // Yield to browser every ~16ms to keep UI responsive
    if (performance.now() - yieldState.lastYield > CHUNK_TIME_MS) {
      signal?.onProgress?.(index / dxf.entities.length);
      await yieldToMain();
      yieldState.lastYield = performance.now();
    }

    const tEntity = performance.now();
    try {
      // Skip paper space entities — they belong to layouts, not model space
      if (entity.inPaperSpace) continue;

      // Skip explicitly invisible entities (DXF code 60 = 1)
      if (entity.visible === false) continue;

      const layer = entity.layer || "0";

      // INSERT blocks: flatten into collector (merged geometry)
      if (entity.type === "INSERT") {
        await collectInsertEntity(entity, dxf, colorCtx, collector, layer, null, group, 0, yieldState, blockTemplates, sharedBlockGeos);
        continue;
      }

      // Try to collect simple entities into merged buffers
      if (COLLECTABLE_TYPES.has(entity.type)) {
        if (collectEntity({ entity, colorCtx, collector, layer })) {
          continue;
        }
      }

      // Vector text: collect TEXT/MTEXT directly into GeometryCollector
      if ((entity.type === "TEXT" || entity.type === "MTEXT") && isTextEntity(entity)) {
        collectTextOrMText(entity, colorCtx, collector, layer);
        continue;
      }

      // Vector text: collect ATTDEF as visible text (tag or default value)
      if (entity.type === "ATTDEF" && isAttdefEntity(entity)) {
        collectAttdefEntity(entity, colorCtx, collector, layer);
        continue;
      }

      // Vector text: collect DIMENSION directly (lines decomposed, text via collector)
      if (entity.type === "DIMENSION" && isDimensionEntity(entity)) {
        collectDimensionEntity(entity, dxf, colorCtx, collector, layer);
        continue;
      }

      // Vector text: collect LEADER/MULTILEADER directly
      if (entity.type === "LEADER" || entity.type === "MULTILEADER" || entity.type === "MLEADER") {
        collectLeaderEntity(entity, dxf, colorCtx, collector, layer);
        continue;
      }

      // Complex entities: create individual Three.js objects
      const obj = processEntity(entity, dxf, colorCtx, 0);
      if (obj) {
        setLayerName(obj, layer);
        if (Array.isArray(obj)) {
          obj.forEach((o) => group.add(o));
        } else {
          group.add(obj);
        }
      } else {
        unsupportedTypes.push(`Entity ${index}: ${entity.type || "unknown type"}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      errors.push(`Entity ${index} (${entity.type || "unknown type"}): ${errorMsg}`);
    } finally {
      const t = entity.type || "UNKNOWN";
      typeTimers.set(t, (typeTimers.get(t) ?? 0) + (performance.now() - tEntity));
      typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    }
  }

  console.log(`[DXF]   Entities: ${Math.round(performance.now() - tEntities)}ms`);
  const sortedTypes = [...typeTimers.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`[DXF]   By type: ${sortedTypes.slice(0, 8).map(([t, ms]) => `${t}: ${Math.round(ms)}ms (${typeCounts.get(t) ?? 0})`).join(", ")}`);
  signal?.onProgress?.(1);

  if (signal?.cancelled) {
    disposeMaterialCaches(colorCtx);
    return { group };
  }

  // Flush merged geometry into Three.js objects
  const tFlush = performance.now();
  const mergedObjects = collector.flush(
    colorCtx.materialCache,
    colorCtx.meshMaterialCache,
    colorCtx.pointsMaterialCache,
  );
  for (const obj of mergedObjects) {
    group.add(obj);
  }
  // Count merged objects by type
  let lineCount = 0, meshCount = 0, ptsCount = 0;
  for (const obj of mergedObjects) {
    if (obj instanceof THREE.LineSegments) lineCount++;
    else if (obj instanceof THREE.Mesh) meshCount++;
    else if (obj instanceof THREE.Points) ptsCount++;
  }
  console.log(`[DXF]   Flush: ${Math.round(performance.now() - tFlush)}ms → ${lineCount} lines, ${meshCount} meshes, ${ptsCount} pts`);
  console.log(`[DXF] Geometry total: ${Math.round(performance.now() - tStart)}ms (${dxf.entities.length} entities)`);

  const totalIssues = errors.length + unsupportedTypes.length;
  if (totalIssues > 0) {
    const warningParts = [];

    if (errors.length > 0) {
      warningParts.push(
        `${errors.length} errors: ${errors.slice(0, 2).join("; ")}${errors.length > 2 ? "..." : ""}`,
      );
    }

    if (unsupportedTypes.length > 0) {
      warningParts.push(
        `${unsupportedTypes.length} unsupported types: ${unsupportedTypes.slice(0, 2).join("; ")}${unsupportedTypes.length > 2 ? "..." : ""}`,
      );
    }

    const errorSummary = `Failed to process ${totalIssues} of ${dxf.entities.length} objects. ${warningParts.join(", ")}`;

    return {
      group,
      warnings: errorSummary,
      unsupportedEntities: unsupportedTypes.length > 0 ? unsupportedTypes : undefined,
    };
  }

  return { group };
}
