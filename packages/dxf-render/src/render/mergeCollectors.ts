import * as THREE from "three";
import { getLineMaterial, getMeshMaterial, getPointsMaterial } from "./primitives";
import { MaterialCacheStore } from "./materialCache";
import { isThemeAdaptiveColor } from "@/utils/colorResolver";
import { LINETYPE_DOT_SIZE } from "@/constants";

// ─── Growable typed arrays ──────────────────────────────────────────

/**
 * Growable Float32Array for efficient accumulation of vertex data.
 * Avoids boxing overhead of number[] and eliminates the slow
 * number[]→Float32Array conversion at flush time.
 */
export class GrowableFloat32Array {
  buffer: Float32Array;
  length = 0;

  constructor(initialCapacity = 1024) {
    this.buffer = new Float32Array(initialCapacity);
  }

  private grow(needed: number): void {
    const newCap = Math.max(this.buffer.length * 2, this.length + needed);
    const newBuf = new Float32Array(newCap);
    newBuf.set(this.buffer.subarray(0, this.length));
    this.buffer = newBuf;
  }

  push(v: number): void {
    if (this.length >= this.buffer.length) this.grow(1);
    this.buffer[this.length++] = v;
  }

  push3(x: number, y: number, z: number): void {
    if (this.length + 3 > this.buffer.length) this.grow(3);
    this.buffer[this.length++] = x;
    this.buffer[this.length++] = y;
    this.buffer[this.length++] = z;
  }

  push6(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): void {
    if (this.length + 6 > this.buffer.length) this.grow(6);
    this.buffer[this.length++] = x1;
    this.buffer[this.length++] = y1;
    this.buffer[this.length++] = z1;
    this.buffer[this.length++] = x2;
    this.buffer[this.length++] = y2;
    this.buffer[this.length++] = z2;
  }

  pushArray(arr: number[]): void {
    const n = arr.length;
    if (this.length + n > this.buffer.length) this.grow(n);
    for (let i = 0; i < n; i++) {
      this.buffer[this.length + i] = arr[i];
    }
    this.length += n;
  }

  /** Push flat [x,y,z, ...] array with per-vertex offset subtraction */
  pushArrayWithOffset3(arr: number[], ox: number, oy: number, oz: number): void {
    const n = arr.length;
    if (this.length + n > this.buffer.length) this.grow(n);
    for (let i = 0; i < n; i += 3) {
      this.buffer[this.length + i] = arr[i] - ox;
      this.buffer[this.length + i + 1] = arr[i + 1] - oy;
      this.buffer[this.length + i + 2] = arr[i + 2] - oz;
    }
    this.length += n;
  }

  at(index: number): number {
    return this.buffer[index];
  }

  /** Return a compact Float32Array copy for use in BufferAttribute */
  toFloat32Array(): Float32Array {
    return this.buffer.slice(0, this.length);
  }

  /** Convert to regular number[] (for block templates and tests) */
  toArray(): number[] {
    return Array.from(this.buffer.subarray(0, this.length));
  }
}

/**
 * Growable Uint32Array for efficient accumulation of mesh indices.
 */
export class GrowableUint32Array {
  buffer: Uint32Array;
  length = 0;

  constructor(initialCapacity = 1024) {
    this.buffer = new Uint32Array(initialCapacity);
  }

  private grow(needed: number): void {
    const newCap = Math.max(this.buffer.length * 2, this.length + needed);
    const newBuf = new Uint32Array(newCap);
    newBuf.set(this.buffer.subarray(0, this.length));
    this.buffer = newBuf;
  }

  pushArrayWithOffset(arr: number[], offset: number): void {
    const n = arr.length;
    if (this.length + n > this.buffer.length) this.grow(n);
    for (let i = 0; i < n; i++) {
      this.buffer[this.length + i] = arr[i] + offset;
    }
    this.length += n;
  }

  at(index: number): number {
    return this.buffer[index];
  }

  /** Return a compact Uint32Array copy for BufferAttribute index */
  toUint32Array(): Uint32Array {
    return this.buffer.slice(0, this.length);
  }

