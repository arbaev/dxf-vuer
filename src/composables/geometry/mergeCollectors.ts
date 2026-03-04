import * as THREE from "three";
import { getLineMaterial, getMeshMaterial, getPointsMaterial } from "./primitives";
import { LINETYPE_DOT_SIZE } from "@/constants";

/**
 * GeometryCollector accumulates vertex data from multiple DXF entities
 * and merges them into a minimal number of Three.js objects.
 *
 * Key: `${layerName}::${color}` — each unique combination produces one draw call.
 *
 * Continuous lines (Line) are converted to segment pairs (LineSegments)
 * so that separate entities can share a single buffer.
 */
export class GeometryCollector {
  /** Line segment pairs: flat [x,y,z, x,y,z, ...] per key */
  readonly lineSegments = new Map<string, number[]>();
  /** Point positions (POINT entities): flat [x,y,z, ...] per key */
  readonly points = new Map<string, number[]>();
  /** Linetype dot positions (smaller size): flat [x,y,z, ...] per key */
  readonly linetypeDots = new Map<string, number[]>();
  /** Mesh vertex positions: flat [x,y,z, ...] per key */
  readonly meshVertices = new Map<string, number[]>();
  /** Mesh triangle indices per key */
  readonly meshIndices = new Map<string, number[]>();

  private static makeKey(layer: string, color: string): string {
    return `${layer}::${color}`;
  }

  /**
   * Add a continuous polyline as segment pairs.
   * [p0,p1,p2,p3] → pairs [p0,p1, p1,p2, p2,p3]
   */
  addLineFromPoints(layer: string, color: string, points: THREE.Vector3[]): void {
    if (points.length < 2) return;
    const key = GeometryCollector.makeKey(layer, color);
    let arr = this.lineSegments.get(key);
    if (!arr) {
      arr = [];
      this.lineSegments.set(key, arr);
    }
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      arr.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }

  /**
   * Add pre-built line segment data (flat array, already paired).
   * Used for patterned lines (LineSegments from applyLinetypePattern).
   */
  addLineSegments(layer: string, color: string, flatData: number[]): void {
    if (flatData.length < 6) return;
    const key = GeometryCollector.makeKey(layer, color);
    let arr = this.lineSegments.get(key);
    if (!arr) {
      arr = [];
      this.lineSegments.set(key, arr);
    }
    for (let i = 0; i < flatData.length; i++) {
      arr.push(flatData[i]);
    }
  }

  /** Add point positions (flat [x,y,z, ...]) */
  addPoints(layer: string, color: string, flatData: number[]): void {
    if (flatData.length < 3) return;
    const key = GeometryCollector.makeKey(layer, color);
    let arr = this.points.get(key);
    if (!arr) {
      arr = [];
      this.points.set(key, arr);
    }
    for (let i = 0; i < flatData.length; i++) {
      arr.push(flatData[i]);
    }
  }

  /** Add a single point */
  addPoint(layer: string, color: string, x: number, y: number, z: number): void {
    const key = GeometryCollector.makeKey(layer, color);
    let arr = this.points.get(key);
    if (!arr) {
      arr = [];
      this.points.set(key, arr);
    }
    arr.push(x, y, z);
  }

  /** Add linetype dot positions (rendered with smaller LINETYPE_DOT_SIZE) */
  addLinetypeDots(layer: string, color: string, flatData: number[]): void {
    if (flatData.length < 3) return;
    const key = GeometryCollector.makeKey(layer, color);
    let arr = this.linetypeDots.get(key);
    if (!arr) {
      arr = [];
      this.linetypeDots.set(key, arr);
    }
    for (let i = 0; i < flatData.length; i++) {
      arr.push(flatData[i]);
    }
  }

  /**
   * Add mesh triangles (vertices + indices).
   * Indices are offset by the current vertex count for this key.
   */
  addMesh(layer: string, color: string, vertices: number[], indices: number[]): void {
    if (vertices.length < 9 || indices.length < 3) return;
    const key = GeometryCollector.makeKey(layer, color);

    let vArr = this.meshVertices.get(key);
    let iArr = this.meshIndices.get(key);
    if (!vArr) {
      vArr = [];
      this.meshVertices.set(key, vArr);
    }
    if (!iArr) {
      iArr = [];
      this.meshIndices.set(key, iArr);
    }

    // Offset indices by existing vertex count
    const vertexOffset = vArr.length / 3;
    for (let i = 0; i < indices.length; i++) {
      iArr.push(indices[i] + vertexOffset);
    }
    for (let i = 0; i < vertices.length; i++) {
      vArr.push(vertices[i]);
    }
  }

  /**
   * Create merged Three.js objects from accumulated data.
   * Returns array of objects with userData.layerName set.
   */
  flush(
    materialCache: Map<string, THREE.LineBasicMaterial>,
    meshMaterialCache: Map<string, THREE.MeshBasicMaterial>,
    pointsMaterialCache: Map<string, THREE.PointsMaterial>,
  ): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];

    // Merged LineSegments
    for (const [key, data] of this.lineSegments) {
      if (data.length < 6) continue;
      const [layer, color] = parseKey(key);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(data, 3));
      const mat = getLineMaterial(color, materialCache);
      const obj = new THREE.LineSegments(geo, mat);
      obj.frustumCulled = false;
      obj.userData.layerName = layer;
      objects.push(obj);
    }

    // Merged Points (POINT entities — POINT_MARKER_SIZE)
    for (const [key, data] of this.points) {
      if (data.length < 3) continue;
      const [layer, color] = parseKey(key);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(data, 3));
      const mat = getPointsMaterial(color, pointsMaterialCache);
      const obj = new THREE.Points(geo, mat);
      obj.frustumCulled = false;
      obj.userData.layerName = layer;
      objects.push(obj);
    }

    // Merged linetype dots (smaller LINETYPE_DOT_SIZE)
    const dotMatCache = new Map<string, THREE.PointsMaterial>();
    for (const [key, data] of this.linetypeDots) {
      if (data.length < 3) continue;
      const [layer, color] = parseKey(key);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(data, 3));
      let mat = dotMatCache.get(color);
      if (!mat) {
        mat = new THREE.PointsMaterial({
          color,
          size: LINETYPE_DOT_SIZE,
          sizeAttenuation: false,
          depthTest: false,
          depthWrite: false,
        });
        dotMatCache.set(color, mat);
      }
      const obj = new THREE.Points(geo, mat);
      obj.frustumCulled = false;
      obj.userData.layerName = layer;
      objects.push(obj);
    }

    // Merged Meshes
    for (const [key, vertices] of this.meshVertices) {
      const indices = this.meshIndices.get(key);
      if (!indices || vertices.length < 9 || indices.length < 3) continue;
      const [layer, color] = parseKey(key);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      geo.setIndex(indices);
      const mat = getMeshMaterial(color, meshMaterialCache);
      const obj = new THREE.Mesh(geo, mat);
      obj.frustumCulled = false;
      obj.userData.layerName = layer;
      objects.push(obj);
    }

    return objects;
  }
}

function parseKey(key: string): [string, string] {
  const idx = key.indexOf("::");
  if (idx === -1) return ["0", key];
  return [key.substring(0, idx), key.substring(idx + 2)];
}
