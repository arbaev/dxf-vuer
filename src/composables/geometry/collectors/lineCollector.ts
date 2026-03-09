import * as THREE from "three";
import { isLineEntity } from "@/types/dxf";
import type { CollectEntityParams } from "../blockTemplateCache";
import { resolveEntityColor } from "@/utils/colorResolver";
import { resolveEntityLinetype } from "@/utils/linetypeResolver";
import { addLineToCollector, applyWorld } from "./helpers";

/**
 * Collect a LINE entity into the GeometryCollector.
 * Returns true if collected, false if not handled.
 */
export function collectLine(p: CollectEntityParams): boolean {
  const { entity, colorCtx, collector, layer, worldMatrix, overrideColor } = p;

  if (!isLineEntity(entity)) return false;

  const entityColor = overrideColor ?? resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);
  const ltInfo = resolveEntityLinetype(
    entity, colorCtx.layers, colorCtx.lineTypes,
    colorCtx.globalLtScale, colorCtx.blockLineType, colorCtx.headerLtScale,
  );
  const pattern = ltInfo?.pattern;

  const v0 = entity.vertices[0];
  const v1 = entity.vertices[1];
  const points = [
    new THREE.Vector3(v0.x, v0.y, 0),
    new THREE.Vector3(v1.x, v1.y, 0),
  ];
  addLineToCollector(collector, layer, entityColor, applyWorld(points, worldMatrix), pattern);
  return true;
}
