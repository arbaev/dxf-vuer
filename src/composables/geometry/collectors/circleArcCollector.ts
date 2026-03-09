import { isCircleEntity, isArcEntity } from "@/types/dxf";
import type { CollectEntityParams } from "../blockTemplateCache";
import { resolveEntityColor } from "@/utils/colorResolver";
import { resolveEntityLinetype } from "@/utils/linetypeResolver";
import { buildOcsMatrix, transformOcsPoints } from "@/utils/ocsTransform";
import { generateCirclePoints, generateArcPoints } from "../curvePoints";
import { addLineToCollector, applyWorld } from "./helpers";

/**
 * Collect a CIRCLE entity into the GeometryCollector.
 * Returns true if collected, false if not handled.
 */
export function collectCircle(p: CollectEntityParams): boolean {
  const { entity, colorCtx, collector, layer, worldMatrix, overrideColor } = p;

  if (!isCircleEntity(entity)) return false;

  const entityColor = overrideColor ?? resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);
  const ltInfo = resolveEntityLinetype(
    entity, colorCtx.layers, colorCtx.lineTypes,
    colorCtx.globalLtScale, colorCtx.blockLineType, colorCtx.headerLtScale,
  );
  const pattern = ltInfo?.pattern;

  const matrix = buildOcsMatrix(entity.extrusionDirection);
  const points = generateCirclePoints(
    entity.center.x,
    entity.center.y,
    entity.center.z || 0,
    entity.radius,
  );
  addLineToCollector(collector, layer, entityColor, applyWorld(transformOcsPoints(points, matrix), worldMatrix), pattern);
  return true;
}

/**
 * Collect an ARC entity into the GeometryCollector.
 * Returns true if collected, false if not handled.
 */
export function collectArc(p: CollectEntityParams): boolean {
  const { entity, colorCtx, collector, layer, worldMatrix, overrideColor } = p;

  if (!isArcEntity(entity)) return false;

  const entityColor = overrideColor ?? resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);
  const ltInfo = resolveEntityLinetype(
    entity, colorCtx.layers, colorCtx.lineTypes,
    colorCtx.globalLtScale, colorCtx.blockLineType, colorCtx.headerLtScale,
  );
  const pattern = ltInfo?.pattern;

  const matrix = buildOcsMatrix(entity.extrusionDirection);
  const points = generateArcPoints(
    entity.center.x,
    entity.center.y,
    entity.center.z || 0,
    entity.radius,
    entity.startAngle,
    entity.endAngle,
  );
  addLineToCollector(collector, layer, entityColor, applyWorld(transformOcsPoints(points, matrix), worldMatrix), pattern);
  return true;
}
