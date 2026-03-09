import * as THREE from "three";
import { isEllipseEntity } from "@/types/dxf";
import type { CollectEntityParams } from "../blockTemplateCache";
import { resolveEntityColor } from "@/utils/colorResolver";
import { resolveEntityLinetype } from "@/utils/linetypeResolver";
import { buildOcsMatrix } from "@/utils/ocsTransform";
import { generateEllipsePoints } from "../curvePoints";
import { addLineToCollector, applyWorld } from "./helpers";

/**
 * Collect an ELLIPSE entity into the GeometryCollector.
 * Returns true if collected, false if not handled.
 */
export function collectEllipse(p: CollectEntityParams): boolean {
  const { entity, colorCtx, collector, layer, worldMatrix, overrideColor } = p;

  if (!isEllipseEntity(entity)) return false;

  const entityColor = overrideColor ?? resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);
  const ltInfo = resolveEntityLinetype(
    entity, colorCtx.layers, colorCtx.lineTypes,
    colorCtx.globalLtScale, colorCtx.blockLineType, colorCtx.headerLtScale,
  );
  const pattern = ltInfo?.pattern;

  // ELLIPSE center is in WCS -- no OCS transform needed for position.
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

  const points = generateEllipsePoints(
    entity.center.x,
    entity.center.y,
    entity.center.z || 0,
    majorX,
    majorY,
    entity.axisRatio,
    entity.startAngle,
    entity.endAngle,
  );

  addLineToCollector(collector, layer, entityColor, applyWorld(points, worldMatrix), pattern);
  return true;
}
