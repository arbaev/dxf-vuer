import * as THREE from "three";
import type { DxfLayer, DxfLineType } from "@/types/dxf";
import { applyLinetypePattern, type PatternGeometry } from "@/utils/linetypeResolver";
import {
  EPSILON,
  CIRCLE_SEGMENTS,
  MIN_ARC_SEGMENTS,
  ARROW_BASE_WIDTH_DIVISOR,
  DEGREES_TO_RADIANS_DIVISOR,
  POINT_MARKER_SIZE,
  LINETYPE_DOT_SIZE,
} from "@/constants";

export interface EntityColorContext {
  layers: Record<string, DxfLayer>;
  blockColor?: string; // INSERT entity color for ByBlock inheritance
  materialCache: Map<string, THREE.LineBasicMaterial>;
  meshMaterialCache: Map<string, THREE.MeshBasicMaterial>;
  pointsMaterialCache: Map<string, THREE.PointsMaterial>;
  lineTypes: Record<string, DxfLineType>;
  globalLtScale: number;
  blockLineType?: string;
}

export const degreesToRadians = (degrees: number): number =>
  (degrees * Math.PI) / DEGREES_TO_RADIANS_DIVISOR;

export const getLineMaterial = (
  color: string,
  cache: Map<string, THREE.LineBasicMaterial>,
): THREE.LineBasicMaterial => {
  let mat = cache.get(color);
  if (!mat) {
    mat = new THREE.LineBasicMaterial({ color });
    cache.set(color, mat);
  }
  return mat;
};

export const getMeshMaterial = (
  color: string,
  cache: Map<string, THREE.MeshBasicMaterial>,
): THREE.MeshBasicMaterial => {
  let mat = cache.get(color);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    cache.set(color, mat);
  }
  return mat;
};

export const getPointsMaterial = (
  color: string,
  cache: Map<string, THREE.PointsMaterial>,
): THREE.PointsMaterial => {
  let mat = cache.get(color);
  if (!mat) {
    mat = new THREE.PointsMaterial({
      color,
      size: POINT_MARKER_SIZE,
      sizeAttenuation: false,
    });
    cache.set(color, mat);
  }
  return mat;
};

/**
 * Create a line from points. When a linetype pattern is provided,
 * the polyline is split into dash/gap segments (LineSegments) and
 * dot positions (Points). Without a pattern, a regular continuous Line is returned.
 */
export const createLine = (
  points: THREE.Vector3[],
  material: THREE.LineBasicMaterial,
  pattern?: number[],
): THREE.Object3D => {
  if (pattern && pattern.length > 0) {
    const pg: PatternGeometry = applyLinetypePattern(points, pattern);
    const hasSegments = pg.segments.length >= 6;
    const hasDots = pg.dots.length >= 3;

    if (hasSegments || hasDots) {
      // If only segments (no dots), return LineSegments directly
      if (hasSegments && !hasDots) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(pg.segments, 3));
        return new THREE.LineSegments(geometry, material);
      }

      // If dots present, group segments + points together
      const group = new THREE.Group();

      if (hasSegments) {
        const segGeo = new THREE.BufferGeometry();
        segGeo.setAttribute("position", new THREE.Float32BufferAttribute(pg.segments, 3));
        group.add(new THREE.LineSegments(segGeo, material));
      }

      if (hasDots) {
        const dotGeo = new THREE.BufferGeometry();
        dotGeo.setAttribute("position", new THREE.Float32BufferAttribute(pg.dots, 3));
        const dotMat = new THREE.PointsMaterial({
          color: material.color,
          size: LINETYPE_DOT_SIZE,
          sizeAttenuation: false,
        });
        group.add(new THREE.Points(dotGeo, dotMat));
      }

      return group;
    }
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geometry, material);
};

/**
 * Create an arc from two points with a bulge coefficient.
 * bulge = tan(angle/4), where angle is the central arc angle.
 */
export const createBulgeArc = (
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  bulge: number,
): THREE.Vector3[] => {
  if (Math.abs(bulge) < EPSILON) {
    return [p1, p2];
  }

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const chordLength = Math.sqrt(dx * dx + dy * dy);

  if (chordLength < EPSILON) {
    return [p1, p2];
  }

  // Central angle: bulge = tan(theta/4) => theta = 4 * atan(bulge)
  const theta = 4 * Math.atan(bulge);

  // Radius: r = chordLength / (2 * sin(theta/2))
  const radius = chordLength / (2 * Math.sin(theta / 2));

  // Distance from chord midpoint to circle center (signed).
  // Sign is automatically correct since theta and radius carry the bulge sign.
  const h = radius * Math.cos(theta / 2);

  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;

  const chordDirX = dx / chordLength;
  const chordDirY = dy / chordLength;

  // Perpendicular to chord (rotated 90 degrees CCW)
  const perpX = -chordDirY;
  const perpY = chordDirX;

  // Center offset: for bulge > 0 and theta < pi, center is to the right of chord;
  // for theta > pi, center flips to the left (and vice versa for negative bulge)
  const centerX = midX + perpX * h;
  const centerY = midY + perpY * h;

  const startAngle = Math.atan2(p1.y - centerY, p1.x - centerX);
  const endAngle = Math.atan2(p2.y - centerY, p2.x - centerX);

  let sweepAngle = endAngle - startAngle;

  // Normalize to [-pi, pi]
  while (sweepAngle > Math.PI) sweepAngle -= 2 * Math.PI;
  while (sweepAngle < -Math.PI) sweepAngle += 2 * Math.PI;

  // Adjust direction based on bulge sign
  if (bulge > 0 && sweepAngle < 0) {
    sweepAngle += 2 * Math.PI;
  } else if (bulge < 0 && sweepAngle > 0) {
    sweepAngle -= 2 * Math.PI;
  }

  const segments = Math.max(
    MIN_ARC_SEGMENTS,
    Math.floor((Math.abs(sweepAngle) * CIRCLE_SEGMENTS) / (2 * Math.PI)),
  );

  const points: THREE.Vector3[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const currentAngle = startAngle + sweepAngle * t;
    const x = centerX + Math.abs(radius) * Math.cos(currentAngle);
    const y = centerY + Math.abs(radius) * Math.sin(currentAngle);
    points.push(new THREE.Vector3(x, y, 0));
  }

  return points;
};

/**
 * Create an arrow (triangle) for dimension lines.
 * Direction is computed as normalized vector from `from` to `tip`.
 */
export const createArrow = (
  from: THREE.Vector3,
  tip: THREE.Vector3,
  size: number,
  material: THREE.Material,
): THREE.Mesh => {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const dirX = len > EPSILON ? dx / len : 1;
  const dirY = len > EPSILON ? dy / len : 0;

  const width = size / ARROW_BASE_WIDTH_DIVISOR;

  const perpX = dirY;
  const perpY = -dirX;

  const base1 = new THREE.Vector3(
    tip.x - dirX * size + perpX * width,
    tip.y - dirY * size + perpY * width,
    tip.z,
  );

  const base2 = new THREE.Vector3(
    tip.x - dirX * size - perpX * width,
    tip.y - dirY * size - perpY * width,
    tip.z,
  );

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [tip.x, tip.y, tip.z, base1.x, base1.y, base1.z, base2.x, base2.y, base2.z],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2]);

  return new THREE.Mesh(geometry, material);
};

export const setLayerName = (obj: THREE.Object3D | THREE.Object3D[], layerName: string) => {
  if (Array.isArray(obj)) {
    obj.forEach((o) => {
      o.userData.layerName = layerName;
    });
  } else {
    obj.userData.layerName = layerName;
  }
};
