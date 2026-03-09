import * as THREE from "three";
import { NURBSCurve } from "three/examples/jsm/curves/NURBSCurve.js";
import type { DxfVertex, DxfSplineEntity } from "@/types/dxf";
import { isSplineEntity } from "@/types/dxf";
import type { CollectEntityParams } from "../blockTemplateCache";
import { resolveEntityColor } from "@/utils/colorResolver";
import { resolveEntityLinetype } from "@/utils/linetypeResolver";
import {
  NURBS_SEGMENTS_MULTIPLIER,
  MIN_NURBS_SEGMENTS,
  CATMULL_ROM_SEGMENTS_MULTIPLIER,
  MIN_CATMULL_ROM_SEGMENTS,
} from "@/constants";
import { addLineToCollector, applyWorld } from "./helpers";

/**
 * Compute spline points using NURBS or CatmullRom fallback.
 */
export const computeSplinePoints = (entity: DxfSplineEntity): THREE.Vector3[] | null => {
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
      const pts = curve.getPoints(segments) as THREE.Vector3[];
      // Close the spline by appending the first point if flagged as closed
      if (entity.closed && pts.length > 1) {
        pts.push(pts[0].clone());
      }
      return pts;
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
    const curve = new THREE.CatmullRomCurve3(points, entity.closed === true, "centripetal");
    const segments = Math.max(
      points.length * CATMULL_ROM_SEGMENTS_MULTIPLIER,
      MIN_CATMULL_ROM_SEGMENTS,
    );
    return curve.getPoints(segments);
  }

  return null;
};

/**
 * Collect a SPLINE entity into the GeometryCollector.
 * Returns true if collected, false if not handled.
 */
export function collectSpline(p: CollectEntityParams): boolean {
  const { entity, colorCtx, collector, layer, worldMatrix, overrideColor } = p;

  if (!isSplineEntity(entity)) return false;

  const entityColor = overrideColor ?? resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);
  const ltInfo = resolveEntityLinetype(
    entity, colorCtx.layers, colorCtx.lineTypes,
    colorCtx.globalLtScale, colorCtx.blockLineType, colorCtx.headerLtScale,
  );
  const pattern = ltInfo?.pattern;

  const points = computeSplinePoints(entity);
  if (points) {
    addLineToCollector(collector, layer, entityColor, applyWorld(points, worldMatrix), pattern);
    return true;
  }
  return false;
}
