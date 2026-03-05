import * as THREE from "three";
import { NURBSCurve } from "three/examples/jsm/curves/NURBSCurve.js";
import type { DxfVertex, DxfEntity, DxfData, DxfLayer, DxfSplineEntity, DxfTextEntity } from "@/types/dxf";
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
} from "@/constants";
import { HATCH_PATTERNS } from "@/constants/hatchPatterns";
import { resolveEntityColor } from "@/utils/colorResolver";
import { resolveEntityLinetype, applyLinetypePattern, computeAutoLtScale } from "@/utils/linetypeResolver";
import { buildOcsMatrix, transformOcsPoints, transformOcsPoint } from "@/utils/ocsTransform";

import {
  type EntityColorContext,
  degreesToRadians,
  getLineMaterial,
  getMeshMaterial,
  getPointsMaterial,
  createBulgeArc,
  createArrow,
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
  mergeEntityDimVars,
} from "./geometry/dimensions";
import {
  replaceSpecialChars,
  parseMTextContent,
} from "./geometry/text";
import {
  boundaryPathToShapePath,
  boundaryPathToLinePoints,
  generateHatchPattern,
  type Point2D,
} from "./geometry/hatch";
import { GeometryCollector } from "./geometry/mergeCollectors";
import {
  addTextToCollector,
  addMTextToCollector,
  addDimensionTextToCollector,
  HAlign,
  VAlign,
} from "./geometry/vectorTextBuilder";
import {
  type BlockTemplate,
  type CollectEntityParams,
  INSTANCING_THRESHOLD,
  buildBlockTemplate,
  instantiateBlockTemplate,
} from "./geometry/blockTemplateCache";
import { resolveEntityFont, classifyFont } from "./geometry/fontClassifier";
import { loadSerifFont } from "./geometry/fontManager";

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Compute polyline points (with bulge arcs) from entity vertices.
 */
