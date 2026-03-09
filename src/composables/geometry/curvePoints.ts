import * as THREE from "three";
import { CIRCLE_SEGMENTS, EPSILON, MIN_ARC_SEGMENTS } from "@/constants";

/**
 * Generate points for a full circle.
 * Returns an array of Vector3 points forming a closed polyline (first and last points
 * are at the same position).
 */
export function generateCirclePoints(
  centerX: number,
  centerY: number,
  centerZ: number,
  radius: number,
  segments?: number,
): THREE.Vector3[] {
  const segs = segments ?? CIRCLE_SEGMENTS;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= segs; i++) {
    const angle = (i / segs) * Math.PI * 2;
    points.push(
      new THREE.Vector3(
        centerX + radius * Math.cos(angle),
        centerY + radius * Math.sin(angle),
        centerZ,
      ),
    );
  }
  return points;
}

/**
 * Generate points for an arc (always counter-clockwise).
 * If endAngle <= startAngle, wraps through 2*PI.
 * Returns an array of Vector3 points along the arc.
 */
export function generateArcPoints(
  centerX: number,
  centerY: number,
  centerZ: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): THREE.Vector3[] {
  let adjustedEnd = endAngle;
  if (adjustedEnd <= startAngle) {
    adjustedEnd += Math.PI * 2;
  }
  const sweepAngle = adjustedEnd - startAngle;
  const segments = Math.max(
    MIN_ARC_SEGMENTS,
    Math.floor((sweepAngle * CIRCLE_SEGMENTS) / (2 * Math.PI)),
  );
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + (i / segments) * sweepAngle;
    points.push(
      new THREE.Vector3(
        centerX + radius * Math.cos(angle),
        centerY + radius * Math.sin(angle),
        centerZ,
      ),
    );
  }
  return points;
}

/**
 * Generate points for an ellipse or elliptical arc.
 *
 * @param centerX - Ellipse center X
 * @param centerY - Ellipse center Y
 * @param centerZ - Ellipse center Z
 * @param majorX - Major axis endpoint X (relative to center)
 * @param majorY - Major axis endpoint Y (relative to center)
 * @param axisRatio - Minor/major axis ratio
 * @param startAngle - Start angle in radians (eccentric anomaly)
 * @param endAngle - End angle in radians (eccentric anomaly)
 * @param ccw - Direction: true=CCW (default, DXF ELLIPSE entity), false=CW (hatch edges)
 * @param segmentOverride - Override segment count (0 = auto-calculate)
 * @returns Array of Vector3 points, or empty array if major axis is degenerate
 */
export function generateEllipsePoints(
  centerX: number,
  centerY: number,
  centerZ: number,
  majorX: number,
  majorY: number,
  axisRatio: number,
  startAngle: number,
  endAngle: number,
  ccw = true,
  segmentOverride = 0,
): THREE.Vector3[] {
  const majorLength = Math.sqrt(majorX * majorX + majorY * majorY);
  if (majorLength < EPSILON) return [];
  const minorLength = majorLength * axisRatio;
  const rotation = Math.atan2(majorY, majorX);

  const isFullEllipse =
    Math.abs(endAngle - startAngle - 2 * Math.PI) < EPSILON ||
    Math.abs(endAngle - startAngle) < EPSILON;

  let effStart = startAngle;
  let effEnd = endAngle;
  if (isFullEllipse) {
    effStart = 0;
    effEnd = 2 * Math.PI;
  }

  let sweepAngle = effEnd - effStart;
  if (ccw) {
    if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
  } else {
    if (sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  }

  const segments =
    segmentOverride > 0
      ? segmentOverride
      : Math.max(
          MIN_ARC_SEGMENTS,
          Math.floor((Math.abs(sweepAngle) * CIRCLE_SEGMENTS) / (2 * Math.PI)),
        );

  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = effStart + (i / segments) * sweepAngle;
    const localX = majorLength * Math.cos(t);
    const localY = minorLength * Math.sin(t);
    const worldX = centerX + localX * cosR - localY * sinR;
    const worldY = centerY + localX * sinR + localY * cosR;
    points.push(new THREE.Vector3(worldX, worldY, centerZ));
  }
  return points;
}
