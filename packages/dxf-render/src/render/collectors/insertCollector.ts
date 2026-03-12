import * as THREE from "three";
import type { DxfEntity, DxfData, DxfAttribEntity } from "@/types/dxf";
import { isInsertEntity, isTextEntity, isDimensionEntity } from "@/types/dxf";
import { resolveEntityColor } from "@/utils/colorResolver";
import { buildOcsMatrix, transformOcsPoint } from "@/utils/ocsTransform";
import { getInsUnitsScale } from "@/utils/insUnitsScale";
import { type RenderContext, degreesToRadians } from "../primitives";
import type { GeometryCollector } from "../mergeCollectors";
import {
  type BlockTemplate,
  type CollectEntityParams,
  type SharedBlockGeo,
  instantiateBlockTemplate,
  addSharedBlockInstance,
} from "../blockTemplateCache";
import { resolveEntityFont } from "../text/fontClassifier";
import { replaceSpecialChars } from "../text/mtextParser";
import {
  addTextToCollector,
  HAlign,
  VAlign,
} from "../text/vectorTextBuilder";
import { collectTextOrMText } from "./textCollector";
import { collectDimensionEntity } from "./dimensionCollector";
import { collectLeaderEntity } from "./leaderCollector";

// ─── Constants ────────────────────────────────────────────────────────

export const MAX_RECURSION_DEPTH = 10;

/** Time budget per chunk before yielding (ms) */
const CHUNK_TIME_MS = 16;

/** Yield control to the browser so the UI stays responsive */
const yieldToMain = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Entity types that are collected (merged) rather than processed individually */
const COLLECTABLE_TYPES = new Set([
  "LINE", "CIRCLE", "ARC", "ELLIPSE",
  "LWPOLYLINE", "POLYLINE", "SPLINE",
  "POINT", "SOLID", "3DFACE", "HATCH",
  "MLINE", "XLINE", "RAY",
]);

// ─── Types ────────────────────────────────────────────────────────────

/** Shared state for cooperative yielding across async processing */
export interface YieldState {
  lastYield: number;
  signal?: AbortSignal;
}

/** Callback type for the legacy processEntity fallback */
export type ProcessEntityFn = (
  entity: DxfEntity,
  dxf: DxfData,
  colorCtx: RenderContext,
  depth: number,
) => THREE.Object3D | THREE.Object3D[] | null;

/** Callback type for the collectEntity dispatch function */
export type CollectEntityFn = (p: CollectEntityParams) => boolean;

// ─── ATTRIB rendering (shared by template and slow paths) ─────────────

/**
 * Shared ATTRIB rendering logic used in both the template fast path
 * and the slow path of INSERT processing.
 */
function renderAttribs(
  attribs: DxfAttribEntity[],
  colorCtx: RenderContext,
  collector: GeometryCollector,
  insertLayer: string,
): void {
  for (const attrib of attribs) {
    if (attrib.invisible) continue;
    const text = attrib.text;
    if (!text) continue;

    const attribColor = resolveEntityColor(attrib, colorCtx.layers, colorCtx.blockColor);
    const textHeight = attrib.textHeight || colorCtx.defaultTextHeight;

    const hasJustification =
      (attrib.horizontalJustification && attrib.horizontalJustification > 0) ||
      (attrib.verticalJustification && attrib.verticalJustification > 0);
    const posCoord = hasJustification && attrib.endPoint
      ? attrib.endPoint
      : attrib.startPoint;
    if (!posCoord) continue;

    const attribMatrix = buildOcsMatrix(attrib.extrusionDirection);
    const attribPos = transformOcsPoint(
      new THREE.Vector3(posCoord.x, posCoord.y, 0),
      attribMatrix,
    );

    const rotation = attrib.rotation ? degreesToRadians(attrib.rotation) : 0;
    const attribFont = resolveEntityFont(attrib.textStyle, colorCtx.styles, colorCtx.serifFont, colorCtx.font!);
    addTextToCollector({
      collector, layer: insertLayer, color: attribColor, font: attribFont,
      text: replaceSpecialChars(text), height: textHeight,
      posX: attribPos.x, posY: attribPos.y, posZ: attribPos.z, rotation,
      hAlign: attrib.horizontalJustification ?? HAlign.LEFT,
      vAlign: attrib.verticalJustification ?? VAlign.BASELINE,
      widthFactor: attrib.scale,
      obliqueAngle: attrib.obliqueAngle,
    });
  }
}

// ─── Fallback entity processing helper ────────────────────────────────

/**
 * Add processEntity result objects to fallbackGroup with worldMatrix and layer applied.
 */
