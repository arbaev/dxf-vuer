import * as THREE from "three";
import type { DxfEntity } from "@/types/dxf";
import { resolveEntityColor, isThemeAdaptiveColor } from "@/utils/colorResolver";
import { GeometryCollector } from "./mergeCollectors";
import { type RenderContext, getLineMaterial, getMeshMaterial, getPointsMaterial } from "./primitives";
import { LINETYPE_DOT_SIZE } from "@/constants";

// ─── Interfaces ──────────────────────────────────────────────────────

/** Params for the collectEntity callback passed to buildBlockTemplate */
export interface CollectEntityParams {
  entity: DxfEntity;
  colorCtx: RenderContext;
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
  colorCtx: RenderContext,
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
      overrideColor = resolveEntityColor(entity, colorCtx.layers, undefined);
    }

    // Collect geometry in local coordinates (no worldMatrix)
    const collected = collectEntityFn({
      entity, colorCtx, collector: tempCollector, layer: entityLayer, overrideColor,
    });

    if (!collected) {
      fallbackEntityIndices.push(i);
    }
  }

  // Extract data from collector maps into template buckets (convert typed → number[])
  const buckets = new Map<string, BlockTemplateGeometry>();

  const allKeys = new Set<string>();
  for (const k of tempCollector.lineSegments.keys()) allKeys.add(k);
  for (const k of tempCollector.points.keys()) allKeys.add(k);
  for (const k of tempCollector.linetypeDots.keys()) allKeys.add(k);
  for (const k of tempCollector.meshVertices.keys()) allKeys.add(k);

  for (const key of allKeys) {
    buckets.set(key, {
      lineSegments: tempCollector.lineSegments.get(key)?.toArray() ?? [],
      points: tempCollector.points.get(key)?.toArray() ?? [],
      linetypeDots: tempCollector.linetypeDots.get(key)?.toArray() ?? [],
      meshVertices: tempCollector.meshVertices.get(key)?.toArray() ?? [],
      meshIndices: tempCollector.meshIndices.get(key)?.toArray() ?? [],
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

// ─── Shared geometry (GPU instancing via matrix transform) ──────────

/** Pre-built BufferGeometry per bucket, shared across all instances */
export interface SharedBlockGeoEntry {
  rawLayer: string;
  rawColor: string;
  lineGeo?: THREE.BufferGeometry;
  meshGeo?: THREE.BufferGeometry;
  pointsGeo?: THREE.BufferGeometry;
  dotsGeo?: THREE.BufferGeometry;
}

export interface SharedBlockGeo {
  entries: SharedBlockGeoEntry[];
  fallbackEntityIndices: number[];
}

/**
 * Build shared BufferGeometry objects from a block template.
 * The geometry is in block-local coordinates and is stored once on the GPU.
 * Each INSERT creates a Three.js object referencing the shared geometry
 * with the INSERT's world matrix as the object transform.
 */
export function buildSharedBlockGeo(template: BlockTemplate): SharedBlockGeo {
  const entries: SharedBlockGeoEntry[] = [];

  for (const [key, geo] of template.buckets) {
    const sepIdx = key.indexOf("::");
    const rawLayer = sepIdx === -1 ? "0" : key.substring(0, sepIdx);
    const rawColor = sepIdx === -1 ? key : key.substring(sepIdx + 2);

    const entry: SharedBlockGeoEntry = { rawLayer, rawColor };
    let hasGeo = false;

    if (geo.lineSegments.length >= 6) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(geo.lineSegments), 3));
      entry.lineGeo = g;
      hasGeo = true;
    }

    if (geo.meshVertices.length >= 9 && geo.meshIndices.length >= 3) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(geo.meshVertices), 3));
      g.setIndex(geo.meshIndices);
      entry.meshGeo = g;
      hasGeo = true;
    }

    if (geo.points.length >= 3) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(geo.points), 3));
      entry.pointsGeo = g;
      hasGeo = true;
    }

    if (geo.linetypeDots.length >= 3) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(geo.linetypeDots), 3));
      entry.dotsGeo = g;
      hasGeo = true;
    }

    if (hasGeo) entries.push(entry);
  }

  return { entries, fallbackEntityIndices: template.fallbackEntityIndices };
}

/**
 * Add one block instance to the scene group using shared geometry.
 * Creates Three.js objects that reference the shared BufferGeometry
 * and use the INSERT's world matrix as the object transform.
 * GPU stores geometry ONCE; each instance is just a matrix + draw call.
 */
export function addSharedBlockInstance(
  shared: SharedBlockGeo,
  group: THREE.Group,
  insertLayer: string,
  insertColor: string,
  worldMatrix: THREE.Matrix4,
  colorCtx: RenderContext,
  originOffset?: { x: number; y: number; z: number },
): void {
  // Adjust worldMatrix to include origin offset: T(-offset) * worldMatrix
  // so that final coordinates = worldCoord - offset (matches collector offset)
  let mat4 = worldMatrix;
  if (originOffset && (originOffset.x !== 0 || originOffset.y !== 0)) {
    mat4 = worldMatrix.clone();
    mat4.elements[12] -= originOffset.x;
    mat4.elements[13] -= originOffset.y;
    mat4.elements[14] -= originOffset.z;
  }

  for (const entry of shared.entries) {
    const layer = entry.rawLayer === INHERIT_LAYER ? insertLayer : entry.rawLayer;
    const color = entry.rawColor === BYBLOCK_COLOR ? insertColor : entry.rawColor;

    if (entry.lineGeo) {
      const mat = getLineMaterial(color, colorCtx.materials);
      const obj = new THREE.LineSegments(entry.lineGeo, mat);
      obj.matrixAutoUpdate = false;
      obj.matrix.copy(mat4);
      obj.frustumCulled = false;
      obj.userData.layerName = layer;
      group.add(obj);
    }

    if (entry.meshGeo) {
      const mat = getMeshMaterial(color, colorCtx.materials);
      const obj = new THREE.Mesh(entry.meshGeo, mat);
      obj.matrixAutoUpdate = false;
      obj.matrix.copy(mat4);
      obj.frustumCulled = false;
      obj.userData.layerName = layer;
      group.add(obj);
    }

    if (entry.pointsGeo) {
      const mat = getPointsMaterial(color, colorCtx.materials);
      const obj = new THREE.Points(entry.pointsGeo, mat);
      obj.matrixAutoUpdate = false;
      obj.matrix.copy(mat4);
      obj.frustumCulled = false;
      obj.userData.layerName = layer;
      group.add(obj);
    }

    if (entry.dotsGeo) {
      const resolved = colorCtx.materials.resolveColor(color);
      const mat = new THREE.PointsMaterial({
        color: resolved,
        size: LINETYPE_DOT_SIZE,
        sizeAttenuation: false,
        depthTest: false,
        depthWrite: false,
      });
      if (isThemeAdaptiveColor(color)) colorCtx.materials.trackThemeMaterial(mat, color);
      const obj = new THREE.Points(entry.dotsGeo, mat);
      obj.matrixAutoUpdate = false;
      obj.matrix.copy(mat4);
      obj.frustumCulled = false;
      obj.userData.layerName = layer;
      group.add(obj);
    }
  }
}
