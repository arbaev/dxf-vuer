import * as THREE from "three";
import type { DxfMlineEntity } from "@/types/dxf";
import type { CollectEntityParams } from "../blockTemplateCache";
import { resolveEntityColor } from "@/utils/colorResolver";
import { resolveEntityLinetype } from "@/utils/linetypeResolver";
import { buildOcsMatrix, transformOcsPoints } from "@/utils/ocsTransform";
import { addLineToCollector, applyWorld } from "./helpers";

/**
 * Collect an MLINE entity into the GeometryCollector.
 * Each element of the multiline is rendered as a separate polyline.
 * Returns true if collected, false if not handled.
 */
export function collectMline(p: CollectEntityParams): boolean {
  const { entity, colorCtx, collector, layer, worldMatrix, overrideColor } = p;

  const mline = entity as DxfMlineEntity;
  if (!mline.vertices?.length || mline.vertices.length <= 1 || mline.numElements <= 0) return false;

  const entityColor = overrideColor ?? resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);
  const ltInfo = resolveEntityLinetype(
    entity, colorCtx.layers, colorCtx.lineTypes,
    colorCtx.globalLtScale, colorCtx.blockLineType, colorCtx.headerLtScale,
  );
  const pattern = ltInfo?.pattern;

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