const computePolylinePoints = (entity: DxfEntity & { vertices: DxfVertex[]; shape?: boolean }): THREE.Vector3[] => {
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
  if (entity.shape && entity.vertices.length > 2) {
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
        const matrix = buildOcsMatrix(entity.extrusionDirection);
        const majorX = entity.majorAxisEndPoint.x;
        const majorY = entity.majorAxisEndPoint.y;
        const majorLength = Math.sqrt(majorX * majorX + majorY * majorY);
        const minorLength = majorLength * entity.axisRatio;
        const rotation = Math.atan2(majorY, majorX);

        let startAngle = entity.startAngle;
        let endAngle = entity.endAngle;

        const isFullEllipse =
          Math.abs(endAngle - startAngle - 2 * Math.PI) < EPSILON ||
          (Math.abs(startAngle) < EPSILON && Math.abs(endAngle) < EPSILON);

        if (isFullEllipse) {
          startAngle = 0;
          endAngle = 2 * Math.PI;
        }

        const sweepAngle = endAngle - startAngle;
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

        addLineToCollector(collector, layer, entityColor, applyWorld(transformOcsPoints(points, matrix), worldMatrix), pattern);
        return true;
      }
      return false;
    }

    case "LWPOLYLINE":
    case "POLYLINE": {
      if (isPolylineEntity(entity) && entity.vertices.length > 1) {
        const matrix = buildOcsMatrix(entity.extrusionDirection);
        const allPoints = computePolylinePoints(entity);
        addLineToCollector(collector, layer, entityColor, applyWorld(transformOcsPoints(allPoints, matrix), worldMatrix), pattern);
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
        const faceData = computeFaceData(pts);
        if (faceData) {
          collector.addMesh(layer, entityColor, faceData.vertices, faceData.indices);
          return true;
        }
      }
      return false;
    }

    case "HATCH": {
      if (isHatchEntity(entity) && entity.boundaryPaths.length > 0) {
        const hatchMatrix = buildOcsMatrix(entity.extrusionDirection);

        if (entity.solid) {
          const shapes: THREE.Shape[] = [];
          for (let i = 0; i < entity.boundaryPaths.length; i++) {
            const sp = boundaryPathToShapePath(entity.boundaryPaths[i]);
            if (!sp) continue;
            const pathShapes = sp.toShapes(false);
            shapes.push(...pathShapes);
          }
          if (shapes.length === 0) return false;

          // Create temporary ShapeGeometry to extract vertices/indices
          const geometry = new THREE.ShapeGeometry(shapes);
          const posAttr = geometry.getAttribute("position");
          const index = geometry.getIndex();

          if (posAttr && index) {
            const vertices: number[] = [];
            for (let i = 0; i < posAttr.count; i++) {
              const v = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
              if (hatchMatrix) v.applyMatrix4(hatchMatrix);
              if (worldMatrix) v.applyMatrix4(worldMatrix);
              vertices.push(v.x, v.y, v.z);
            }
            const indices: number[] = [];
            for (let i = 0; i < index.count; i++) {
              indices.push(index.getX(i));
            }
            collector.addMesh(layer, entityColor, vertices, indices);
          }

          geometry.dispose();
          return true;
        } else {
          // Pattern hatch
          const polygons: Point2D[][] = entity.boundaryPaths
            .map((bp) => boundaryPathToLinePoints(bp).map((v) => ({ x: v.x, y: v.y })))
            .filter((p) => p.length > 2);

          const hasEmbedded = entity.patternLines && entity.patternLines.length > 0;
          const patternLines = hasEmbedded
            ? entity.patternLines
            : HATCH_PATTERNS[entity.patternName.toUpperCase()];
          const effectiveScale = hasEmbedded ? 1 : entity.patternScale;
          const effectiveAngle = hasEmbedded ? 0 : entity.patternAngle;

          if (patternLines && polygons.length > 0) {
            const { segments, dots } = generateHatchPattern(
              patternLines,
              polygons,
              effectiveScale,
              effectiveAngle,
            );
            for (const seg of segments) {
              const transformed = transformOcsPoints(seg, hatchMatrix);
              collector.addLineFromPoints(layer, entityColor, applyWorld(transformed, worldMatrix));
            }
            if (dots.length > 0) {
              const dotPositions: number[] = [];
              for (let i = 0; i < dots.length; i++) {
                const d = hatchMatrix ? dots[i].clone().applyMatrix4(hatchMatrix) : dots[i];
                if (worldMatrix) d.applyMatrix4(worldMatrix);
                dotPositions.push(d.x, d.y, d.z);
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

    if (worldMatrix) {
      pos.applyMatrix4(worldMatrix);
      if (endX !== undefined && endY !== undefined) {
        const ep = new THREE.Vector3(endX, endY, 0).applyMatrix4(worldMatrix);
        endX = ep.x;
        endY = ep.y;
      }
      // Extract rotation from world matrix
      const m = worldMatrix.elements;
      rotation += Math.atan2(m[1], m[0]);
      // Scale height by Y component of matrix scale
      height *= Math.sqrt(m[4] * m[4] + m[5] * m[5]);
    }

    addTextToCollector({
      collector, layer, color: entityColor, font,
      text: replaceSpecialChars(textContent), height,
      posX: pos.x, posY: pos.y, posZ: pos.z, rotation,
      hAlign: entity.halign ?? HAlign.LEFT,
      vAlign: entity.valign ?? VAlign.BASELINE,
      widthFactor: entity.xScale,
      endPosX: endX, endPosY: endY,
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
      rotation += Math.atan2(m[1], m[0]);
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

  // Resolve dimension variables: header defaults merged with per-entity XDATA overrides
  const baseDv = colorCtx.dimVars ?? resolveDimVarsFromHeader(undefined);
  const dv = mergeEntityDimVars(baseDv, entity);

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
    const dimData = extractDimensionData(entity, dv);
    if (!dimData) return;

    let dimAngle = dimData.angle;
    if (baseDimType === 1 && dimAngle === 0) {
      const dx = dimData.point2.x - dimData.point1.x;
      const dy = dimData.point2.y - dimData.point1.y;
      dimAngle = (Math.atan2(dy, dx) * DEGREES_TO_RADIANS_DIVISOR) / Math.PI;
    }

    const dimGroup = createDimensionGroup({
      point1: dimData.point1, point2: dimData.point2, anchorPoint: dimData.anchorPoint,
      textPos: dimData.textPos, textHeight: dimData.textHeight, isRadial: dimData.isRadial,
      color: entityColor, angle: dimAngle, dv,
    });
    result = [dimGroup];

    if (dimData.textPos) {
      const dimAngleRad = dimAngle !== 0 ? degreesToRadians(dimAngle) : 0;
      addDimensionTextToCollector({
        collector, layer, color: entityColor, font,
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

  if (entity.type === "LEADER" && isLeaderEntity(entity) && entity.vertices.length >= 2) {
    const points = entity.vertices.map(
      (vt) => new THREE.Vector3(vt.x, vt.y, vt.z || 0),
    );
    addLineToCollector(points);

    if (entity.arrowHeadFlag === 1 && points.length >= 2) {
      addArrowToCollector(points[1], points[0], ARROW_SIZE);
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
      insertEntity.xScale || 1,
      insertEntity.yScale || 1,
      insertEntity.zScale || 1,
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
    // Transform cached geometry by worldMatrix
    instantiateBlockTemplate(template, collector, insertLayer, insertColor, worldMatrix);

    // Process fallback entities individually (TEXT, nested INSERT, etc.)
    for (const idx of template.fallbackEntityIndices) {
      const entity = block.entities[idx];
      if (entity.visible === false) continue;
      try {
        const entityLayer = (!entity.layer || entity.layer === "0") ? insertLayer : entity.layer;

        // Nested INSERT: recurse (with blockTemplates for nested fast path)
        if (entity.type === "INSERT" && isInsertEntity(entity)) {
          await collectInsertEntity(entity, dxf, blockColorCtx, collector, entityLayer, worldMatrix, fallbackGroup, depth + 1, yieldState, blockTemplates);
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
        await collectInsertEntity(entity, dxf, blockColorCtx, collector, entityLayer, worldMatrix, fallbackGroup, depth + 1, yieldState, blockTemplates);
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
        const matrix = buildOcsMatrix(entity.extrusionDirection);
        const majorX = entity.majorAxisEndPoint.x;
        const majorY = entity.majorAxisEndPoint.y;
        const majorLength = Math.sqrt(majorX * majorX + majorY * majorY);
        const minorLength = majorLength * entity.axisRatio;
        const rotation = Math.atan2(majorY, majorX);

        let startAngle = entity.startAngle;
        let endAngle = entity.endAngle;

        const isFullEllipse =
          Math.abs(endAngle - startAngle - 2 * Math.PI) < EPSILON ||
          (Math.abs(startAngle) < EPSILON && Math.abs(endAngle) < EPSILON);

        if (isFullEllipse) {
          startAngle = 0;
          endAngle = 2 * Math.PI;
        }

        const sweepAngle = endAngle - startAngle;
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

        return createLine(transformOcsPoints(points, matrix), lineMaterial, ltInfo?.pattern);
      }
      break;
    }

    case "LWPOLYLINE":
    case "POLYLINE": {
      if (isPolylineEntity(entity) && entity.vertices.length > 1) {
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
        const meshMat = getMeshMaterial(entityColor, colorCtx.meshMaterialCache);
        return createFaceMesh(entity.vertices, meshMat);
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
          const shapes: THREE.Shape[] = [];

          for (let i = 0; i < entity.boundaryPaths.length; i++) {
            const sp = boundaryPathToShapePath(entity.boundaryPaths[i]);
            if (!sp) continue;
            const pathShapes = sp.toShapes(false);
            shapes.push(...pathShapes);
          }

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
            .map((bp) => boundaryPathToLinePoints(bp).map((v) => ({ x: v.x, y: v.y })))
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
            const { segments, dots } = generateHatchPattern(
              patternLines,
              polygons,
              effectiveScale,
              effectiveAngle,
            );
            for (const seg of segments) {
              objects.push(createLine(transformOcsPoints(seg, hatchMatrix), lineMaterial));
            }
            if (dots.length > 0) {
              const dotPositions = new Float32Array(dots.length * 3);
              for (let i = 0; i < dots.length; i++) {
                const d = hatchMatrix ? dots[i].clone().applyMatrix4(hatchMatrix) : dots[i];
                dotPositions[i * 3] = d.x;
                dotPositions[i * 3 + 1] = d.y;
                dotPositions[i * 3 + 2] = d.z;
              }
              const dotGeometry = new THREE.BufferGeometry();
              dotGeometry.setAttribute("position", new THREE.BufferAttribute(dotPositions, 3));
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
    case "ATTDEF":
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
    ? computeAutoLtScale(dxf.header)
    : headerLtScale;

  // Point display mode ($PDMODE / $PDSIZE)
  const pdMode = (dxf.header?.["$PDMODE"] as number) ?? 0;
  const pointDisplaySize = pdMode !== 0 ? computePointDisplaySize(dxf.header) : undefined;

  // Dimension variables ($DIMSCALE, $DIMASZ, $DIMTXT, $DIMGAP)
  const dimVars = resolveDimVarsFromHeader(dxf.header);

  // Default text height from $TEXTSIZE header variable
  const headerTextSize = dxf.header?.["$TEXTSIZE"] as number | undefined;
  const defaultTextHeight = (headerTextSize && headerTextSize > 0) ? headerTextSize : TEXT_HEIGHT;

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

  const colorCtx: EntityColorContext = {
    layers,
    materialCache: new Map(),
    meshMaterialCache: new Map(),
    pointsMaterialCache: new Map(),
    lineTypes,
    globalLtScale,
    darkTheme,
    font,
    serifFont: loadedSerifFont,
    styles,
    pdMode,
    pointDisplaySize,
    dimVars,
    defaultTextHeight,
  };

  const collector = new GeometryCollector();
  const errors: string[] = [];
  const unsupportedTypes: string[] = [];

  const yieldState: YieldState = { lastYield: performance.now(), signal };

  // Pre-pass: count INSERT usage and build templates for frequently-used blocks
  const blockRefCounts = new Map<string, number>();
  for (const entity of dxf.entities) {
    if (entity.type === "INSERT" && !entity.inPaperSpace && isInsertEntity(entity)) {
      blockRefCounts.set(entity.name, (blockRefCounts.get(entity.name) ?? 0) + 1);
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
  for (let index = 0; index < dxf.entities.length; index++) {
    if (signal?.cancelled) {
      return { group };
    }

    const entity = dxf.entities[index];

    // Yield to browser every ~16ms to keep UI responsive
    if (performance.now() - yieldState.lastYield > CHUNK_TIME_MS) {
      signal?.onProgress?.(index / dxf.entities.length);
      await yieldToMain();
      yieldState.lastYield = performance.now();
    }

    try {
      // Skip paper space entities — they belong to layouts, not model space
      if (entity.inPaperSpace) continue;

      // Skip explicitly invisible entities (DXF code 60 = 1)
      if (entity.visible === false) continue;

      const layer = entity.layer || "0";

      // INSERT blocks: flatten into collector (merged geometry)
      if (entity.type === "INSERT") {
        await collectInsertEntity(entity, dxf, colorCtx, collector, layer, null, group, 0, yieldState, blockTemplates);
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
    }
  }

  signal?.onProgress?.(1);

  if (signal?.cancelled) {
    return { group };
  }

  // Flush merged geometry into Three.js objects
  const mergedObjects = collector.flush(
    colorCtx.materialCache,
    colorCtx.meshMaterialCache,
    colorCtx.pointsMaterialCache,
  );
  for (const obj of mergedObjects) {
    group.add(obj);
  }

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
