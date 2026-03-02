import * as THREE from "three";
import type { DxfVertex } from "@/types/dxf";

const THRESHOLD = 1 / 64; // ~0.015625, from DXF spec Arbitrary Axis Algorithm

/**
 * Build the OCS→WCS rotation matrix using the DXF Arbitrary Axis Algorithm.
 * Returns null when extrusion is the default (0,0,1) — identity, no transform needed.
 */
export function buildOcsMatrix(extrusion: DxfVertex | undefined): THREE.Matrix4 | null {
  if (!extrusion) return null;

  const nx = extrusion.x ?? 0;
  const ny = extrusion.y ?? 0;
  const nz = extrusion.z ?? 1;

  // Default extrusion (0,0,1) → identity
  if (Math.abs(nx) < 1e-10 && Math.abs(ny) < 1e-10 && nz > 0) return null;

  const N = new THREE.Vector3(nx, ny, nz).normalize();

  // Arbitrary Axis Algorithm: choose world axis to cross with N
  let Ax: THREE.Vector3;
  if (Math.abs(N.x) < THRESHOLD && Math.abs(N.y) < THRESHOLD) {
    // N is close to world Z — use world Y to avoid near-zero cross product
    Ax = new THREE.Vector3(0, 1, 0).cross(N).normalize();
  } else {
    // General case — use world Z
    Ax = new THREE.Vector3(0, 0, 1).cross(N).normalize();
  }

  const Ay = N.clone().cross(Ax).normalize();

  return new THREE.Matrix4().makeBasis(Ax, Ay, N);
}

/**
 * Transform an array of THREE.Vector3 points in-place from OCS to WCS.
 * Returns the same array. If matrix is null, returns unchanged (fast path).
 */
export function transformOcsPoints(
  points: THREE.Vector3[],
  matrix: THREE.Matrix4 | null,
): THREE.Vector3[] {
  if (!matrix) return points;
  for (const p of points) p.applyMatrix4(matrix);
  return points;
}

/**
 * Transform a single THREE.Vector3 from OCS to WCS.
 * Returns the same vector mutated. If matrix is null, returns unchanged.
 */
export function transformOcsPoint(
  point: THREE.Vector3,
  matrix: THREE.Matrix4 | null,
): THREE.Vector3 {
  if (!matrix) return point;
  return point.applyMatrix4(matrix);
}
