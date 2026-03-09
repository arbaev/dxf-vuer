import * as THREE from "three";
import { isPointEntity } from "@/types/dxf";
import type { DxfHeader } from "@/types/header";
import type { CollectEntityParams } from "../blockTemplateCache";
import type { GeometryCollector } from "../mergeCollectors";
import { resolveEntityColor } from "@/utils/colorResolver";
import { buildOcsMatrix, transformOcsPoint } from "@/utils/ocsTransform";
import { POINT_SYMBOL_SEGMENTS, POINT_SYMBOL_DEFAULT_SIZE } from "@/constants";

// ---- PDMODE point symbol rendering ----

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
  header: DxfHeader | undefined,
): number => {
  if (!header) return POINT_SYMBOL_DEFAULT_SIZE;

  const pdSizeRaw = header.$PDSIZE ?? 0;

  if (pdSizeRaw > 0) return pdSizeRaw;

  if (pdSizeRaw < 0) return Math.abs(pdSizeRaw);

  // pdSizeRaw === 0: 5% of drawing area height
  const extMin = header.$EXTMIN;
  const extMax = header.$EXTMAX;
  if (extMin && extMax && extMax.x > extMin.x && extMax.y > extMin.y) {
    return (extMax.y - extMin.y) * 0.05;
  }

  return POINT_SYMBOL_DEFAULT_SIZE;
};

/**
 * Collect a POINT entity into the GeometryCollector.
 * Returns true if collected, false if not handled.
 */
export function collectPoint(p: CollectEntityParams): boolean {
  const { entity, colorCtx, collector, layer, worldMatrix, overrideColor } = p;

  if (!isPointEntity(entity)) return false;

  const entityColor = overrideColor ?? resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);

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