function addFallbackObjects(
  obj: THREE.Object3D | THREE.Object3D[] | null,
  worldMatrix: THREE.Matrix4,
  entityLayer: string,
  fallbackGroup: THREE.Group,
): void {
  if (!obj) return;
  if (Array.isArray(obj)) {
    for (const o of obj) {
      o.applyMatrix4(worldMatrix);
      o.userData.layerName = entityLayer;
      fallbackGroup.add(o);
    }
  } else {
    obj.applyMatrix4(worldMatrix);
    obj.userData.layerName = entityLayer;
    fallbackGroup.add(obj);
  }
}

// ─── Main INSERT collector ────────────────────────────────────────────

/**
 * Collect INSERT block entities into the GeometryCollector.
 * Simple entities are merged; complex ones (TEXT, DIMENSION, LEADER)
 * are created as individual objects and added to fallbackGroup.
 */
export async function collectInsertEntity(
  insertEntity: DxfEntity,
  dxf: DxfData,
  colorCtx: RenderContext,
  collector: GeometryCollector,
  insertLayer: string,
  parentMatrix: THREE.Matrix4 | null,
  fallbackGroup: THREE.Group,
  depth: number,
  yieldState: YieldState,
  blockTemplates: Map<string, BlockTemplate> | undefined,
  sharedBlockGeos: Map<string, SharedBlockGeo> | undefined,
  collectEntityFn: CollectEntityFn,
  processEntityFn?: ProcessEntityFn,
): Promise<void> {
  if (depth > MAX_RECURSION_DEPTH || !isInsertEntity(insertEntity)) return;
  if (!dxf.blocks || typeof dxf.blocks !== "object") return;

  const block = dxf.blocks[insertEntity.name];
  if (!block?.entities?.length) return;

  // Array INSERT: columnCount x rowCount grid of block instances
  const cols = insertEntity.columnCount ?? 1;
  const rows = insertEntity.rowCount ?? 1;
  const colSpacing = insertEntity.columnSpacing ?? 0;
  const rowSpacing = insertEntity.rowSpacing ?? 0;

  // Block color context for ByBlock inheritance (shared across all array instances)
  const insertColor = resolveEntityColor(insertEntity, colorCtx.layers, colorCtx.blockColor);
  const blockColorCtx: RenderContext = {
    ...colorCtx,
    blockColor: insertColor,
    blockLineType: insertEntity.lineType || colorCtx.blockLineType,
  };

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {

  // Compute INSERT transform matrix: position + rotation + scale + array offset
  const pos = insertEntity.position;

  // Auto-scale blocks by $INSUNITS vs BLOCK_RECORD units
  const drawingUnits = dxf.header?.$INSUNITS ?? 0;
  const blockRecord = dxf.tables?.blockRecord;
  const blockUnits = (blockRecord as { blockRecords?: Record<string, { units: number }> })?.blockRecords?.[insertEntity.name]?.units ?? 0;
  const unitScale = getInsUnitsScale(drawingUnits, blockUnits);

  const insertMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(
      pos.x + col * colSpacing,
      pos.y + row * rowSpacing,
      pos.z || 0,
    ),
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      insertEntity.rotation ? degreesToRadians(insertEntity.rotation) : 0,
    ),
    new THREE.Vector3(
      (insertEntity.xScale || 1) * unitScale,
      (insertEntity.yScale || 1) * unitScale,
      (insertEntity.zScale || 1) * unitScale,
    ),
  );

  // Apply OCS transform
  const ocsMatrix = buildOcsMatrix(insertEntity.extrusionDirection);
  if (ocsMatrix) insertMatrix.premultiply(ocsMatrix);

  // Compose with parent matrix (for nested blocks)
  const worldMatrix = parentMatrix
    ? new THREE.Matrix4().multiplyMatrices(parentMatrix, insertMatrix)
    : insertMatrix;

  // Fast path: use cached template if available
  const template = blockTemplates?.get(insertEntity.name);
  if (template) {
    // Shared geometry path: GPU stores block geometry once, each INSERT is just a matrix
    const shared = sharedBlockGeos?.get(insertEntity.name);
    if (shared) {
      addSharedBlockInstance(shared, fallbackGroup, insertLayer, insertColor, worldMatrix, colorCtx, colorCtx.originOffset);
    } else {
      // Flat copy fallback (should not normally happen)
      instantiateBlockTemplate(template, collector, insertLayer, insertColor, worldMatrix);
    }

    // Process fallback entities individually (TEXT, nested INSERT, etc.)
    for (const idx of template.fallbackEntityIndices) {
      const entity = block.entities[idx];
      if (entity.visible === false) continue;
      try {
        const entityLayer = (!entity.layer || entity.layer === "0") ? insertLayer : entity.layer;

        // Nested INSERT: recurse (with blockTemplates for nested fast path)
        if (entity.type === "INSERT" && isInsertEntity(entity)) {
          await collectInsertEntity(entity, dxf, blockColorCtx, collector, entityLayer, worldMatrix, fallbackGroup, depth + 1, yieldState, blockTemplates, sharedBlockGeos, collectEntityFn, processEntityFn);
          continue;
        }

        // Try simple collection
        if (COLLECTABLE_TYPES.has(entity.type)) {
          if (collectEntityFn({ entity, colorCtx: blockColorCtx, collector, layer: entityLayer, worldMatrix })) {
            continue;
          }
        }

        // Vector text intercepts for block entities
        if ((entity.type === "TEXT" || entity.type === "MTEXT") && isTextEntity(entity)) {
          collectTextOrMText(entity, blockColorCtx, collector, entityLayer, worldMatrix);
          continue;
        }
        if (entity.type === "DIMENSION" && isDimensionEntity(entity)) {
          collectDimensionEntity(entity, dxf, blockColorCtx, collector, entityLayer, worldMatrix);
          continue;
        }
        if (entity.type === "LEADER" || entity.type === "MULTILEADER" || entity.type === "MLEADER") {
          collectLeaderEntity(entity, dxf, blockColorCtx, collector, entityLayer, worldMatrix);
          continue;
        }

        // Complex entities -- fallback to individual Three.js objects
        if (processEntityFn) {
          const obj = processEntityFn(entity, dxf, blockColorCtx, depth + 1);
          addFallbackObjects(obj, worldMatrix, entityLayer, fallbackGroup);
        }
      } catch (error) {
        console.warn(`Error processing fallback entity in block "${insertEntity.name}":`, error);
      }
    }

    // Handle ATTRIBs for template path (only for first array instance)
    if (row === 0 && col === 0 && insertEntity.attribs && insertEntity.attribs.length > 0) {
      renderAttribs(insertEntity.attribs, colorCtx, collector, insertLayer);
    }

    continue;
  }

  // Slow path: process every entity individually
  for (const entity of block.entities) {
    if (entity.visible === false) continue;
    try {
      // Layer "0" inside block inherits INSERT's layer
      const entityLayer = (!entity.layer || entity.layer === "0") ? insertLayer : entity.layer;

      // Nested INSERT: recurse (with blockTemplates for nested fast path)
      if (entity.type === "INSERT" && isInsertEntity(entity)) {
        await collectInsertEntity(entity, dxf, blockColorCtx, collector, entityLayer, worldMatrix, fallbackGroup, depth + 1, yieldState, blockTemplates, sharedBlockGeos, collectEntityFn, processEntityFn);
        continue;
      }

      // Try to collect simple geometry with world matrix
      if (COLLECTABLE_TYPES.has(entity.type)) {
        if (collectEntityFn({ entity, colorCtx: blockColorCtx, collector, layer: entityLayer, worldMatrix })) {
          continue;
        }
      }

      // Vector text intercepts for block entities
      if ((entity.type === "TEXT" || entity.type === "MTEXT") && isTextEntity(entity)) {
        collectTextOrMText(entity, blockColorCtx, collector, entityLayer, worldMatrix);
        continue;
      }
      if (entity.type === "DIMENSION" && isDimensionEntity(entity)) {
        collectDimensionEntity(entity, dxf, blockColorCtx, collector, entityLayer, worldMatrix);
        continue;
      }
      if (entity.type === "LEADER" || entity.type === "MULTILEADER" || entity.type === "MLEADER") {
        collectLeaderEntity(entity, dxf, blockColorCtx, collector, entityLayer, worldMatrix);
        continue;
      }

      if (processEntityFn) {
        const obj = processEntityFn(entity, dxf, blockColorCtx, depth + 1);
        addFallbackObjects(obj, worldMatrix, entityLayer, fallbackGroup);
      }
    } catch (error) {
      console.warn(`Error processing entity in block "${insertEntity.name}":`, error);
    }

    // Yield to browser to keep UI responsive during large blocks
    if (performance.now() - yieldState.lastYield > CHUNK_TIME_MS) {
      if (yieldState.signal?.aborted) return;
      await yieldToMain();
      yieldState.lastYield = performance.now();
    }
  }

  // Handle ATTRIB entities (only for first array instance)
  if (row === 0 && col === 0 && insertEntity.attribs && insertEntity.attribs.length > 0) {
    renderAttribs(insertEntity.attribs, colorCtx, collector, insertLayer);
  }

  } // for col
  } // for row
}
