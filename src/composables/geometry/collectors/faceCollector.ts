import * as THREE from "three";
import type { DxfVertex } from "@/types/dxf";
import { is3DFaceEntity } from "@/types/dxf";
import type { CollectEntityParams } from "../blockTemplateCache";
import type { GeometryCollector } from "../mergeCollectors";
import { resolveEntityColor } from "@/utils/colorResolver";

/**
 * Add 3DFACE edges as lines, respecting edge visibility flags (DXF code 70).
 * Bits 0-3: when set, the corresponding edge is INVISIBLE.
 * Edge 0: vertex 0->1, Edge 1: vertex 1->2, Edge 2: vertex 2->3, Edge 3: vertex 3->0.
 */
const add3DFaceEdges = (
  collector: GeometryCollector,
  layer: string,
  color: string,
  pts: DxfVertex[],
  edgeFlags?: number,
): void => {
  if (!pts || pts.length < 3) return;
  const flags = edgeFlags ?? 0;
  const n = pts.length;
  // Edge pairs: [0,1], [1,2], [2,3], [3,0] (or [2,0] for triangles)
  const edges: [number, number][] = n >= 4
    ? [[0, 1], [1, 2], [2, 3], [3, 0]]
    : [[0, 1], [1, 2], [2, 0]];
  for (let i = 0; i < edges.length; i++) {
    if (flags & (1 << i)) continue; // invisible edge
    const [a, b] = edges[i];
    const points = [
      new THREE.Vector3(pts[a].x, pts[a].y, pts[a].z || 0),
      new THREE.Vector3(pts[b].x, pts[b].y, pts[b].z || 0),
    ];
    collector.addLineFromPoints(layer, color, points);
  }
};

/**
 * Collect a 3DFACE entity into the GeometryCollector.
 * Returns true if collected, false if not handled.
 */
export function collectFace(p: CollectEntityParams): boolean {
  const { entity, colorCtx, collector, layer, worldMatrix, overrideColor } = p;

  if (!is3DFaceEntity(entity)) return false;

  const entityColor = overrideColor ?? resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);

  let pts: DxfVertex[] = entity.vertices;
  if (worldMatrix) {
    pts = pts.map((pt) => {
      const v = new THREE.Vector3(pt.x, pt.y, pt.z || 0).applyMatrix4(worldMatrix);
      return { x: v.x, y: v.y, z: v.z } as DxfVertex;
    });
  }
  add3DFaceEdges(collector, layer, entityColor, pts, entity.edgeFlags);
  return true;
}
