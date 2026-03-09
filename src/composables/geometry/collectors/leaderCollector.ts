import * as THREE from "three";
import type { DxfEntity, DxfData } from "@/types/dxf";
import { isLeaderEntity, isMLeaderEntity } from "@/types/dxf";
import { resolveEntityColor } from "@/utils/colorResolver";
import { ARROW_SIZE } from "@/constants";
import {
  type RenderContext,
  createArrow,
  createTick,
  getLineMaterial,
  getMeshMaterial,
} from "../primitives";
import type { GeometryCollector } from "../mergeCollectors";
import { resolveEntityFont } from "../fontClassifier";
import { replaceSpecialChars } from "../text";
import {
  resolveDimVarsFromHeader,
  isTickBlock,
} from "../dimensions";
import {
  addTextToCollector,
  HAlign,
  VAlign,
} from "../vectorTextBuilder";

/**
 * Catmull-Rom spline interpolation through given points.
 * Returns a smooth polyline that passes through all input points.
 */
export const catmullRomSpline = (points: THREE.Vector3[], segmentsPerSpan = 12): THREE.Vector3[] => {
  if (points.length <= 2) return points;
  const result: THREE.Vector3[] = [];
  const n = points.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];
    for (let t = 0; t < segmentsPerSpan; t++) {
      const s = t / segmentsPerSpan;
      const s2 = s * s;
      const s3 = s2 * s;
      result.push(new THREE.Vector3(
        0.5 * (2 * p1.x + (-p0.x + p2.x) * s + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s3),
        0.5 * (2 * p1.y + (-p0.y + p2.y) * s + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s3),
        0.5 * (2 * p1.z + (-p0.z + p2.z) * s + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * s2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * s3),
      ));
    }
  }
  result.push(points[n - 1]);
  return result;
};

/**
 * Collect LEADER/MULTILEADER entity: lines and arrows decomposed into collector,
 * text rendered as vector glyphs directly into collector.
 */
