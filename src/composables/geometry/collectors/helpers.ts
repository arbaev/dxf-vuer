import * as THREE from "three";
import type { DxfVertex } from "@/types/dxf";
import { applyLinetypePattern } from "@/utils/linetypeResolver";
import { MAX_LINETYPE_REPETITIONS } from "@/constants";
import type { GeometryCollector } from "../mergeCollectors";

/**
 * Add line data to collector, handling linetype patterns.
 * Continuous lines -> addLineFromPoints (segment pairs).
 * Patterned lines -> applyLinetypePattern -> addLineSegments + addLinetypeDots.
 */
export const addLineToCollector = (
  collector: GeometryCollector,
  layer: string,
  color: string,
  points: THREE.Vector3[],
  pattern?: number[],
): void => {
  if (points.length < 2) return;

  if (pattern && pattern.length > 0) {
    // Estimate path length vs pattern cycle to avoid vertex explosion.
    // Long curves with fine patterns generate millions of sub-pixel dashes;
    // fall back to continuous line when repetitions exceed the threshold.
    let patternCycleLen = 0;
    for (const v of pattern) patternCycleLen += Math.abs(v);
    if (patternCycleLen > 0) {
      let totalLen = 0;
      for (let i = 0; i < points.length - 1; i++) {
        const dx = points[i + 1].x - points[i].x;
        const dy = points[i + 1].y - points[i].y;
        totalLen += Math.sqrt(dx * dx + dy * dy);
      }
      if (totalLen / patternCycleLen > MAX_LINETYPE_REPETITIONS) {
        collector.addLineFromPoints(layer, color, points);
        return;
      }
    }

    const pg = applyLinetypePattern(points, pattern);
    const hasSegments = pg.segments.length >= 6;
    const hasDots = pg.dots.length >= 3;

    if (hasSegments) {
      collector.addLineSegments(layer, color, pg.segments);
    }
    if (hasDots) {
      collector.addLinetypeDots(layer, color, pg.dots);
    }
    // If pattern produced nothing, add as continuous line
    if (!hasSegments && !hasDots) {
      collector.addLineFromPoints(layer, color, points);
    }
  } else {
    collector.addLineFromPoints(layer, color, points);
  }
};

/**
 * Extract flat vertices and indices from face points (SOLID, 3DFACE).
 */
export const computeFaceData = (pts: DxfVertex[]): { vertices: number[]; indices: number[] } | null => {
  if (!pts || pts.length < 3) return null;

  const vertices: number[] = [];
  const indices: number[] = [];

  for (const p of pts) {
    vertices.push(p.x, p.y, p.z || 0);
  }

  indices.push(0, 1, 2);
  if (pts.length >= 4) {
    indices.push(0, 2, 3);
  }

  return { vertices, indices };
};

/** Apply world matrix to points array in-place */
export const applyWorld = (points: THREE.Vector3[], m?: THREE.Matrix4): THREE.Vector3[] => {
  if (m) for (const p of points) p.applyMatrix4(m);
  return points;
};
