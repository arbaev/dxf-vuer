import * as THREE from "three";
import type { DxfVertex, DxfEntity, DxfPolylineVertex, DxfPolylineEntity } from "@/types/dxf";
import { isPolylineEntity } from "@/types/dxf";
import type { CollectEntityParams } from "../blockTemplateCache";
import type { GeometryCollector } from "../mergeCollectors";
import { createBulgeArc } from "../primitives";
import { resolveEntityColor } from "@/utils/colorResolver";
import { resolveEntityLinetype } from "@/utils/linetypeResolver";
import { buildOcsMatrix, transformOcsPoints } from "@/utils/ocsTransform";
import { EPSILON } from "@/constants";
import { addLineToCollector, applyWorld } from "./helpers";

/**
 * Compute polyline points (with bulge arcs) from entity vertices.
 */
export const computePolylinePoints = (entity: DxfEntity & { vertices: DxfVertex[]; shape?: boolean }): THREE.Vector3[] => {
  const allPoints: THREE.Vector3[] = [];

  for (let i = 0; i < entity.vertices.length - 1; i++) {
    const v1 = entity.vertices[i];
    const v2 = entity.vertices[i + 1];
    if (!v1 || !v2) continue;

    const p1 = new THREE.Vector3(v1.x, v1.y, 0);
    const p2 = new THREE.Vector3(v2.x, v2.y, 0);

    if (i === 0) {
      allPoints.push(p1);
    }

    if (v1.bulge && Math.abs(v1.bulge) > EPSILON) {
      const arcPoints = createBulgeArc(p1, p2, v1.bulge);
      allPoints.push(...arcPoints.slice(1));
    } else {
      allPoints.push(p2);
    }
  }

  // Closing segment for closed polylines (shape = true)
  if (entity.shape && entity.vertices.length > 1) {
    const vLast = entity.vertices[entity.vertices.length - 1];
    const vFirst = entity.vertices[0];
    const pLast = new THREE.Vector3(vLast.x, vLast.y, 0);
    const pFirst = new THREE.Vector3(vFirst.x, vFirst.y, 0);

    if (vLast.bulge && Math.abs(vLast.bulge) > EPSILON) {
      const arcPoints = createBulgeArc(pLast, pFirst, vLast.bulge);
      allPoints.push(...arcPoints.slice(1));
    } else {
      allPoints.push(pFirst);
    }
  }

  return allPoints;
};

/**
 * Render a wide polyline (width > 0) as a filled mesh.
 * Generates the outline by offsetting the polyline path by +/-width/2,
 * then triangulates the result using ShapeGeometry.
 */
