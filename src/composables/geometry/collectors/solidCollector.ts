import * as THREE from "three";
import type { DxfVertex } from "@/types/dxf";
import { isSolidEntity } from "@/types/dxf";
import type { CollectEntityParams } from "../blockTemplateCache";
import { resolveEntityColor } from "@/utils/colorResolver";
import { buildOcsMatrix } from "@/utils/ocsTransform";
import { computeFaceData } from "./helpers";

/**
 * Collect a SOLID entity into the GeometryCollector.
 * Returns true if collected, false if not handled.
 */
export function collectSolid(p: CollectEntityParams): boolean {
  const { entity, colorCtx, collector, layer, worldMatrix, overrideColor } = p;

  if (!isSolidEntity(entity)) return false;

  const entityColor = overrideColor ?? resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);

  const matrix = buildOcsMatrix(entity.extrusionDirection);
  let pts: DxfVertex[] = entity.points;
  if (matrix) {
    pts = entity.points.map((pt) => {
      const v = new THREE.Vector3(pt.x, pt.y, pt.z || 0).applyMatrix4(matrix);
      return { x: v.x, y: v.y, z: v.z } as DxfVertex;
    });
  }
  if (worldMatrix) {
    pts = pts.map((pt) => {
      const v = new THREE.Vector3(pt.x, pt.y, pt.z || 0).applyMatrix4(worldMatrix);
      return { x: v.x, y: v.y, z: v.z } as DxfVertex;
    });
  }
  const faceData = computeFaceData(pts);
  if (faceData) {
    collector.addMesh(layer, entityColor, faceData.vertices, faceData.indices);
    return true;
  }
  return false;
}
