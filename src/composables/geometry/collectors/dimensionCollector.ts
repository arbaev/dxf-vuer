import * as THREE from "three";
import type { DxfEntity, DxfData } from "@/types/dxf";
import { isDimensionEntity } from "@/types/dxf";
import { resolveEntityColor, rgbNumberToHex } from "@/utils/colorResolver";
import ACI_PALETTE from "@/parser/acadColorIndex";
import { DEGREES_TO_RADIANS_DIVISOR } from "@/constants";
import { type RenderContext, degreesToRadians } from "../primitives";
import type { GeometryCollector } from "../mergeCollectors";
import { resolveEntityFont } from "../fontClassifier";
import {
  extractDimensionData,
  createDimensionGroup,
  createOrdinateDimension,
  createRadialDimension,
  createDiametricDimension,
  createAngularDimension,
  resolveDimVarsFromHeader,
  applyDimStyleVars,
  mergeEntityDimVars,
  isTickBlock,
  type DimFormatOptions,
} from "../dimensions";
import {
  addDimensionTextToCollector,
  measureDimensionTextWidth,
} from "../vectorTextBuilder";

/**
 * Collect DIMENSION entity: geometry (lines/arrows) decomposed into collector,
 * text rendered as vector glyphs directly into collector.
 */
export function collectDimensionEntity(
  entity: DxfEntity,
  _dxf: DxfData,
  colorCtx: RenderContext,
  collector: GeometryCollector,
  layer: string,
  worldMatrix?: THREE.Matrix4,
): void {
  if (!isDimensionEntity(entity)) return;
  const font = resolveEntityFont(entity.styleName, colorCtx.styles, colorCtx.serifFont, colorCtx.font!);
  const entityColor = resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor);
  const baseDimType = (entity.dimensionType ?? 0) & 0x0f;
  // Extract Matrix4 elements for text vertex transform inside block INSERTs
  const transform = worldMatrix ? Array.from(worldMatrix.elements) : undefined;
  const matrix = worldMatrix ?? new THREE.Matrix4();

  // Resolve dimension variables: header -> DIMSTYLE -> entity XDATA overrides
  const dimStyleEntry = entity.styleName && colorCtx.dimStyles?.[entity.styleName];
  let baseDv = colorCtx.dimVars ?? resolveDimVarsFromHeader(undefined);
  // Apply DIMSTYLE-level overrides (DIMSCALE, DIMTXT, DIMASZ) between header and entity
  if (dimStyleEntry) {
    baseDv = applyDimStyleVars(baseDv, dimStyleEntry, _dxf.header);
  }
  const dv = mergeEntityDimVars(baseDv, entity);

  // Resolve DIMLUNIT: DIMSTYLE -> header -> undefined (defaults)
  const dimlunit = dimStyleEntry ? dimStyleEntry.dimlunit : colorCtx.headerDimlunit;
  const dimzin = dimStyleEntry ? dimStyleEntry.dimzin : undefined;
  const dimFmt: DimFormatOptions | undefined = dimlunit !== undefined ? { dimlunit, dimzin } : undefined;

  // DIMCLRT: dimension text color from DIMSTYLE (ACI index)
  let textColor = entityColor;
  if (dimStyleEntry && dimStyleEntry.dimclrt !== undefined && dimStyleEntry.dimclrt > 0 && dimStyleEntry.dimclrt <= 255) {
    textColor = rgbNumberToHex(ACI_PALETTE[dimStyleEntry.dimclrt]);
  }

  // DIMTSZ / DIMBLK from DIMSTYLE overrides header values
  if (dimStyleEntry) {
    // Use DIMSTYLE's own DIMSCALE for tick scaling
    const styleDimScale = dimStyleEntry.dimscale;
    const headerDimScale = _dxf.header?.$DIMSCALE ?? 1;
    const dimScale = (entity.dimScale ?? styleDimScale ?? headerDimScale) || 1;

    if (dimStyleEntry.dimtsz !== undefined && dimStyleEntry.dimtsz > 0) {
      dv.useTicks = true;
      dv.tickSize = dimStyleEntry.dimtsz * dimScale;
    } else if (dimStyleEntry.dimblkHandle && colorCtx.blockHandleToName) {
      const blockName = colorCtx.blockHandleToName.get(dimStyleEntry.dimblkHandle);
      if (blockName && isTickBlock(blockName)) {
        dv.useTicks = true;
        // No explicit DIMTSZ -> tick size always follows arrow size
        // (entity XDATA may override arrowSize after base tickSize was set)
        dv.tickSize = dv.arrowSize;
      } else {
        // DIMBLK is not a tick block → use standard arrows
        dv.useTicks = false;
        dv.tickSize = 0;
      }
    } else if (dv.useTicks && dimStyleEntry.dimtsz === 0) {
      // DIMSTYLE explicitly sets DIMTSZ=0 with no custom DIMBLK → default arrows
      // (overrides header $DIMBLK=ARCHTICK that may have set useTicks=true)
      dv.useTicks = false;
      dv.tickSize = 0;
    }
  }

  let result: THREE.Object3D[] | null = null;

  // Resolve sentinel for Three.js material creation in dimension helpers
  const resolvedColor = colorCtx.materials.resolveColor(entityColor);

  // Ordinate dimension (type 6 = Y-ordinate, type 7 = X-ordinate)
  const dimParams = { entity, color: resolvedColor, font, collector, layer, transform, dv };
  if ((baseDimType & 0x0e) === 6) {
    result = createOrdinateDimension(dimParams);
  } else if (baseDimType === 2) {
    result = createAngularDimension(dimParams);
  } else if (baseDimType === 3) {
    result = createDiametricDimension(dimParams);
  } else if (baseDimType === 4) {
    result = createRadialDimension(dimParams);
  } else {
    // Linear/aligned dimension
    const dimData = extractDimensionData(entity, dv, dimFmt);
    if (!dimData) return;

    let dimAngle = dimData.angle;
    if (baseDimType === 1 && dimAngle === 0) {
      const dx = dimData.point2.x - dimData.point1.x;
      const dy = dimData.point2.y - dimData.point1.y;
      dimAngle = (Math.atan2(dy, dx) * DEGREES_TO_RADIANS_DIVISOR) / Math.PI;
    }

    // Compute text gap from actual text width so dimension line doesn't overlap text
    if (dimData.textPos && dimData.dimensionText && font) {
      const textWidth = measureDimensionTextWidth(font, dimData.dimensionText, dimData.textHeight);
      const padding = dimData.textHeight * 0.5;
      dv.textGap = Math.max(dv.textGap, textWidth + padding);
    }

    const dimGroup = createDimensionGroup({
      point1: dimData.point1, point2: dimData.point2, anchorPoint: dimData.anchorPoint,
      textPos: dimData.textPos, textHeight: dimData.textHeight, isRadial: dimData.isRadial,
      color: resolvedColor, angle: dimAngle, forceRotated: baseDimType === 0, dv,
    });
    result = [dimGroup];

    if (dimData.textPos) {
      let dimAngleRad = dimAngle !== 0 ? degreesToRadians(dimAngle) : 0;
      // Readability: flip text to [-PI/2, PI/2] so it is never upside-down
      while (dimAngleRad > Math.PI / 2) dimAngleRad -= Math.PI;
      while (dimAngleRad < -Math.PI / 2) dimAngleRad += Math.PI;
      addDimensionTextToCollector({
        collector, layer, color: textColor, font,
        rawText: dimData.dimensionText, height: dimData.textHeight,
        posX: dimData.textPos.x, posY: dimData.textPos.y, posZ: 0.2,
        rotation: dimAngleRad, hAlign: "center", transform,
      });
    }
  }

  // Decompose geometry objects (lines, arrows) into collector.
  // Use entityColor (sentinel) for collector calls so theme-switching works.
  if (result) {
    for (const obj of result) {
      if (obj instanceof THREE.Group) {
        obj.updateMatrixWorld(true);
        obj.traverse((child) => {
          if (child === obj || child instanceof THREE.Group) return;
          const geo = (child as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
          if (!geo) return;
          const posAttr = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
          if (!posAttr) return;
          const v = new THREE.Vector3();

          if (child instanceof THREE.LineSegments || child instanceof THREE.Line) {
            const count = posAttr.count;
            for (let i = 0; i < count - 1; i += (child instanceof THREE.LineSegments ? 2 : 1)) {
              v.fromBufferAttribute(posAttr, i).applyMatrix4(child.matrixWorld).applyMatrix4(matrix);
              const x1 = v.x, y1 = v.y, z1 = v.z;
              v.fromBufferAttribute(posAttr, i + 1).applyMatrix4(child.matrixWorld).applyMatrix4(matrix);
              collector.addLineSegments(layer, entityColor, [x1, y1, z1, v.x, v.y, v.z]);
            }
          } else if (child instanceof THREE.Mesh) {
            const count = posAttr.count;
            const positions: number[] = [];
            for (let i = 0; i < count; i++) {
              v.fromBufferAttribute(posAttr, i).applyMatrix4(child.matrixWorld).applyMatrix4(matrix);
              positions.push(v.x, v.y, v.z);
            }
            const index = geo.getIndex();
            const indices = index ? Array.from(index.array) : [];
            if (indices.length === 0) {
              for (let i = 0; i < count; i++) indices.push(i);
            }
            collector.addOverlayMesh(layer, entityColor, positions, indices);
          }
        });
      } else {
        // Single object (Line, Mesh)
        const geo = (obj as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (!geo) continue;
        const posAttr = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
        if (!posAttr) continue;
        const v = new THREE.Vector3();

        if (obj instanceof THREE.LineSegments || obj instanceof THREE.Line) {
          const count = posAttr.count;
          for (let i = 0; i < count - 1; i += (obj instanceof THREE.LineSegments ? 2 : 1)) {
            v.fromBufferAttribute(posAttr, i).applyMatrix4(matrix);
            const x1 = v.x, y1 = v.y, z1 = v.z;
            v.fromBufferAttribute(posAttr, i + 1).applyMatrix4(matrix);
            collector.addLineSegments(layer, entityColor, [x1, y1, z1, v.x, v.y, v.z]);
          }
        } else if (obj instanceof THREE.Mesh) {
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
          collector.addOverlayMesh(layer, entityColor, positions, indices);
        }
      }
    }
  }
}