  /** Convert to regular number[] (for block templates and tests) */
  toArray(): number[] {
    return Array.from(this.buffer.subarray(0, this.length));
  }
}

// ─── GeometryCollector ──────────────────────────────────────────────

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
  readonly lineSegments = new Map<string, GrowableFloat32Array>();
  /** Point positions (POINT entities): flat [x,y,z, ...] per key */
  readonly points = new Map<string, GrowableFloat32Array>();
  /** Linetype dot positions (smaller size): flat [x,y,z, ...] per key */
  readonly linetypeDots = new Map<string, GrowableFloat32Array>();
  /** Mesh vertex positions: flat [x,y,z, ...] per key */
  readonly meshVertices = new Map<string, GrowableFloat32Array>();
  /** Mesh triangle indices per key */
  readonly meshIndices = new Map<string, GrowableUint32Array>();
  /** Overlay mesh vertices (text + arrows) rendered on top of everything */
  readonly overlayVertices = new Map<string, GrowableFloat32Array>();
  /** Overlay mesh triangle indices */
  readonly overlayIndices = new Map<string, GrowableUint32Array>();

  /** Origin offset subtracted from all coordinates for Float32 precision */
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;

  constructor(originOffset?: { x: number; y: number; z: number }) {
    this.ox = originOffset?.x ?? 0;
    this.oy = originOffset?.y ?? 0;
    this.oz = originOffset?.z ?? 0;
  }

  private static makeKey(layer: string, color: string): string {
    return `${layer}::${color}`;
  }

  private getOrCreateFloat32(map: Map<string, GrowableFloat32Array>, key: string): GrowableFloat32Array {
    let arr = map.get(key);
    if (!arr) {
      arr = new GrowableFloat32Array();
      map.set(key, arr);
    }
    return arr;
  }

  /**
   * Add a continuous polyline as segment pairs.
   * [p0,p1,p2,p3] → pairs [p0,p1, p1,p2, p2,p3]
   */
  addLineFromPoints(layer: string, color: string, points: THREE.Vector3[]): void {
    if (points.length < 2) return;
    const key = GeometryCollector.makeKey(layer, color);
    const arr = this.getOrCreateFloat32(this.lineSegments, key);
    const { ox, oy, oz } = this;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      arr.push6(a.x - ox, a.y - oy, a.z - oz, b.x - ox, b.y - oy, b.z - oz);
    }
  }

  /**
   * Add pre-built line segment data (flat array, already paired).
   * Used for patterned lines (LineSegments from applyLinetypePattern).
   */
  addLineSegments(layer: string, color: string, flatData: number[]): void {
    if (flatData.length < 6) return;
    const key = GeometryCollector.makeKey(layer, color);
    const arr = this.getOrCreateFloat32(this.lineSegments, key);
    arr.pushArrayWithOffset3(flatData, this.ox, this.oy, this.oz);
  }

  /** Add point positions (flat [x,y,z, ...]) */
  addPoints(layer: string, color: string, flatData: number[]): void {
    if (flatData.length < 3) return;
    const key = GeometryCollector.makeKey(layer, color);
    const arr = this.getOrCreateFloat32(this.points, key);
    arr.pushArrayWithOffset3(flatData, this.ox, this.oy, this.oz);
  }

  /** Add a single point */
  addPoint(layer: string, color: string, x: number, y: number, z: number): void {
    const key = GeometryCollector.makeKey(layer, color);
    const arr = this.getOrCreateFloat32(this.points, key);
    arr.push3(x - this.ox, y - this.oy, z - this.oz);
  }

  /** Add linetype dot positions (rendered with smaller LINETYPE_DOT_SIZE) */
  addLinetypeDots(layer: string, color: string, flatData: number[]): void {
    if (flatData.length < 3) return;
    const key = GeometryCollector.makeKey(layer, color);
    const arr = this.getOrCreateFloat32(this.linetypeDots, key);
    arr.pushArrayWithOffset3(flatData, this.ox, this.oy, this.oz);
  }

  /**
   * Add mesh triangles (vertices + indices).
   * Indices are offset by the current vertex count for this key.
   */
  addMesh(layer: string, color: string, vertices: number[], indices: number[]): void {
    this.addMeshToBuffers(this.meshVertices, this.meshIndices, layer, color, vertices, indices);
  }

  /**
   * Add overlay mesh triangles (text glyphs + dimension/leader arrows).
   * Rendered last in flush() — on top of lines and regular meshes.
   */
  addOverlayMesh(layer: string, color: string, vertices: number[], indices: number[]): void {
    this.addMeshToBuffers(this.overlayVertices, this.overlayIndices, layer, color, vertices, indices);
  }

  private addMeshToBuffers(
    verticesMap: Map<string, GrowableFloat32Array>,
    indicesMap: Map<string, GrowableUint32Array>,
    layer: string, color: string, vertices: number[], indices: number[],
  ): void {
    if (vertices.length < 9 || indices.length < 3) return;
    const key = GeometryCollector.makeKey(layer, color);

    let vArr = verticesMap.get(key);
    if (!vArr) {
      vArr = new GrowableFloat32Array();
      verticesMap.set(key, vArr);
    }
    let iArr = indicesMap.get(key);
    if (!iArr) {
      iArr = new GrowableUint32Array();
      indicesMap.set(key, iArr);
    }

    // Offset indices by existing vertex count
    const vertexOffset = vArr.length / 3;
    iArr.pushArrayWithOffset(indices, vertexOffset);
    vArr.pushArrayWithOffset3(vertices, this.ox, this.oy, this.oz);
  }

  /**
   * Create merged Three.js objects from accumulated data.
   * Returns array of objects with userData.layerName set.
   * Buffers exceeding MAX_BUFFER_VERTICES are split into multiple objects
   * to stay within WebGL draw call limits.
   */
  flush(materials: MaterialCacheStore): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];

    // Merged Meshes — rendered first (behind lines/points)
    for (const [key, vArr] of this.meshVertices) {
      const iArr = this.meshIndices.get(key);
      if (!iArr || vArr.length < 9 || iArr.length < 3) continue;
      const [layer, color] = parseKey(key);
      const mat = getMeshMaterial(color, materials);

      // Split meshes by triangle: find split points in index array
      const totalVerts = vArr.length / 3;
      if (totalVerts <= MAX_BUFFER_VERTICES) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(vArr.toFloat32Array(), 3));
        geo.setIndex(new THREE.BufferAttribute(iArr.toUint32Array(), 1));
        const obj = new THREE.Mesh(geo, mat);
        obj.frustumCulled = false;
        obj.userData.layerName = layer;
        objects.push(obj);
      } else {
        // Emit all vertices + indices, but split index runs so each draw stays under the limit.
        // Since all triangles share one position buffer, we split by index range.
        const allPos = vArr.toFloat32Array();
        const allIdx = iArr.toUint32Array();
        for (let start = 0; start < allIdx.length; start += MAX_BUFFER_VERTICES * 3) {
          const end = Math.min(start + MAX_BUFFER_VERTICES * 3, allIdx.length);
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(allPos, 3));
          geo.setIndex(new THREE.BufferAttribute(allIdx.slice(start, end), 1));
          const obj = new THREE.Mesh(geo, mat);
          obj.frustumCulled = false;
          obj.userData.layerName = layer;
          objects.push(obj);
        }
      }
    }

    // Merged LineSegments — on top of meshes
    for (const [key, arr] of this.lineSegments) {
      if (arr.length < 6) continue;
      const [layer, color] = parseKey(key);
      const mat = getLineMaterial(color, materials);
      emitSplitBuffers(arr, layer, 3, objects, (posAttr, lyr) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", posAttr);
        const obj = new THREE.LineSegments(geo, mat);
        obj.frustumCulled = false;
        obj.userData.layerName = lyr;
        return obj;
      });
    }

    // Merged Points (POINT entities — POINT_MARKER_SIZE)
    for (const [key, arr] of this.points) {
      if (arr.length < 3) continue;
      const [layer, color] = parseKey(key);
      const mat = getPointsMaterial(color, materials);
      emitSplitBuffers(arr, layer, 3, objects, (posAttr, lyr) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", posAttr);
        const obj = new THREE.Points(geo, mat);
        obj.frustumCulled = false;
        obj.userData.layerName = lyr;
        return obj;
      });
    }

    // Merged linetype dots (smaller LINETYPE_DOT_SIZE)
    const dotMatCache = new Map<string, THREE.PointsMaterial>();
    for (const [key, arr] of this.linetypeDots) {
      if (arr.length < 3) continue;
      const [layer, color] = parseKey(key);
      let mat = dotMatCache.get(color);
      if (!mat) {
        const resolved = materials.resolveColor(color);
        mat = new THREE.PointsMaterial({
          color: resolved,
          size: LINETYPE_DOT_SIZE,
          sizeAttenuation: false,
          depthTest: false,
          depthWrite: false,
        });
        dotMatCache.set(color, mat);
        if (isThemeAdaptiveColor(color)) materials.trackThemeMaterial(mat, color);
      }
      emitSplitBuffers(arr, layer, 3, objects, (posAttr, lyr) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", posAttr);
        const obj = new THREE.Points(geo, mat!);
        obj.frustumCulled = false;
        obj.userData.layerName = lyr;
        return obj;
      });
    }

    // Overlay Meshes (text glyphs + arrows) — rendered last, on top of everything
    for (const [key, vArr] of this.overlayVertices) {
      const iArr = this.overlayIndices.get(key);
      if (!iArr || vArr.length < 9 || iArr.length < 3) continue;
      const [layer, color] = parseKey(key);
      const mat = getMeshMaterial(color, materials);

      const totalVerts = vArr.length / 3;
      if (totalVerts <= MAX_BUFFER_VERTICES) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(vArr.toFloat32Array(), 3));
        geo.setIndex(new THREE.BufferAttribute(iArr.toUint32Array(), 1));
        const obj = new THREE.Mesh(geo, mat);
        obj.frustumCulled = false;
        obj.userData.layerName = layer;
        objects.push(obj);
      } else {
        const allPos = vArr.toFloat32Array();
        const allIdx = iArr.toUint32Array();
        for (let start = 0; start < allIdx.length; start += MAX_BUFFER_VERTICES * 3) {
          const end = Math.min(start + MAX_BUFFER_VERTICES * 3, allIdx.length);
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(allPos, 3));
          geo.setIndex(new THREE.BufferAttribute(allIdx.slice(start, end), 1));
          const obj = new THREE.Mesh(geo, mat);
          obj.frustumCulled = false;
          obj.userData.layerName = layer;
          objects.push(obj);
        }
      }
    }

    return objects;
  }
}

