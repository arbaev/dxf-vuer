import * as THREE from "three";
import type { DxfEntity, DxfData, DxfLayer } from "@/types/dxf";
import {
  isInsertEntity,
  isTextEntity,
  isAttdefEntity,
  isDimensionEntity,
} from "@/types/dxf";
import { TEXT_HEIGHT } from "@/constants";
import { computeAutoLtScale } from "@/utils/linetypeResolver";
import type { RenderContext } from "./geometry/primitives";
import { MaterialCacheStore } from "./geometry/materialCache";
import { resolveDimVarsFromHeader } from "./geometry/dimensions";
import { GeometryCollector } from "./geometry/mergeCollectors";
import {
  type BlockTemplate,
  type SharedBlockGeo,
  INSTANCING_THRESHOLD,
  buildBlockTemplate,
  buildSharedBlockGeo,
} from "./geometry/blockTemplateCache";
import { classifyFont } from "./geometry/fontClassifier";
import { loadSerifFont } from "./geometry/fontManager";
import { clearGlyphCache } from "./geometry/glyphCache";
import { clearMeasureTextCache } from "./geometry/vectorTextBuilder";
import {
  collectEntity,
  computePointDisplaySize,
  collectTextOrMText,
  collectAttdefEntity,
  collectDimensionEntity,
  collectLeaderEntity,
  collectInsertEntity,
  type YieldState,
} from "./geometry/collectors";

// Re-export for public API
export { computePolylinePoints } from "./geometry/collectors";

/** Options for createThreeObjectsFromDXF */
export interface CreateDXFSceneOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  darkTheme?: boolean;
  font?: import("opentype.js").Font;
}

// ---- Constants ----

/** Entity types handled by the collectEntity dispatch map */
const COLLECTABLE_TYPES = new Set([
  "LINE", "CIRCLE", "ARC", "ELLIPSE",
  "LWPOLYLINE", "POLYLINE", "SPLINE",
  "POINT", "SOLID", "3DFACE", "HATCH",
  "MLINE", "XLINE", "RAY",
]);

/** Recognized but non-renderable entity types — silently skipped */
const NON_RENDERABLE_TYPES = new Set([
  "VIEWPORT", "IMAGE", "WIPEOUT", "3DSOLID",
]);

/** Yield control to the browser so the UI stays responsive */
const yieldToMain = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Time budget per chunk before yielding (ms) */
const CHUNK_TIME_MS = 16;

// ---- Main entry point ----

