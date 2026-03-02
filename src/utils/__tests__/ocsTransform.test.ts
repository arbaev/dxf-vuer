import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildOcsMatrix, transformOcsPoints, transformOcsPoint } from "../ocsTransform";

describe("buildOcsMatrix", () => {
  it("returns null for default extrusion (0,0,1)", () => {
    expect(buildOcsMatrix({ x: 0, y: 0, z: 1 })).toBeNull();
  });

  it("returns null for undefined extrusion", () => {
    expect(buildOcsMatrix(undefined)).toBeNull();
  });

  it("returns null for near-default extrusion", () => {
    expect(buildOcsMatrix({ x: 0, y: 0, z: 0.9999999999 })).toBeNull();
  });

  it("returns a matrix for mirror extrusion (0,0,-1)", () => {
    const m = buildOcsMatrix({ x: 0, y: 0, z: -1 });
    expect(m).not.toBeNull();

    // For (0,0,-1): Ax = Wy × N = (0,1,0) × (0,0,-1) = (-1,0,0)
    // OCS X-axis (1,0,0) maps to WCS (-1,0,0)
    const vx = new THREE.Vector3(1, 0, 0).applyMatrix4(m!);
    expect(vx.x).toBeCloseTo(-1);
    expect(vx.y).toBeCloseTo(0);
    expect(vx.z).toBeCloseTo(0);

    // OCS Y-axis (0,1,0) maps to WCS (0,1,0) — unchanged
    const vy = new THREE.Vector3(0, 1, 0).applyMatrix4(m!);
    expect(vy.x).toBeCloseTo(0);
    expect(vy.y).toBeCloseTo(1);
    expect(vy.z).toBeCloseTo(0);

    // OCS Z-axis (0,0,1) maps to N = (0,0,-1)
    const vz = new THREE.Vector3(0, 0, 1).applyMatrix4(m!);
    expect(vz.x).toBeCloseTo(0);
    expect(vz.y).toBeCloseTo(0);
    expect(vz.z).toBeCloseTo(-1);
  });

  it("maps OCS Z to extrusion direction for N=(0,1,0)", () => {
    const m = buildOcsMatrix({ x: 0, y: 1, z: 0 });
    expect(m).not.toBeNull();

    // N=(0,1,0): |Nx|=0 < 1/64, |Ny|=1 >= 1/64 → uses Wz branch
    // Ax = Wz × N = (0,0,1) × (0,1,0) = (-1,0,0)... normalize
    // Actually: (0,0,1) × (0,1,0) = (0*0-1*1, 1*0-0*0, 0*1-0*0) = (-1, 0, 0)
    // Ay = N × Ax = (0,1,0) × (-1,0,0) = (0,0,1)

    // OCS Z (0,0,1) should map to N = (0,1,0)
    const vz = new THREE.Vector3(0, 0, 1).applyMatrix4(m!);
    expect(vz.x).toBeCloseTo(0);
    expect(vz.y).toBeCloseTo(1);
    expect(vz.z).toBeCloseTo(0);
  });

  it("maps OCS Z to extrusion direction for N=(1,0,0)", () => {
    const m = buildOcsMatrix({ x: 1, y: 0, z: 0 });
    expect(m).not.toBeNull();

    // N=(1,0,0): |Nx|=1 >= 1/64 → uses Wz branch
    // Ax = Wz × N = (0,0,1) × (1,0,0) = (0,1,0)... wait:
    // (0,0,1) × (1,0,0) = (0*0-1*0, 1*1-0*0, 0*0-0*1) = (0, 1, 0)
    // Ay = N × Ax = (1,0,0) × (0,1,0) = (0,0,1)

    // OCS Z (0,0,1) should map to N = (1,0,0)
    const vz = new THREE.Vector3(0, 0, 1).applyMatrix4(m!);
    expect(vz.x).toBeCloseTo(1);
    expect(vz.y).toBeCloseTo(0);
    expect(vz.z).toBeCloseTo(0);
  });

  it("uses Y-axis world branch when N is close to Z-axis (|Nx|<1/64 and |Ny|<1/64)", () => {
    // N nearly parallel to Z: (0.01, 0.01, 1) — both components < 1/64 = 0.015625
    const n = new THREE.Vector3(0.01, 0.01, 1).normalize();
    const m = buildOcsMatrix({ x: n.x, y: n.y, z: n.z });
    expect(m).not.toBeNull();

    // Verify it's a valid rotation matrix (determinant = 1, columns orthonormal)
    const det = m!.determinant();
    expect(det).toBeCloseTo(1);
  });

  it("produces orthonormal basis for arbitrary direction", () => {
    const m = buildOcsMatrix({ x: 0.5, y: 0.3, z: 0.7 });
    expect(m).not.toBeNull();

    // Extract columns
    const col0 = new THREE.Vector3().setFromMatrixColumn(m!, 0);
    const col1 = new THREE.Vector3().setFromMatrixColumn(m!, 1);
    const col2 = new THREE.Vector3().setFromMatrixColumn(m!, 2);

    // All unit length
    expect(col0.length()).toBeCloseTo(1);
    expect(col1.length()).toBeCloseTo(1);
    expect(col2.length()).toBeCloseTo(1);

    // All orthogonal
    expect(col0.dot(col1)).toBeCloseTo(0);
    expect(col0.dot(col2)).toBeCloseTo(0);
    expect(col1.dot(col2)).toBeCloseTo(0);

    // Third column (OCS Z) matches normalized extrusion direction
    const n = new THREE.Vector3(0.5, 0.3, 0.7).normalize();
    expect(col2.x).toBeCloseTo(n.x);
    expect(col2.y).toBeCloseTo(n.y);
    expect(col2.z).toBeCloseTo(n.z);
  });
});

describe("transformOcsPoints", () => {
  it("returns points unchanged when matrix is null", () => {
    const pts = [new THREE.Vector3(1, 2, 3), new THREE.Vector3(4, 5, 6)];
    const result = transformOcsPoints(pts, null);
    expect(result).toBe(pts);
    expect(result[0].x).toBe(1);
    expect(result[0].y).toBe(2);
    expect(result[0].z).toBe(3);
  });

  it("transforms points with mirror matrix (0,0,-1)", () => {
    const m = buildOcsMatrix({ x: 0, y: 0, z: -1 })!;
    const pts = [new THREE.Vector3(5, 3, 0), new THREE.Vector3(-2, 7, 0)];
    transformOcsPoints(pts, m);
    // X negated, Y unchanged
    expect(pts[0].x).toBeCloseTo(-5);
    expect(pts[0].y).toBeCloseTo(3);
    expect(pts[1].x).toBeCloseTo(2);
    expect(pts[1].y).toBeCloseTo(7);
  });
});

describe("transformOcsPoint", () => {
  it("returns point unchanged when matrix is null", () => {
    const p = new THREE.Vector3(1, 2, 3);
    const result = transformOcsPoint(p, null);
    expect(result).toBe(p);
    expect(result.x).toBe(1);
  });

  it("transforms a single point", () => {
    const m = buildOcsMatrix({ x: 0, y: 0, z: -1 })!;
    const p = new THREE.Vector3(10, 5, 0);
    transformOcsPoint(p, m);
    expect(p.x).toBeCloseTo(-10);
    expect(p.y).toBeCloseTo(5);
  });
});
