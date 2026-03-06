import * as THREE from "three";
import type { DxfEntity } from "@/types/dxf";
import { resolveEntityColor } from "@/utils/colorResolver";
import { GeometryCollector } from "./mergeCollectors";
import type { EntityColorContext } from "./primitives";

// ─── Interfaces ──────────────────────────────────────────────────────

/** Params for the collectEntity callback passed to buildBlockTemplate */
export interface CollectEntityParams {
  entity: DxfEntity;
  colorCtx: EntityColorContext;
  collector: GeometryCollector;
  layer: string;
  worldMatrix?: THREE.Matrix4;
  overrideColor?: string;
}

export interface BlockTemplateGeometry {
  lineSegments: number[];  // flat [x,y,z, x,y,z, ...]
  points: number[];
  linetypeDots: number[];
  meshVertices: number[];
  meshIndices: number[];
}

export interface BlockTemplate {
  name: string;
  /** Geometry by key "layer::color". Layer may be INHERIT_LAYER sentinel. */
  buckets: Map<string, BlockTemplateGeometry>;
  /** Indices of entities that can't be cached (TEXT, INSERT, DIMENSION...) */
  fallbackEntityIndices: number[];
}

/** Minimum INSERT count to build a template for a block */
export const INSTANCING_THRESHOLD = 2;

/** Sentinel: entity on layer "0" — inherits layer from INSERT */
export const INHERIT_LAYER = "\0INHERIT";

/** Sentinel: entity with colorIndex=0 (ByBlock) — inherits color from INSERT */
export const BYBLOCK_COLOR = "\0BYBLOCK";

// Entity types that can be collected into GeometryCollector
const TEMPLATE_COLLECTABLE_TYPES = new Set([
  "LINE", "CIRCLE", "ARC", "ELLIPSE",
  "LWPOLYLINE", "POLYLINE", "SPLINE",
  "POINT", "SOLID", "3DFACE", "HATCH", "MLINE",
  "XLINE", "RAY",
]);

// ─── Core functions ──────────────────────────────────────────────────

/**
 * Transform flat vertex array [x,y,z, ...] by a 4x4 matrix (column-major elements).
 * Returns a new array with transformed coordinates.
 */
export function transformFlatVertices(src: number[], me: number[]): number[] {
  const dst = new Array<number>(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    dst[i]     = me[0] * x + me[4] * y + me[8]  * z + me[12];
    dst[i + 1] = me[1] * x + me[5] * y + me[9]  * z + me[13];
    dst[i + 2] = me[2] * x + me[6] * y + me[10] * z + me[14];
  }
  return dst;
}

/**
 * Build a reusable block template by collecting geometry in local (block) coordinates.
 * Entities on layer "0" use INHERIT_LAYER sentinel; ByBlock-colored entities use BYBLOCK_COLOR.
 * Non-cacheable entities (TEXT, INSERT, DIMENSION, etc.) are recorded in fallbackEntityIndices.
 *
 * @param collectEntityFn - Reference to the collectEntity function from useDXFGeometry
 */
export function buildBlockTemplate(
  blockName: string,
  blockEntities: DxfEntity[],
  colorCtx: EntityColorContext,
  collectEntityFn: (p: CollectEntityParams) => boolean,
): BlockTemplate {
  const tempCollector = new GeometryCollector();
  const fallbackEntityIndices: number[] = [];

  for (let i = 0; i < blockEntities.length; i++) {
    const entity = blockEntities[i];

    // Skip explicitly invisible entities (DXF code 60 = 1)
    if (entity.visible === false) continue;

    // Non-cacheable entity types → fallback
    if (!TEMPLATE_COLLECTABLE_TYPES.has(entity.type)) {
      fallbackEntityIndices.push(i);
      continue;
    }

    // Nested INSERT → fallback
    if (entity.type === "INSERT") {
      fallbackEntityIndices.push(i);
      continue;
    }

    // ByBlock linetype → can't cache (depends on INSERT's linetype)
    const entityLt = entity.lineType;
    if (entityLt && entityLt.toUpperCase() === "BYBLOCK") {
      fallbackEntityIndices.push(i);
      continue;
    }

    // Determine layer: "0" → sentinel, otherwise real layer
    const entityLayer = (!entity.layer || entity.layer === "0")
      ? INHERIT_LAYER
      : entity.layer;

    // Determine color: ByBlock (colorIndex=0) → sentinel
    let overrideColor: string | undefined;
    if (entity.colorIndex === 0) {
      overrideColor = BYBLOCK_COLOR;
    } else {
      // Resolve fixed color (ByLayer on named layer, or explicit ACI/trueColor)
      overrideColor = resolveEntityColor(entity, colorCtx.layers, undefined, colorCtx.darkTheme);
    }

    // Collect geometry in local coordinates (no worldMatrix)
    const collected = collectEntityFn({
      entity, colorCtx, collector: tempCollector, layer: entityLayer, overrideColor,
    });

    if (!collected) {
      fallbackEntityIndices.push(i);
    }
  }

  // Extract data from collector maps into template buckets
  const buckets = new Map<string, BlockTemplateGeometry>();

  const allKeys = new Set<string>();
  for (const k of tempCollector.lineSegments.keys()) allKeys.add(k);
  for (const k of tempCollector.points.keys()) allKeys.add(k);
  for (const k of tempCollector.linetypeDots.keys()) allKeys.add(k);
  for (const k of tempCollector.meshVertices.keys()) allKeys.add(k);

  for (const key of allKeys) {
    buckets.set(key, {
      lineSegments: tempCollector.lineSegments.get(key) || [],
      points: tempCollector.points.get(key) || [],
      linetypeDots: tempCollector.linetypeDots.get(key) || [],
      meshVertices: tempCollector.meshVertices.get(key) || [],
      meshIndices: tempCollector.meshIndices.get(key) || [],
    });
  }

  return { name: blockName, buckets, fallbackEntityIndices };
}

/**
 * Instantiate a cached block template into the collector by transforming
 * all cached geometry with the INSERT's world matrix.
 * Sentinel layer/color values are resolved to actual INSERT values.
 */
export function instantiateBlockTemplate(
  template: BlockTemplate,
  collector: GeometryCollector,
  insertLayer: string,
  insertColor: string,
  worldMatrix: THREE.Matrix4,
): void {
  const me = worldMatrix.elements;

  for (const [key, geo] of template.buckets) {
    // Parse key "layer::color" and resolve sentinels
    const sepIdx = key.indexOf("::");
    const rawLayer = sepIdx === -1 ? "0" : key.substring(0, sepIdx);
    const rawColor = sepIdx === -1 ? key : key.substring(sepIdx + 2);

    const layer = rawLayer === INHERIT_LAYER ? insertLayer : rawLayer;
    const color = rawColor === BYBLOCK_COLOR ? insertColor : rawColor;

    if (geo.lineSegments.length >= 6) {
      collector.addLineSegments(layer, color, transformFlatVertices(geo.lineSegments, me));
    }

    if (geo.points.length >= 3) {
      collector.addPoints(layer, color, transformFlatVertices(geo.points, me));
    }

    if (geo.linetypeDots.length >= 3) {
      collector.addLinetypeDots(layer, color, transformFlatVertices(geo.linetypeDots, me));
    }

    if (geo.meshVertices.length >= 9 && geo.meshIndices.length >= 3) {
      collector.addMesh(layer, color, transformFlatVertices(geo.meshVertices, me), geo.meshIndices);
    }
  }
}