export async function createThreeObjectsFromDXF(
  dxf: DxfData,
  options?: CreateDXFSceneOptions,
): Promise<{
  group: THREE.Group;
  warnings?: string;
  unsupportedEntities?: string[];
}> {
  // Clear caches to prevent unbounded memory growth across reloads
  clearGlyphCache();
  clearMeasureTextCache();

  const signal = options?.signal;
  const onProgress = options?.onProgress;
  const darkTheme = options?.darkTheme;
  const font = options?.font;

  const tStart = performance.now();
  const group = new THREE.Group();

  if (!dxf.entities || dxf.entities.length === 0) {
    console.warn("DXF does not contain entities!");
    return { group };
  }

  const layers: Record<string, DxfLayer> = {};
  if (dxf.tables?.layer?.layers) {
    Object.assign(layers, dxf.tables.layer.layers);
  }

  const lineTypes = dxf.tables?.lineType?.lineTypes ?? {};
  const headerLtScale = dxf.header?.$LTSCALE ?? 1;
  const globalLtScale = headerLtScale === 1
    ? computeAutoLtScale(dxf.header, lineTypes)
    : headerLtScale;

  // Point display mode ($PDMODE / $PDSIZE)
  const pdMode = dxf.header?.$PDMODE ?? 0;
  const pointDisplaySize = pdMode !== 0 ? computePointDisplaySize(dxf.header) : undefined;

  // Dimension variables ($DIMSCALE, $DIMASZ, $DIMTXT, $DIMGAP)
  const dimVars = resolveDimVarsFromHeader(dxf.header);

  // Default text height from $TEXTSIZE header variable
  const headerTextSize = dxf.header?.$TEXTSIZE;
  const defaultTextHeight = (headerTextSize && headerTextSize > 0) ? headerTextSize : TEXT_HEIGHT;

  // $MIRRTEXT: 0 (default) = keep text readable in mirrored blocks, 1 = mirror text with geometry
  const mirrText = dxf.header?.$MIRRTEXT === 1;

  // Load serif font if any STYLE entry or MTEXT inline \f references a serif font
  const styles = dxf.tables?.style?.styles;
  let loadedSerifFont: import("opentype.js").Font | undefined;
  if (font) {
    let needsSerif = false;

    // Check STYLE table fontFile entries
    if (styles) {
      needsSerif = Object.values(styles).some(
        (s) => s.fontFile && classifyFont(s.fontFile) === "serif",
      );
    }

    // Check MTEXT inline \f font references in entities and blocks
    if (!needsSerif) {
      const inlineFontRegex = /\\f([^|;]*)/g;
      const checkText = (text: string): boolean => {
        let match;
        while ((match = inlineFontRegex.exec(text)) !== null) {
          if (classifyFont(match[1]) === "serif") return true;
        }
        return false;
      };

      for (const entity of dxf.entities) {
        if (entity.type === "MTEXT" && isTextEntity(entity) && entity.text && checkText(entity.text)) {
          needsSerif = true;
          break;
        }
      }

      if (!needsSerif && dxf.blocks) {
        outer:
        for (const block of Object.values(dxf.blocks)) {
          for (const entity of block.entities ?? []) {
            if (entity.type === "MTEXT" && isTextEntity(entity) && entity.text && checkText(entity.text)) {
              needsSerif = true;
              break outer;
            }
          }
        }
      }
    }

    if (needsSerif) {
      loadedSerifFont = await loadSerifFont();
    }
  }

  // DIMSTYLE table and header $DIMLUNIT for architectural dimension formatting
  const dimStyles = dxf.tables?.dimStyle?.dimStyles;
  const headerDimlunit = dxf.header?.$DIMLUNIT;

  // Build handle -> name map from BLOCK_RECORD for DIMBLK resolution
  let blockHandleToName: Map<string, string> | undefined;
  const blockRecords = dxf.tables?.blockRecord?.blockRecords;
  if (blockRecords) {
    blockHandleToName = new Map();
    for (const rec of Object.values(blockRecords)) {
      if (rec.handle) blockHandleToName.set(rec.handle, rec.name);
    }
  }

  const colorCtx: RenderContext = {
    layers,
    materials: new MaterialCacheStore(),
    lineTypes,
    globalLtScale,
    headerLtScale,
    darkTheme,
    font,
    serifFont: loadedSerifFont,
    styles,
    pdMode,
    pointDisplaySize,
    dimVars,
    defaultTextHeight,
    mirrText,
    dimStyles,
    headerDimlunit,
    blockHandleToName,
  };

  // Compute clip size for XLINE/RAY from drawing extents
  const extMin = dxf.header?.$EXTMIN;
  const extMax = dxf.header?.$EXTMAX;
  if (extMin && extMax && extMax.x > extMin.x && extMax.y > extMin.y) {
    const dx = extMax.x - extMin.x;
    const dy = extMax.y - extMin.y;
    colorCtx.xlineClipSize = Math.sqrt(dx * dx + dy * dy) * 2;
  }

  const collector = new GeometryCollector();
  const errors: string[] = [];
  const unsupportedTypes: string[] = [];

  const yieldState: YieldState = { lastYield: performance.now(), signal };

  // Pre-pass: count INSERT usage and build templates for frequently-used blocks
  let tTemplates = performance.now();
  const blockRefCounts = new Map<string, number>();
  for (const entity of dxf.entities) {
    if (entity.type === "INSERT" && !entity.inPaperSpace && isInsertEntity(entity)) {
      blockRefCounts.set(entity.name, (blockRefCounts.get(entity.name) ?? 0) + 1);
    }
  }

  // Propagate counts through nested blocks: if block A is used N times and
  // contains M INSERT refs to block B, then B is used at least N*M times.
  // Process ALL referenced blocks (not just those >= threshold) because a block
  // used once may contain hundreds of INSERTs to sub-blocks that need templates.
  if (dxf.blocks) {
    const visited = new Set<string>();
    const queue = [...blockRefCounts.keys()];
    while (queue.length > 0) {
      const name = queue.shift()!;
      if (visited.has(name)) continue;
      visited.add(name);
      const parentCount = blockRefCounts.get(name) ?? 0;
      if (parentCount === 0) continue;
      const block = dxf.blocks[name];
      if (!block?.entities) continue;
      for (const entity of block.entities) {
        if (entity.type === "INSERT" && isInsertEntity(entity)) {
          blockRefCounts.set(entity.name, (blockRefCounts.get(entity.name) ?? 0) + parentCount);
          if (!visited.has(entity.name)) {
            queue.push(entity.name);
          }
        }
      }
    }
  }

  const blockTemplates = new Map<string, BlockTemplate>();
  if (dxf.blocks) {
    for (const [name, count] of blockRefCounts) {
      if (count >= INSTANCING_THRESHOLD) {
        const block = dxf.blocks[name];
        if (block?.entities?.length) {
          blockTemplates.set(name, buildBlockTemplate(name, block.entities as DxfEntity[], colorCtx, collectEntity));
        }
      }
    }
  }

  // Build shared GPU geometries for all templates -- each INSERT becomes
  // a matrix transform instead of copying all vertices
  const sharedBlockGeos = new Map<string, SharedBlockGeo>();
  for (const [name, template] of blockTemplates) {
    sharedBlockGeos.set(name, buildSharedBlockGeo(template));
  }
  console.log(`[DXF]   Templates: ${blockTemplates.size} blocks, ${sharedBlockGeos.size} shared (${Math.round(performance.now() - tTemplates)}ms)`);

  const tEntities = performance.now();
  const typeTimers = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  for (let index = 0; index < dxf.entities.length; index++) {
    if (signal?.aborted) {
      colorCtx.materials.disposeAll();
      return { group };
    }

    const entity = dxf.entities[index];

    // Yield to browser every ~16ms to keep UI responsive
    if (performance.now() - yieldState.lastYield > CHUNK_TIME_MS) {
      onProgress?.(index / dxf.entities.length);
      await yieldToMain();
      yieldState.lastYield = performance.now();
    }

    const tEntity = performance.now();
    try {
      // Skip paper space entities -- they belong to layouts, not model space
      if (entity.inPaperSpace) continue;

      // Skip explicitly invisible entities (DXF code 60 = 1)
      if (entity.visible === false) continue;

      const layer = entity.layer || "0";

      // INSERT blocks: flatten into collector (merged geometry)
      if (entity.type === "INSERT") {
        await collectInsertEntity(entity, dxf, colorCtx, collector, layer, null, group, 0, yieldState, blockTemplates, sharedBlockGeos, collectEntity, undefined);
        continue;
      }

      // Try to collect simple entities into merged buffers
      if (COLLECTABLE_TYPES.has(entity.type)) {
        if (collectEntity({ entity, colorCtx, collector, layer })) {
          continue;
        }
      }

      // Vector text: collect TEXT/MTEXT directly into GeometryCollector
      if ((entity.type === "TEXT" || entity.type === "MTEXT") && isTextEntity(entity)) {
        collectTextOrMText(entity, colorCtx, collector, layer);
        continue;
      }

      // Vector text: collect ATTDEF as visible text (tag or default value)
      if (entity.type === "ATTDEF" && isAttdefEntity(entity)) {
        collectAttdefEntity(entity, colorCtx, collector, layer);
        continue;
      }

      // Vector text: collect DIMENSION directly (lines decomposed, text via collector)
      if (entity.type === "DIMENSION" && isDimensionEntity(entity)) {
        collectDimensionEntity(entity, dxf, colorCtx, collector, layer);
        continue;
      }

      // Vector text: collect LEADER/MULTILEADER directly
      if (entity.type === "LEADER" || entity.type === "MULTILEADER" || entity.type === "MLEADER") {
        collectLeaderEntity(entity, dxf, colorCtx, collector, layer);
        continue;
      }

      // Recognized but non-renderable entities: skip silently
      if (NON_RENDERABLE_TYPES.has(entity.type)) {
        continue;
      }

      // Truly unsupported entity type
      unsupportedTypes.push(`Entity ${index}: ${entity.type || "unknown type"}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      errors.push(`Entity ${index} (${entity.type || "unknown type"}): ${errorMsg}`);
    } finally {
      const t = entity.type || "UNKNOWN";
      typeTimers.set(t, (typeTimers.get(t) ?? 0) + (performance.now() - tEntity));
      typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    }
  }

  console.log(`[DXF]   Entities: ${Math.round(performance.now() - tEntities)}ms`);
  const sortedTypes = [...typeTimers.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`[DXF]   By type: ${sortedTypes.slice(0, 8).map(([t, ms]) => `${t}: ${Math.round(ms)}ms (${typeCounts.get(t) ?? 0})`).join(", ")}`);
  onProgress?.(1);

  if (signal?.aborted) {
    colorCtx.materials.disposeAll();
    return { group };
  }

  // Flush merged geometry into Three.js objects
  const tFlush = performance.now();
  const mergedObjects = collector.flush(colorCtx.materials);
  for (const obj of mergedObjects) {
    group.add(obj);
  }
  // Count merged objects by type
  let lineCount = 0, meshCount = 0, ptsCount = 0;
  for (const obj of mergedObjects) {
    if (obj instanceof THREE.LineSegments) lineCount++;
    else if (obj instanceof THREE.Mesh) meshCount++;
    else if (obj instanceof THREE.Points) ptsCount++;
  }
  console.log(`[DXF]   Flush: ${Math.round(performance.now() - tFlush)}ms -> ${lineCount} lines, ${meshCount} meshes, ${ptsCount} pts`);
  console.log(`[DXF] Geometry total: ${Math.round(performance.now() - tStart)}ms (${dxf.entities.length} entities)`);

  const totalIssues = errors.length + unsupportedTypes.length;
  if (totalIssues > 0) {
    const warningParts = [];

    if (errors.length > 0) {
      warningParts.push(
        `${errors.length} errors: ${errors.slice(0, 2).join("; ")}${errors.length > 2 ? "..." : ""}`,
      );
    }

    if (unsupportedTypes.length > 0) {
      warningParts.push(
        `${unsupportedTypes.length} unsupported types: ${unsupportedTypes.slice(0, 2).join("; ")}${unsupportedTypes.length > 2 ? "..." : ""}`,
      );
    }

    const errorSummary = `Failed to process ${totalIssues} of ${dxf.entities.length} objects. ${warningParts.join(", ")}`;

    return {
      group,
      warnings: errorSummary,
      unsupportedEntities: unsupportedTypes.length > 0 ? unsupportedTypes : undefined,
    };
  }

  return { group };
}