const addWidePolylineToCollector = (
  collector: GeometryCollector,
  layer: string,
  color: string,
  entity: DxfPolylineEntity,
  ocsMatrix: THREE.Matrix4 | null,
  worldMatrix?: THREE.Matrix4,
): void => {
  const halfW = (entity.width || entity.defaultStartWidth || 0) / 2;
  if (halfW <= 0) return;

  // Build the polyline center path as dense points
  const centerPoints = computePolylinePoints(entity);
  if (centerPoints.length < 2) return;

  // Transform to WCS
  const pts = worldMatrix
    ? transformOcsPoints(centerPoints, ocsMatrix).map(p => p.applyMatrix4(worldMatrix))
    : transformOcsPoints(centerPoints, ocsMatrix);

  // Build left and right offset paths
  const left: THREE.Vector2[] = [];
  const right: THREE.Vector2[] = [];
  for (let i = 0; i < pts.length; i++) {
    let nx: number, ny: number;
    if (i === 0) {
      nx = -(pts[1].y - pts[0].y);
      ny = pts[1].x - pts[0].x;
    } else if (i === pts.length - 1) {
      nx = -(pts[i].y - pts[i - 1].y);
      ny = pts[i].x - pts[i - 1].x;
    } else {
      nx = -(pts[i + 1].y - pts[i - 1].y);
      ny = pts[i + 1].x - pts[i - 1].x;
    }
    const len = Math.sqrt(nx * nx + ny * ny);
    if (len < EPSILON) {
      // Degenerate: skip offset or use previous
      if (left.length > 0) {
        left.push(left[left.length - 1].clone());
        right.push(right[right.length - 1].clone());
      }
      continue;
    }
    nx /= len;
    ny /= len;
    left.push(new THREE.Vector2(pts[i].x + nx * halfW, pts[i].y + ny * halfW));
    right.push(new THREE.Vector2(pts[i].x - nx * halfW, pts[i].y - ny * halfW));
  }

  if (left.length < 2) return;

  // Build a closed shape: left path forward + right path backward
  const shape = new THREE.Shape();
  shape.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) {
    shape.lineTo(left[i].x, left[i].y);
  }
  // If closed polyline, connect last left to first left via right side
  for (let i = right.length - 1; i >= 0; i--) {
    shape.lineTo(right[i].x, right[i].y);
  }
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape);
  const posAttr = geometry.getAttribute("position");
  const idxAttr = geometry.getIndex();
  if (!posAttr || !idxAttr) { geometry.dispose(); return; }

  const vertices: number[] = [];
  for (let i = 0; i < posAttr.count; i++) {
    vertices.push(posAttr.getX(i), posAttr.getY(i), 0);
  }
  const indices: number[] = [];
  for (let i = 0; i < idxAttr.count; i++) {
    indices.push(idxAttr.getX(i));
  }
  geometry.dispose();

  collector.addMesh(layer, color, vertices, indices);
};

/**
 * Render a POLYLINE polyface mesh as wireframe edges.
 * Position vertices (vertexFlags & 64 or 128 set, no faceA) define point positions (1-based).
 * Face vertices (faceA defined) reference those positions; negative index = invisible edge.
 */
const addPolyfaceMeshEdges = (
  collector: GeometryCollector,
  layer: string,
  color: string,
  vertices: DxfPolylineVertex[],
  worldMatrix?: THREE.Matrix4,
): void => {
  // Separate position vertices from face vertices
  const positions: THREE.Vector3[] = [];
  const faces: DxfPolylineVertex[] = [];
  for (const v of vertices) {
    if (v.faceA !== undefined) {
      faces.push(v);
    } else {
      positions.push(new THREE.Vector3(v.x, v.y, v.z || 0));
    }
  }
  if (worldMatrix) {
    for (const p of positions) p.applyMatrix4(worldMatrix);
  }
  if (positions.length === 0 || faces.length === 0) return;

  // Each face has up to 4 vertex indices (1-based). Negative = invisible edge.
  for (const face of faces) {
    const idxArr = [face.faceA, face.faceB, face.faceC, face.faceD];
    const faceVerts: number[] = [];
    const visible: boolean[] = [];
    for (const idx of idxArr) {
      if (idx === undefined || idx === 0) continue;
      faceVerts.push(Math.abs(idx));
      visible.push(idx > 0);
    }
    for (let i = 0; i < faceVerts.length; i++) {
      if (!visible[i]) continue;
      const a = faceVerts[i] - 1;
      const b = faceVerts[(i + 1) % faceVerts.length] - 1;
      if (a < 0 || a >= positions.length || b < 0 || b >= positions.length) continue;
      collector.addLineFromPoints(layer, color, [positions[a], positions[b]]);
    }
  }
};

/**
 * Render a 3D polygon mesh (POLYLINE code 70 bit 4) as wireframe edges.
 * Vertices are laid out in an M x N grid. Edges connect adjacent cells
 * horizontally and vertically (no diagonals).
 * shape (bit 0) = closed in M direction, is3dPolygonMeshClosed (bit 5) = closed in N direction.
 */
