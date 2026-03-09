import * as THREE from "three";

/**
 * Consolidated cache for Three.js materials used during DXF rendering.
 * Materials are cached per color key to avoid creating duplicates.
 */
export class MaterialCacheStore {
  readonly line = new Map<string, THREE.LineBasicMaterial>();
  readonly mesh = new Map<string, THREE.MeshBasicMaterial>();
  readonly points = new Map<string, THREE.PointsMaterial>();

  /** Dispose all cached materials and clear the maps */
  disposeAll(): void {
    for (const mat of this.line.values()) mat.dispose();
    this.line.clear();
    for (const mat of this.mesh.values()) mat.dispose();
    this.mesh.clear();
    for (const mat of this.points.values()) mat.dispose();
    this.points.clear();
  }
}
