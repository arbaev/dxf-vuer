import type { CollectEntityParams } from "../blockTemplateCache";

// Import all collectors
import { collectLine } from "./lineCollector";
import { collectCircle, collectArc } from "./circleArcCollector";
import { collectEllipse } from "./ellipseCollector";
import { collectSpline } from "./splineCollector";
import { collectPolyline } from "./polylineCollector";
import { collectPoint } from "./pointCollector";
import { collectSolid } from "./solidCollector";
import { collectFace } from "./faceCollector";
import { collectHatch } from "./hatchCollector";
import { collectMline } from "./mlineCollector";
import { collectXline } from "./xlineCollector";

type EntityCollectorFn = (p: CollectEntityParams) => boolean;

/** Dispatch map: entity type name -> collector function */
const entityCollectors: Record<string, EntityCollectorFn> = {
  LINE: collectLine,
  CIRCLE: collectCircle,
  ARC: collectArc,
  ELLIPSE: collectEllipse,
  SPLINE: collectSpline,
  LWPOLYLINE: collectPolyline,
  POLYLINE: collectPolyline,
  POINT: collectPoint,
  SOLID: collectSolid,
  "3DFACE": collectFace,
  HATCH: collectHatch,
  MLINE: collectMline,
  XLINE: collectXline,
  RAY: collectXline,
};

/**
 * Collect a simple entity into the GeometryCollector via dispatch map.
 * Returns true if the entity was collected, false if not handled.
 */
export function collectEntity(p: CollectEntityParams): boolean {
  const handler = entityCollectors[p.entity.type];
  return handler ? handler(p) : false;
}

// Re-export helpers needed by other modules
export { computePolylinePoints } from "./polylineCollector";
export { computeSplinePoints } from "./splineCollector";
export { computePointDisplaySize } from "./pointCollector";

// Re-export shared helpers
export { addLineToCollector, computeFaceData, applyWorld } from "./helpers";

// Re-export complex entity collectors (TEXT, DIMENSION, LEADER, INSERT)
export { collectTextOrMText, collectAttdefEntity } from "./textCollector";
export { collectDimensionEntity } from "./dimensionCollector";
export { collectLeaderEntity, catmullRomSpline } from "./leaderCollector";
export {
  collectInsertEntity,
  MAX_RECURSION_DEPTH,
  type YieldState,
  type ProcessEntityFn,
  type CollectEntityFn,
} from "./insertCollector";
