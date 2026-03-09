import * as THREE from "three";
import type { DxfXlineEntity } from "@/types/dxf";
import type { CollectEntityParams } from "../blockTemplateCache";
import { resolveEntityColor } from "@/utils/colorResolver";
import { resolveEntityLinetype } from "@/utils/linetypeResolver";
import { addLineToCollector, applyWorld } from "./helpers";

/**
 * Collect an XLINE or RAY entity into the GeometryCollector.
 * XLINE extends infinitely in both directions (clipped to drawing extents).
 * RAY extends only in the positive direction from the base point.
 * Returns true if collected, false if not handled.
 */
export function collectXline(p: CollectEntityParams): boolean {
  const { entity, colorCtx, collector, layer, worldMatrix, overrideColor } = p;

  const xline = entity as DxfXlineEntity;
  if (!xline.basePoint || !xline.direction) return false;

  const entityColor = overrideColor ?? resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);
  const ltInfo = resolveEntityLinetype(
    entity, colorCtx.layers, colorCtx.lineTypes,
    colorCtx.globalLtScale, colorCtx.blockLineType, colorCtx.headerLtScale,
  );
  const pattern = ltInfo?.pattern;

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
