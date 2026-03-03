import * as THREE from "three";
import { NURBSCurve } from "three/examples/jsm/curves/NURBSCurve.js";
import type { DxfVertex, DxfEntity, DxfData, DxfLayer, DxfSplineEntity } from "@/types/dxf";
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
  createDimensionTextMesh,
  createOrdinateDimension,
  createRadialDimension,
  createDiametricDimension,
  createAngularDimension,
} from "./geometry/dimensions";
import {
  replaceSpecialChars,
  parseMTextContent,
  getMTextHAlign,
  getTextHAlign,
  getMTextVAlign,
  getTextVAlign,
  createStackedTextMesh,
  createTextMesh,
} from "./geometry/text";
import {
  boundaryPathToShapePath,
  boundaryPathToLinePoints,
  generateHatchPattern,
  type Point2D,
} from "./geometry/hatch";
import { GeometryCollector } from "./geometry/mergeCollectors";
import {
  type BlockTemplate,
  INSTANCING_THRESHOLD,
  buildBlockTemplate,
  instantiateBlockTemplate,
} from "./geometry/blockTemplateCache";

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
      return curve.getPoints(segments) as THREE.Vector3[];
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
    const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
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
const collectEntity = (
  entity: DxfEntity,
  colorCtx: EntityColorContext,
  collector: GeometryCollector,
  layer: string,
  worldMatrix?: THREE.Matrix4,
  overrideColor?: string,
): boolean => {
  const entityColor = overrideColor ?? resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor);
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
        collector.addPoint(layer, entityColor, pos.x, pos.y, pos.z);
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

  // Compute INSERT transform matrix: position + rotation + scale
  const pos = insertEntity.position;
  const insertMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(pos.x, pos.y, pos.z || 0),
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

  // Block color context for ByBlock inheritance
  const insertColor = resolveEntityColor(insertEntity, colorCtx.layers, colorCtx.blockColor);
  const blockColorCtx: EntityColorContext = {
    ...colorCtx,
    blockColor: insertColor,
    blockLineType: insertEntity.lineType || colorCtx.blockLineType,
  };

  // Fast path: use cached template if available
  const template = blockTemplates?.get(insertEntity.name);
  if (template) {
    // Transform cached geometry by worldMatrix
    instantiateBlockTemplate(template, collector, insertLayer, insertColor, worldMatrix);

    // Process fallback entities individually (TEXT, nested INSERT, etc.)
    for (const idx of template.fallbackEntityIndices) {
      const entity = block.entities[idx];
      try {
        const entityLayer = (!entity.layer || entity.layer === "0") ? insertLayer : entity.layer;

        // Nested INSERT: recurse (with blockTemplates for nested fast path)
        if (entity.type === "INSERT" && isInsertEntity(entity)) {
          await collectInsertEntity(entity, dxf, blockColorCtx, collector, entityLayer, worldMatrix, fallbackGroup, depth + 1, yieldState, blockTemplates);
          continue;
        }

        // Try simple collection
        if (COLLECTABLE_TYPES.has(entity.type)) {
          if (collectEntity(entity, blockColorCtx, collector, entityLayer, worldMatrix)) {
            continue;
          }
        }

        // Complex entities (DIMENSION, LEADER, TEXT, etc.)
        const decomposable = entity.type === "DIMENSION" || entity.type === "LEADER"
          || entity.type === "MULTILEADER" || entity.type === "MLEADER";

        const obj = processEntity(entity, dxf, blockColorCtx, depth + 1);
        if (obj) {
          const key = entity.type || "unknown";
          fallbackGroup.userData._debugFallback ??= {};

          if (decomposable) {
            const beforeCount = fallbackGroup.children.length;
            decomposeToCollector(obj, collector, entityLayer, worldMatrix, fallbackGroup);
            const textCount = fallbackGroup.children.length - beforeCount;
            fallbackGroup.userData._debugFallback[key + "(text)"] =
              (fallbackGroup.userData._debugFallback[key + "(text)"] || 0) + textCount;
          } else {
            const count = Array.isArray(obj) ? obj.length : 1;
            fallbackGroup.userData._debugFallback[key] =
              (fallbackGroup.userData._debugFallback[key] || 0) + count;
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
        }
      } catch (error) {
        console.warn(`Error processing fallback entity in block "${insertEntity.name}":`, error);
      }
    }

    // Handle ATTRIBs for template path (same as slow path below)
    if (insertEntity.attribs && insertEntity.attribs.length > 0) {
      for (const attrib of insertEntity.attribs) {
        if (attrib.invisible) continue;
        const text = attrib.text;
        if (!text) continue;

        const attribColor = resolveEntityColor(attrib, colorCtx.layers, colorCtx.blockColor);
        const textHeight = attrib.textHeight || TEXT_HEIGHT;
        const hAlign = getTextHAlign(attrib.horizontalJustification);
        const vAlign = getTextVAlign(attrib.verticalJustification);

        const hasJustification =
          (attrib.horizontalJustification && attrib.horizontalJustification > 0) ||
          (attrib.verticalJustification && attrib.verticalJustification > 0);
        const posCoord = hasJustification && attrib.endPoint
          ? attrib.endPoint
          : attrib.startPoint;
        if (!posCoord) continue;

        const attribMatrix = buildOcsMatrix(attrib.extrusionDirection);
        const textMesh = createTextMesh(
          replaceSpecialChars(text),
          textHeight,
          attribColor,
          false,
          false,
          hAlign,
          "Arial",
          vAlign,
        );
        const attribPos = transformOcsPoint(
          new THREE.Vector3(posCoord.x, posCoord.y, 0),
          attribMatrix,
        );
        textMesh.position.set(attribPos.x, attribPos.y, attribPos.z);

        if (attrib.rotation) {
          textMesh.rotation.z = degreesToRadians(attrib.rotation);
        }

        textMesh.userData.layerName = insertLayer;
        fallbackGroup.add(textMesh);
        fallbackGroup.userData._debugFallback ??= {};
        fallbackGroup.userData._debugFallback["ATTRIB"] = (fallbackGroup.userData._debugFallback["ATTRIB"] || 0) + 1;
      }
    }

    return;
  }

  // Slow path: process every entity individually
  for (const entity of block.entities) {
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
        if (collectEntity(entity, blockColorCtx, collector, entityLayer, worldMatrix)) {
          continue;
        }
      }

      // DIMENSION/LEADER/MLEADER: decompose geometry into collector, keep only text
      const decomposable = entity.type === "DIMENSION" || entity.type === "LEADER"
        || entity.type === "MULTILEADER" || entity.type === "MLEADER";

      const obj = processEntity(entity, dxf, blockColorCtx, depth + 1);
      if (obj) {
        const key = entity.type || "unknown";
        fallbackGroup.userData._debugFallback ??= {};

        if (decomposable) {
          const beforeCount = fallbackGroup.children.length;
          decomposeToCollector(obj, collector, entityLayer, worldMatrix, fallbackGroup);
          const textCount = fallbackGroup.children.length - beforeCount;
          fallbackGroup.userData._debugFallback[key + "(text)"] =
            (fallbackGroup.userData._debugFallback[key + "(text)"] || 0) + textCount;
        } else {
          const count = Array.isArray(obj) ? obj.length : 1;
          fallbackGroup.userData._debugFallback[key] =
            (fallbackGroup.userData._debugFallback[key] || 0) + count;
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

  // Handle ATTRIB entities (text attached to INSERT, in world coordinates)
  if (insertEntity.attribs && insertEntity.attribs.length > 0) {
    for (const attrib of insertEntity.attribs) {
      if (attrib.invisible) continue;
      const text = attrib.text;
      if (!text) continue;

      const attribColor = resolveEntityColor(attrib, colorCtx.layers, colorCtx.blockColor);
      const textHeight = attrib.textHeight || TEXT_HEIGHT;
      const hAlign = getTextHAlign(attrib.horizontalJustification);
      const vAlign = getTextVAlign(attrib.verticalJustification);

      const hasJustification =
        (attrib.horizontalJustification && attrib.horizontalJustification > 0) ||
        (attrib.verticalJustification && attrib.verticalJustification > 0);
      const posCoord = hasJustification && attrib.endPoint
        ? attrib.endPoint
        : attrib.startPoint;
      if (!posCoord) continue;

      const attribMatrix = buildOcsMatrix(attrib.extrusionDirection);
      const textMesh = createTextMesh(
        replaceSpecialChars(text),
        textHeight,
        attribColor,
        false,
        false,
        hAlign,
        "Arial",
        vAlign,
      );
      const attribPos = transformOcsPoint(
        new THREE.Vector3(posCoord.x, posCoord.y, 0),
        attribMatrix,
      );
      textMesh.position.set(attribPos.x, attribPos.y, attribPos.z);

      if (attrib.rotation) {
        textMesh.rotation.z = degreesToRadians(attrib.rotation);
      }

      textMesh.userData.layerName = insertLayer;
      fallbackGroup.add(textMesh);
      fallbackGroup.userData._debugFallback ??= {};
      fallbackGroup.userData._debugFallback["ATTRIB"] = (fallbackGroup.userData._debugFallback["ATTRIB"] || 0) + 1;
    }
  }
};

/**
 * Decompose pre-built Three.js objects into the GeometryCollector.
 * Lines, LineSegments, Points, and Meshes (without textures) are extracted
 * and merged. Text meshes (with CanvasTexture) are kept as individual objects.
 */
const decomposeToCollector = (
  obj: THREE.Object3D | THREE.Object3D[],
  collector: GeometryCollector,
  layer: string,
  worldMatrix: THREE.Matrix4,
  fallbackGroup: THREE.Group,
): void => {
  // Wrap in a temporary root with the world transform
  const root = new THREE.Group();
  root.matrixAutoUpdate = false;
  root.matrix.copy(worldMatrix);

  if (Array.isArray(obj)) {
    for (const o of obj) root.add(o);
  } else {
    root.add(obj);
  }
  root.updateMatrixWorld(true);

  // Collect leaf nodes (skip Groups)
  const leaves: THREE.Object3D[] = [];
  root.traverse((child) => {
    if (child === root || child instanceof THREE.Group) return;
    leaves.push(child);
  });

  const v = new THREE.Vector3();

  for (const child of leaves) {
    const geo = (child as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (!geo) continue;
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!posAttr) continue;

    const mat = (child as THREE.Mesh).material as THREE.Material & { map?: THREE.Texture; color?: THREE.Color };
    const hasTexture = mat && mat.map;

    if (hasTexture) {
      // Text mesh with canvas texture — keep as individual
      child.removeFromParent();
      child.matrixAutoUpdate = false;
      child.matrix.copy(child.matrixWorld);
      child.userData.layerName = layer;
      fallbackGroup.add(child);
      continue;
    }

    const objColor = mat?.color ? "#" + mat.color.getHexString() : "#000000";

    if (child instanceof THREE.LineSegments) {
      const data: number[] = [];
      for (let i = 0; i < posAttr.count; i++) {
        v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
        v.applyMatrix4(child.matrixWorld);
        data.push(v.x, v.y, v.z);
      }
      collector.addLineSegments(layer, objColor, data);
    } else if (child instanceof THREE.Line) {
      const points: THREE.Vector3[] = [];
      for (let i = 0; i < posAttr.count; i++) {
        points.push(
          new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i))
            .applyMatrix4(child.matrixWorld),
        );
      }
      collector.addLineFromPoints(layer, objColor, points);
    } else if (child instanceof THREE.Mesh) {
      const vertices: number[] = [];
      for (let i = 0; i < posAttr.count; i++) {
        v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
        v.applyMatrix4(child.matrixWorld);
        vertices.push(v.x, v.y, v.z);
      }
      const index = geo.getIndex();
      if (index) {
        const indices: number[] = [];
        for (let i = 0; i < index.count; i++) {
          indices.push(index.getX(i));
        }
        collector.addMesh(layer, objColor, vertices, indices);
      }
    } else if (child instanceof THREE.Points) {
      const data: number[] = [];
      for (let i = 0; i < posAttr.count; i++) {
        v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
        v.applyMatrix4(child.matrixWorld);
        data.push(v.x, v.y, v.z);
      }
      collector.addPoints(layer, objColor, data);
    }

    // Dispose extracted geometry (materials are shared from cache — don't dispose)
    geo.dispose();
  }
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

const createBlockGroup = (
  insertEntity: DxfEntity,
  dxf: DxfData,
  colorCtx: EntityColorContext,
  depth = 0,
): THREE.Group | null => {
  if (depth > MAX_RECURSION_DEPTH) {
    console.warn(`Maximum recursion depth reached while processing INSERT: ${depth}`);
    return null;
  }

  if (!isInsertEntity(insertEntity)) {
    return null;
  }

  if (!dxf.blocks || typeof dxf.blocks !== "object") {
    console.warn("DXF does not contain blocks!");
    return null;
  }

  const blockName = insertEntity.name;
  const block = dxf.blocks[blockName];

  if (!block) {
    return null;
  }

  if (!block.entities || block.entities.length === 0) {
    const emptyGroup = new THREE.Group();
    const position = insertEntity.position;
    emptyGroup.position.set(position.x, position.y, position.z || 0);
    return emptyGroup;
  }

  // Compute INSERT entity color for ByBlock inheritance
  const insertColor = resolveEntityColor(insertEntity, colorCtx.layers, colorCtx.blockColor);
  const blockColorCtx: EntityColorContext = {
    layers: colorCtx.layers,
    blockColor: insertColor,
    materialCache: colorCtx.materialCache,
    meshMaterialCache: colorCtx.meshMaterialCache,
    pointsMaterialCache: colorCtx.pointsMaterialCache,
    lineTypes: colorCtx.lineTypes,
    globalLtScale: colorCtx.globalLtScale,
    blockLineType: insertEntity.lineType || colorCtx.blockLineType,
  };

  const blockGroup = new THREE.Group();

  block.entities.forEach((entity: DxfEntity) => {
    try {
      const obj = processEntity(entity, dxf, blockColorCtx, depth + 1);
      if (obj) {
        if (Array.isArray(obj)) {
          obj.forEach((o) => blockGroup.add(o));
        } else {
          blockGroup.add(obj);
        }
      }
    } catch (error) {
      console.warn(`Error processing entity in block "${blockName}":`, error);
    }
  });

  const position = insertEntity.position;
  blockGroup.position.set(position.x, position.y, position.z || 0);

  const xScale = insertEntity.xScale || 1;
  const yScale = insertEntity.yScale || 1;
  const zScale = insertEntity.zScale || 1;
  blockGroup.scale.set(xScale, yScale, zScale);

  if (insertEntity.rotation) {
    blockGroup.rotation.z = degreesToRadians(insertEntity.rotation);
  }

  return blockGroup;
};

/**
 * Process entity into Three.js objects. Used inside blocks (INSERT)
 * where entities cannot be merged due to group transforms.
 */
const processEntity = (
  entity: DxfEntity,
  dxf: DxfData,
  colorCtx: EntityColorContext,
  depth = 0,
): THREE.Object3D | THREE.Object3D[] | null => {
  const entityColor = resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor);
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

    case "TEXT": {
      if (isTextEntity(entity)) {
        const matrix = buildOcsMatrix(entity.extrusionDirection);
        const textPosition = entity.position || entity.startPoint;
        const textContent = entity.text;
        if (!textContent) return new THREE.Group();
        const textHeight = entity.height || entity.textHeight || TEXT_HEIGHT;
        const hAlign = getTextHAlign(entity.halign);
        const vAlign = getTextVAlign(entity.valign);

        if (textPosition) {
          const textMesh = createTextMesh(
            replaceSpecialChars(textContent),
            textHeight,
            entityColor,
            false,
            false,
            hAlign,
            "Arial",
            vAlign,
          );
          const pos = transformOcsPoint(
            new THREE.Vector3(textPosition.x, textPosition.y, 0),
            matrix,
          );
          textMesh.position.set(pos.x, pos.y, pos.z);

          if (entity.rotation) {
            textMesh.rotation.z = degreesToRadians(entity.rotation);
          }

          return textMesh;
        }
      }
      break;
    }

    case "MTEXT": {
      if (isTextEntity(entity)) {
        const matrix = buildOcsMatrix(entity.extrusionDirection);
        const textPosition = entity.position || entity.startPoint;
        const textContent = entity.text;
        if (!textContent) return new THREE.Group();
        const defaultHeight = entity.height || entity.textHeight || TEXT_HEIGHT;
        const hAlign = getMTextHAlign(entity.attachmentPoint);
        const vAlign = getMTextVAlign(entity.attachmentPoint);

        if (textPosition) {
          const lines = parseMTextContent(textContent);

          if (lines.length === 1) {
            const line = lines[0];
            const h = line.height || defaultHeight;
            const c = line.color || entityColor;
            const textMesh = (line.stackedTop || line.stackedBottom)
              ? createStackedTextMesh(
                  line.text,
                  line.stackedTop || "",
                  line.stackedBottom || "",
                  h,
                  c,
                  line.bold,
                  line.italic,
                  hAlign,
                  line.fontFamily,
                  vAlign,
                )
              : createTextMesh(
                  line.text,
                  h,
                  c,
                  line.bold,
                  line.italic,
                  hAlign,
                  line.fontFamily,
                  vAlign,
                );
            const pos = transformOcsPoint(
              new THREE.Vector3(textPosition.x, textPosition.y, 0),
              matrix,
            );
            textMesh.position.set(pos.x, pos.y, pos.z);

            if (entity.rotation) {
              textMesh.rotation.z = degreesToRadians(entity.rotation);
            } else if (entity.directionVector) {
              textMesh.rotation.z = Math.atan2(entity.directionVector.y, entity.directionVector.x);
            }

            return textMesh;
          }

          // Multiline: each line uses vAlign="top" so lines stack downward
          const textGroup = new THREE.Group();
          const LINE_SPACING = 1.4;
          let yOffset = 0;
          let totalHeight = 0;

          for (const line of lines) {
            const h = line.height || defaultHeight;
            const c = line.color || entityColor;
            const mesh = (line.stackedTop || line.stackedBottom)
              ? createStackedTextMesh(
                  line.text,
                  line.stackedTop || "",
                  line.stackedBottom || "",
                  h,
                  c,
                  line.bold,
                  line.italic,
                  hAlign,
                  line.fontFamily,
                  "top",
                )
              : createTextMesh(
                  line.text,
                  h,
                  c,
                  line.bold,
                  line.italic,
                  hAlign,
                  line.fontFamily,
                  "top",
                );
            mesh.position.set(0, yOffset, 0);
            textGroup.add(mesh);
            yOffset -= h * LINE_SPACING;
            totalHeight += h * LINE_SPACING;
          }
          // Adjust totalHeight: last line without trailing spacing
          const lastLineHeight = lines[lines.length - 1].height || defaultHeight;
          totalHeight = totalHeight - lastLineHeight * LINE_SPACING + lastLineHeight;

          // Vertical offset of the group depending on vAlign
          let groupYOffset = 0;
          if (vAlign === "middle") {
            groupYOffset = totalHeight / 2;
          } else if (vAlign === "bottom") {
            groupYOffset = totalHeight;
          }

          const groupPos = transformOcsPoint(
            new THREE.Vector3(textPosition.x, textPosition.y + groupYOffset, 0),
            matrix,
          );
          textGroup.position.set(groupPos.x, groupPos.y, groupPos.z);

          if (entity.rotation) {
            textGroup.rotation.z = degreesToRadians(entity.rotation);
          } else if (entity.directionVector) {
            textGroup.rotation.z = Math.atan2(entity.directionVector.y, entity.directionVector.x);
          }

          return textGroup;
        }
      }
      break;
    }

    case "DIMENSION": {
      if (isDimensionEntity(entity)) {
        const baseDimType = (entity.dimensionType ?? 0) & 0x0f;

        // Ordinate dimension (type 6 = Y-ordinate, type 7 = X-ordinate)
        if ((baseDimType & 0x0e) === 6) {
          return createOrdinateDimension(entity, entityColor);
        }

        // Angular dimension (type 2)
        if (baseDimType === 2) {
          return createAngularDimension(entity, entityColor, colorCtx.globalLtScale);
        }

        // Diametric dimension (type 3)
        if (baseDimType === 3) {
          return createDiametricDimension(entity, entityColor);
        }

        // Radial dimension (type 4)
        if (baseDimType === 4) {
          return createRadialDimension(entity, entityColor);
        }

        const dimData = extractDimensionData(entity);
        if (!dimData) {
          break;
        }

        // Aligned dimension (type 1): compute angle from point coordinates
        let dimAngle = dimData.angle;
        if (baseDimType === 1 && dimAngle === 0) {
          const dx = dimData.point2.x - dimData.point1.x;
          const dy = dimData.point2.y - dimData.point1.y;
          dimAngle = (Math.atan2(dy, dx) * DEGREES_TO_RADIANS_DIVISOR) / Math.PI;
        }

        const dimGroup = createDimensionGroup(
          dimData.point1,
          dimData.point2,
          dimData.anchorPoint,
          dimData.textPos,
          dimData.textHeight,
          dimData.isRadial,
          entityColor,
          dimAngle,
          colorCtx.globalLtScale,
        );

        const objects: THREE.Object3D[] = [dimGroup];

        if (dimData.textPos) {
          const textMesh = createDimensionTextMesh(
            dimData.dimensionText,
            dimData.textHeight,
            entityColor,
          );
          textMesh.position.set(dimData.textPos.x, dimData.textPos.y, 0.2);

          if (dimAngle !== 0) {
            textMesh.rotation.z = degreesToRadians(dimAngle);
          }

          objects.push(textMesh);
        }

        return objects;
      }
      break;
    }

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

        const geometry = new THREE.BufferGeometry().setFromPoints([pos]);
        const pointMat = getPointsMaterial(entityColor, colorCtx.pointsMaterialCache);
        return new THREE.Points(geometry, pointMat);
      }
      break;
    }

    case "INSERT": {
      if (isInsertEntity(entity)) {
        const insertMatrix = buildOcsMatrix(entity.extrusionDirection);
        const blockGroup = createBlockGroup(entity, dxf, colorCtx, depth);
        if (insertMatrix && blockGroup) {
          blockGroup.applyMatrix4(insertMatrix);
        }
        // Render ATTRIB entities outside block transform (world coordinates)
        if (entity.attribs && entity.attribs.length > 0) {
          const objects: THREE.Object3D[] = [];
          if (blockGroup) objects.push(blockGroup);

          for (const attrib of entity.attribs) {
            if (attrib.invisible) continue;
            const text = attrib.text;
            if (!text) continue;

            const attribColor = resolveEntityColor(attrib, colorCtx.layers, colorCtx.blockColor);
            const textHeight = attrib.textHeight || TEXT_HEIGHT;
            const hAlign = getTextHAlign(attrib.horizontalJustification);
            const vAlign = getTextVAlign(attrib.verticalJustification);

            // Use endPoint for justified text, startPoint otherwise
            const hasJustification =
              (attrib.horizontalJustification && attrib.horizontalJustification > 0) ||
              (attrib.verticalJustification && attrib.verticalJustification > 0);
            const posCoord = hasJustification && attrib.endPoint
              ? attrib.endPoint
              : attrib.startPoint;
            if (!posCoord) continue;

            const attribMatrix = buildOcsMatrix(attrib.extrusionDirection);
            const textMesh = createTextMesh(
              replaceSpecialChars(text),
              textHeight,
              attribColor,
              false,
              false,
              hAlign,
              "Arial",
              vAlign,
            );
            const pos = transformOcsPoint(
              new THREE.Vector3(posCoord.x, posCoord.y, 0),
              attribMatrix,
            );
            textMesh.position.set(pos.x, pos.y, pos.z);

            if (attrib.rotation) {
              textMesh.rotation.z = degreesToRadians(attrib.rotation);
            }

            objects.push(textMesh);
          }

          return objects.length > 0 ? objects : null;
        }
        return blockGroup;
      }
      break;
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

    case "LEADER": {
      if (isLeaderEntity(entity) && entity.vertices.length >= 2) {
        const points = entity.vertices.map(
          (v) => new THREE.Vector3(v.x, v.y, v.z || 0),
        );
        const leaderLine = createLine(points, lineMaterial, ltInfo?.pattern);

        if (entity.arrowHeadFlag === 1 && points.length >= 2) {
          const group = new THREE.Group();
          group.add(leaderLine);
          const arrowMat = getMeshMaterial(entityColor, colorCtx.meshMaterialCache);
          const arrow = createArrow(points[1], points[0], ARROW_SIZE, arrowMat);
          group.add(arrow);
          return group;
        }
        return leaderLine;
      }
      break;
    }

    case "MULTILEADER":
    case "MLEADER": {
      if (isMLeaderEntity(entity) && entity.leaders.length > 0) {
        const group = new THREE.Group();
        const arrowSize = entity.arrowSize || ARROW_SIZE;
        const arrowMat = getMeshMaterial(entityColor, colorCtx.meshMaterialCache);

        for (const leader of entity.leaders) {
          for (const line of leader.lines) {
            if (line.vertices.length < 2) continue;
            const points = line.vertices.map(
              (v) => new THREE.Vector3(v.x, v.y, v.z || 0),
            );

            // Add lastLeaderPoint as final point (landing/shelf)
            if (leader.lastLeaderPoint) {
              points.push(new THREE.Vector3(
                leader.lastLeaderPoint.x,
                leader.lastLeaderPoint.y,
                leader.lastLeaderPoint.z || 0,
              ));
            }

            group.add(createLine(points, lineMaterial, ltInfo?.pattern));

            if (entity.hasArrowHead !== false && points.length >= 2) {
              const arrow = createArrow(points[1], points[0], arrowSize, arrowMat);
              group.add(arrow);
            }
          }
        }

        if (entity.text && entity.textPosition) {
          const textHeight = entity.textHeight || TEXT_HEIGHT;
          const textContent = replaceSpecialChars(entity.text);
          if (textContent) {
            const textMesh = createTextMesh(
              textContent,
              textHeight,
              entityColor,
              false,
              false,
              "left",
              "Arial",
              "middle",
            );
            textMesh.position.set(
              entity.textPosition.x,
              entity.textPosition.y,
              0,
            );
            group.add(textMesh);
          }
        }

        return group.children.length > 0 ? group : null;
      }
      break;
    }

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
}