/**
 * Maximum vertices per draw call. WebGL contexts commonly limit this to 30M;
 * we use 10M to stay safely below and keep GPU uploads fast.
 */
const MAX_BUFFER_VERTICES = 10_000_000;
/** Max floats = MAX_BUFFER_VERTICES * 3 (xyz) */
const MAX_BUFFER_FLOATS = MAX_BUFFER_VERTICES * 3;

/**
 * Emit one or more Three.js objects from a GrowableFloat32Array,
 * splitting into chunks of MAX_BUFFER_FLOATS if needed.
 * `stride` must be 3 (xyz) or 6 (segment pair) — splits are aligned to stride.
 */
function emitSplitBuffers(
  arr: GrowableFloat32Array,
  layer: string,
  stride: number,
  out: THREE.Object3D[],
  factory: (posAttr: THREE.BufferAttribute, layer: string) => THREE.Object3D,
): void {
  const total = arr.length;
  if (total <= MAX_BUFFER_FLOATS) {
    out.push(factory(new THREE.BufferAttribute(arr.toFloat32Array(), 3), layer));
    return;
  }
  // Split into chunks aligned to stride
  const chunkFloats = Math.floor(MAX_BUFFER_FLOATS / stride) * stride;
  for (let offset = 0; offset < total; offset += chunkFloats) {
    const end = Math.min(offset + chunkFloats, total);
    const slice = arr.buffer.slice(offset, end);
    out.push(factory(new THREE.BufferAttribute(slice, 3), layer));
  }
}

function parseKey(key: string): [string, string] {
  const idx = key.indexOf("::");
  if (idx === -1) return ["0", key];
  return [key.substring(0, idx), key.substring(idx + 2)];
}
