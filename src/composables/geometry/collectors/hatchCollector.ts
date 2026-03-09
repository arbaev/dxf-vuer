import * as THREE from "three";
import { isHatchEntity } from "@/types/dxf";
import type { CollectEntityParams } from "../blockTemplateCache";
import { resolveEntityColor } from "@/utils/colorResolver";
import { resolveEntityLinetype } from "@/utils/linetypeResolver";
import { buildOcsMatrix, transformOcsPoints } from "@/utils/ocsTransform";
import { HATCH_PATTERNS } from "@/constants/hatchPatterns";
import {
  buildSolidHatchShapes,
  boundaryPathToLinePoints,
  boundaryPathToPoint2DArray,
  generateHatchPattern,
  type Point2D,
} from "../hatch";
import { addLineToCollector, applyWorld } from "./helpers";

/**
 * Collect a HATCH entity into the GeometryCollector.
 * Handles both solid fills and pattern hatches.
 * Returns true if collected, false if not handled.
 */
export function collectHatch(p: CollectEntityParams): boolean {
  const { entity, colorCtx, collector, layer, worldMatrix, overrideColor } = p;

  if (!isHatchEntity(entity) || entity.boundaryPaths.length === 0) return false;

  const entityColor = overrideColor ?? resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);
  const ltInfo = resolveEntityLinetype(
    entity, colorCtx.layers, colorCtx.lineTypes,
    colorCtx.globalLtScale, colorCtx.blockLineType, colorCtx.headerLtScale,
  );
  const pattern = ltInfo?.pattern;

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
    // Pattern hatch -- flat arrays, direct collector write
    const polygons: Point2D[][] = entity.boundaryPaths
      .map((bp) => boundaryPathToPoint2DArray(bp))
      .filter((pts) => pts.length > 2);

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
      // No pattern lines -- draw boundary outlines only
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