/** Shared state for cooperative yielding across async processing */
interface YieldState {
  lastYield: number;
  signal?: DisplaySignal;
}

export async function createThreeObjectsFromDXF(
  dxf: DxfData,
  signal?: DisplaySignal,
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

  const colorCtx: EntityColorContext = {
    layers,
    materialCache: new Map(),
    meshMaterialCache: new Map(),
    pointsMaterialCache: new Map(),
    lineTypes,
    globalLtScale,
  };

  const collector = new GeometryCollector();
  const errors: string[] = [];
  const unsupportedTypes: string[] = [];
  const _debugFallback: Record<string, number> = {};

  const yieldState: YieldState = { lastYield: performance.now(), signal };

  // Debug timing
  let _tInsert = 0, _tText = 0, _tGeom = 0, _tDecompose = 0;

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
  if (blockTemplates.size > 0) {
    console.log(`[dxf-vuer] Block template cache: ${blockTemplates.size} templates built for ${[...blockRefCounts.entries()].filter(([, c]) => c >= INSTANCING_THRESHOLD).reduce((s, [, c]) => s + c, 0)} INSERTs`);
  }

  for (let index = 0; index < dxf.entities.length; index++) {
    if (signal?.cancelled) {
      return { group };
    }

    const entity = dxf.entities[index];

    try {
      // Skip paper space entities — they belong to layouts, not model space
      if (entity.inPaperSpace) continue;

      const layer = entity.layer || "0";

      // INSERT blocks: flatten into collector (merged geometry)
      if (entity.type === "INSERT") {
        const _t0 = performance.now();
        await collectInsertEntity(entity, dxf, colorCtx, collector, layer, null, group, 0, yieldState, blockTemplates);
        _tInsert += performance.now() - _t0;
        continue;
      }

      // Try to collect simple entities into merged buffers
      if (COLLECTABLE_TYPES.has(entity.type)) {
        const _t0 = performance.now();
        if (collectEntity(entity, colorCtx, collector, layer)) {
          _tGeom += performance.now() - _t0;
          continue;
        }
        _tGeom += performance.now() - _t0;
      }

      // Complex entities: create individual Three.js objects
      const _t0e = performance.now();
      const obj = processEntity(entity, dxf, colorCtx, 0);
      if (entity.type === "TEXT" || entity.type === "MTEXT") {
        _tText += performance.now() - _t0e;
      }
      if (obj) {
        // DIMENSION/LEADER/MLEADER: decompose lines+arrows into collector, keep only text
        const topDecomposable = entity.type === "DIMENSION" || entity.type === "LEADER"
          || entity.type === "MULTILEADER" || entity.type === "MLEADER";

        if (topDecomposable) {
          const _t0d = performance.now();
          const identity = new THREE.Matrix4();
          const beforeCount = group.children.length;
          decomposeToCollector(obj, collector, layer, identity, group);
          _tDecompose += performance.now() - _t0d;
          const textCount = group.children.length - beforeCount;
          _debugFallback[entity.type + "(text)"] = (_debugFallback[entity.type + "(text)"] || 0) + textCount;
        } else {
          setLayerName(obj, layer);
          const count = Array.isArray(obj) ? obj.length : 1;
          _debugFallback[entity.type] = (_debugFallback[entity.type] || 0) + count;

          if (Array.isArray(obj)) {
            obj.forEach((o) => group.add(o));
          } else {
            group.add(obj);
          }
        }
      } else {
        unsupportedTypes.push(`Entity ${index}: ${entity.type || "unknown type"}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      errors.push(`Entity ${index} (${entity.type || "unknown type"}): ${errorMsg}`);
    }

    // Yield to browser every ~16ms to keep UI responsive
    if (performance.now() - yieldState.lastYield > CHUNK_TIME_MS) {
      await yieldToMain();
      yieldState.lastYield = performance.now();
    }
  }

  if (signal?.cancelled) {
    return { group };
  }

  // Debug: timing breakdown
  console.log(`[dxf-vuer] Time breakdown — INSERT: ${_tInsert.toFixed(0)}ms | Text: ${_tText.toFixed(0)}ms | Geom: ${_tGeom.toFixed(0)}ms | Decompose: ${_tDecompose.toFixed(0)}ms`);

  // Debug: log fallback entity counts
  const blockFallback = group.userData._debugFallback || {};
  delete group.userData._debugFallback;
  // Merge top-level and block fallbacks
  for (const [k, v] of Object.entries(_debugFallback)) {
    blockFallback[k] = (blockFallback[k] || 0) + (v as number);
  }
  if (Object.keys(blockFallback).length > 0) {
    console.log("[dxf-vuer] Non-merged objects by type:", blockFallback);
  }

  // Flush merged geometry into Three.js objects
  console.log("[dxf-vuer] Collector buckets — lines:", collector.lineSegments.size,
    "| points:", collector.points.size, "| dots:", collector.linetypeDots.size,
    "| meshes:", collector.meshVertices.size);
  const mergedObjects = collector.flush(
    colorCtx.materialCache,
    colorCtx.meshMaterialCache,
    colorCtx.pointsMaterialCache,
  );
  console.log("[dxf-vuer] Merged objects:", mergedObjects.length, "| Direct children:", group.children.length);
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