const addPolygonMeshEdges = (
  collector: GeometryCollector,
  layer: string,
  color: string,
  entity: DxfPolylineEntity,
  worldMatrix?: THREE.Matrix4,
): void => {
  const M = entity.meshMVertexCount!;
  const N = entity.meshNVertexCount!;
  const verts = entity.vertices;
  if (verts.length < M * N) return;

  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < M * N; i++) {
    const v = verts[i];
    pts.push(new THREE.Vector3(v.x, v.y, v.z || 0));
  }
  if (worldMatrix) {
    for (const p of pts) p.applyMatrix4(worldMatrix);
  }

  const closedM = entity.shape === true;
  const closedN = entity.is3dPolygonMeshClosed === true;

  const idx = (m: number, n: number) => m * N + n;

  // Horizontal edges: along N direction
  for (let m = 0; m < M; m++) {
    const nEnd = closedN ? N : N - 1;
    for (let n = 0; n < nEnd; n++) {
      collector.addLineFromPoints(layer, color, [pts[idx(m, n)], pts[idx(m, (n + 1) % N)]]);
    }
  }
  // Vertical edges: along M direction
  for (let n = 0; n < N; n++) {
    const mEnd = closedM ? M : M - 1;
    for (let m = 0; m < mEnd; m++) {
      collector.addLineFromPoints(layer, color, [pts[idx(m, n)], pts[idx((m + 1) % M, n)]]);
    }
  }
};

/**
 * Collect a LWPOLYLINE or POLYLINE entity into the GeometryCollector.
 * Handles polyface mesh, 3D polygon mesh, wide polyline, and regular polyline.
 * Returns true if collected, false if not handled.
 */
export function collectPolyline(p: CollectEntityParams): boolean {
  const { entity, colorCtx, collector, layer, worldMatrix, overrideColor } = p;

  if (!isPolylineEntity(entity)) return false;
  if (entity.vertices.length === 0) return true; // degenerate: skip silently
  if (entity.vertices.length === 1) {
    // Single-vertex polyline: render as a point
    const entityColor = overrideColor ?? resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor);
    const v = entity.vertices[0];
    const pt = new THREE.Vector3(v.x, v.y, v.z ?? 0);
    const ocsMatrix = buildOcsMatrix(entity.extrusionDirection);
    if (ocsMatrix) pt.applyMatrix4(ocsMatrix);
    if (worldMatrix) pt.applyMatrix4(worldMatrix);
    collector.addPoint(layer, entityColor, pt.x, pt.y, pt.z);
    return true;
  }

  const entityColor = overrideColor ?? resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor);
  const ltInfo = resolveEntityLinetype(
    entity, colorCtx.layers, colorCtx.lineTypes,
    colorCtx.globalLtScale, colorCtx.blockLineType, colorCtx.headerLtScale,
  );
  const pattern = ltInfo?.pattern;

  // Polyface mesh: vertices define positions + face indices
  if (entity.isPolyfaceMesh) {
    addPolyfaceMeshEdges(collector, layer, entityColor, entity.vertices, worldMatrix);
    return true;
  }
  // 3D polygon mesh: vertices in M x N grid
  if (entity.is3dPolygonMesh && entity.meshMVertexCount && entity.meshNVertexCount) {
    addPolygonMeshEdges(collector, layer, entityColor, entity, worldMatrix);
    return true;
  }
  // Wide polyline: render as filled shape
  const polyWidth = entity.width || entity.defaultStartWidth || 0;
  if (polyWidth > 0) {
    const matrix = buildOcsMatrix(entity.extrusionDirection);
    addWidePolylineToCollector(collector, layer, entityColor, entity, matrix, worldMatrix);
    return true;
  }
  const matrix = buildOcsMatrix(entity.extrusionDirection);
  const allPoints = computePolylinePoints(entity);
  addLineToCollector(collector, layer, entityColor, applyWorld(transformOcsPoints(allPoints, matrix), worldMatrix), pattern);
  return true;
}