export function collectLeaderEntity(
  entity: DxfEntity,
  _dxf: DxfData,
  colorCtx: RenderContext,
  collector: GeometryCollector,
  layer: string,
  worldMatrix?: THREE.Matrix4,
): void {
  const styleName = isLeaderEntity(entity) ? entity.styleName : undefined;
  const font = resolveEntityFont(styleName, colorCtx.styles, colorCtx.serifFont, colorCtx.font!);
  const entityColor = resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);
  const matrix = worldMatrix ?? new THREE.Matrix4();
  const v = new THREE.Vector3();

  const addLeaderLineToCollector = (points: THREE.Vector3[]) => {
    for (let i = 0; i < points.length - 1; i++) {
      v.copy(points[i]).applyMatrix4(matrix);
      const x1 = v.x, y1 = v.y, z1 = v.z;
      v.copy(points[i + 1]).applyMatrix4(matrix);
      collector.addLineSegments(layer, entityColor, [x1, y1, z1, v.x, v.y, v.z]);
    }
  };

  const addArrowToCollector = (from: THREE.Vector3, to: THREE.Vector3, size: number) => {
    const arrow = createArrow(from, to, size, getMeshMaterial(entityColor, colorCtx.materials.mesh));
    const geo = arrow.geometry as THREE.BufferGeometry;
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
    const count = posAttr.count;
    const positions: number[] = [];
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(matrix);
      positions.push(v.x, v.y, v.z);
    }
    const index = geo.getIndex();
    const indices = index ? Array.from(index.array) : [];
    if (indices.length === 0) {
      for (let i = 0; i < count; i++) indices.push(i);
    }
    collector.addMesh(layer, entityColor, positions, indices);
  };

  // Resolve arrow block for LEADER: DIMSTYLE code 341 (DIMLDRBLK) -> block name
  const leaderStyleName = isLeaderEntity(entity) ? entity.styleName : undefined;
  const leaderDimStyle = leaderStyleName ? colorCtx.dimStyles?.[leaderStyleName] : undefined;
  const baseDv = colorCtx.dimVars ?? resolveDimVarsFromHeader(undefined);

  // Resolve leader arrow block name from DIMLDRBLK (code 341) only.
  // Do NOT fall back to DIMBLK (code 342) — that's for dimension arrowheads.
  // When DIMLDRBLK is unset, leaders use the default filled arrow.
  let leaderArrowBlockName: string | undefined;
  if (colorCtx.blockHandleToName) {
    const ldrHandle = leaderDimStyle?.dimldrblkHandle;
    if (ldrHandle) leaderArrowBlockName = colorCtx.blockHandleToName.get(ldrHandle);
  }

  // Render a block definition at a point with rotation (for custom arrow blocks)
  const addBlockArrowToCollector = (
    blockName: string, tip: THREE.Vector3, angle: number, scale: number,
  ) => {
    const block = _dxf.blocks?.[blockName];
    if (!block?.entities) return false;
    const blockMatrix = new THREE.Matrix4()
      .makeTranslation(tip.x, tip.y, tip.z)
      .multiply(new THREE.Matrix4().makeRotationZ(angle))
      .multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
    if (worldMatrix) blockMatrix.premultiply(worldMatrix);
    for (const be of block.entities) {
      if (be.type === "LINE" && "vertices" in be) {
        const verts = be.vertices as { x: number; y: number; z?: number }[];
        if (verts.length >= 2) {
          v.set(verts[0].x, verts[0].y, verts[0].z || 0).applyMatrix4(blockMatrix);
          const x1 = v.x, y1 = v.y, z1 = v.z;
          v.set(verts[1].x, verts[1].y, verts[1].z || 0).applyMatrix4(blockMatrix);
          collector.addLineSegments(layer, entityColor, [x1, y1, z1, v.x, v.y, v.z]);
        }
      }
    }
    return true;
  };

  const addTickToCollector = (point: THREE.Vector3, dimAngle: number) => {
    const tick = createTick(point, baseDv.tickSize || baseDv.arrowSize, dimAngle,
      getLineMaterial(entityColor, colorCtx.materials.line));
    const geo = tick.geometry as THREE.BufferGeometry;
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
    const verts: number[] = [];
    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(matrix);
      verts.push(v.x, v.y, v.z);
    }
    collector.addLineSegments(layer, entityColor, verts);
  };

  if (entity.type === "LEADER" && isLeaderEntity(entity) && entity.vertices.length >= 2) {
    const rawPoints = entity.vertices.map(
      (vt) => new THREE.Vector3(vt.x, vt.y, vt.z || 0),
    );
    // Spline path (code 72 = 1): interpolate as Catmull-Rom curve
    const points = entity.pathType === 1 ? catmullRomSpline(rawPoints) : rawPoints;
    addLeaderLineToCollector(points);

    // arrowHeadFlag: 0 = no arrow, 1 or undefined = with arrow (DXF default)
    if (entity.arrowHeadFlag !== 0 && rawPoints.length >= 2) {
      // Arrow direction from spline tangent at tip (first two interpolated points)
      const dx = points[0].x - points[1].x;
      const dy = points[0].y - points[1].y;
      const angle = Math.atan2(dy, dx);
      let drawn = false;
      // Try custom arrow block from DIMLDRBLK
      if (leaderArrowBlockName && !isTickBlock(leaderArrowBlockName)) {
        drawn = addBlockArrowToCollector(leaderArrowBlockName, points[0], angle, baseDv.arrowSize);
      }
      if (!drawn) {
        // Leaders use ticks only if DIMLDRBLK explicitly specifies a tick block.
        // Do NOT inherit useTicks from baseDv — that's for dimension arrowheads.
        if (leaderArrowBlockName && isTickBlock(leaderArrowBlockName)) {
          addTickToCollector(points[0], angle);
        } else {
          addArrowToCollector(points[1], points[0], baseDv.arrowSize);
        }
      }
    }
  } else if ((entity.type === "MULTILEADER" || entity.type === "MLEADER") && isMLeaderEntity(entity) && entity.leaders.length > 0) {
    const arrowSize = entity.arrowSize || ARROW_SIZE;

    for (const leader of entity.leaders) {
      for (const line of leader.lines) {
        if (line.vertices.length < 2) continue;
        const points = line.vertices.map(
          (vt) => new THREE.Vector3(vt.x, vt.y, vt.z || 0),
        );
        if (leader.lastLeaderPoint) {
          points.push(new THREE.Vector3(
            leader.lastLeaderPoint.x,
            leader.lastLeaderPoint.y,
            leader.lastLeaderPoint.z || 0,
          ));
        }
        addLeaderLineToCollector(points);

        if (entity.hasArrowHead !== false && points.length >= 2) {
          addArrowToCollector(points[1], points[0], arrowSize);
        }
      }
    }

    if (entity.text && entity.textPosition) {
      const textHeight = entity.textHeight || colorCtx.defaultTextHeight;
      const textContent = replaceSpecialChars(entity.text);
      if (textContent) {
        let posX = entity.textPosition.x;
        let posY = entity.textPosition.y;
        if (worldMatrix) {
          v.set(posX, posY, 0).applyMatrix4(worldMatrix);
          posX = v.x;
          posY = v.y;
        }
        addTextToCollector({
          collector, layer, color: entityColor, font, text: textContent, height: textHeight,
          posX, posY, posZ: 0, hAlign: HAlign.LEFT, vAlign: VAlign.MIDDLE,
        });
      }
    }
  }
}
