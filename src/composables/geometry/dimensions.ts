import * as THREE from "three";
import type { Font } from "opentype.js";
import type { DxfVertex, DxfDimensionEntity, DxfDimStyle } from "@/types/dxf";
import {
  DIM_TEXT_HEIGHT,
  DIM_TEXT_GAP,
  DIM_TEXT_GAP_MULTIPLIER,
  DIM_TEXT_DECIMAL_PLACES,
  ARROW_SIZE,
  EXTENSION_LINE_DASH_SIZE,
  EXTENSION_LINE_GAP_SIZE,
  EXTENSION_LINE_EXTENSION,
  DEGREES_TO_RADIANS_DIVISOR,
  EPSILON,
  CIRCLE_SEGMENTS,
  MIN_ARC_SEGMENTS,
} from "@/constants";
import { createArrow, createTick } from "./primitives";
import { replaceSpecialChars } from "./text";
import type { GeometryCollector } from "./mergeCollectors";
import { addDimensionTextToCollector, measureDimensionTextWidth } from "./vectorTextBuilder";

/**
 * Check if a DIMBLK block name represents a tick mark (oblique stroke).
 * Common tick block names: _ArchTick, ArchTick, _OBLIQUE, Oblique, _Tick.
 */
export const isTickBlock = (name: string): boolean => {
  if (!name) return false;
  const n = name.toLowerCase();
  return n.includes("tick") || n.includes("oblique");
};

/**
 * Resolved dimension variable set. Values are final (already scaled by DIMSCALE).
 * Priority: entity XDATA override > header $DIM* × $DIMSCALE > hardcoded defaults.
 */
export interface DimVars {
  arrowSize: number;
  textHeight: number;
  textGap: number;
  extLineDash: number;
  extLineGap: number;
  extLineExtension: number; // DIMEXE: extension line overshoot past dimension line
  useTicks: boolean;
  tickSize: number;
}

/** Default DimVars using hardcoded constants (backward compatibility) */
export const DEFAULT_DIM_VARS: DimVars = {
  arrowSize: ARROW_SIZE,
  textHeight: DIM_TEXT_HEIGHT,
  textGap: DIM_TEXT_GAP,
  extLineDash: EXTENSION_LINE_DASH_SIZE,
  extLineGap: EXTENSION_LINE_GAP_SIZE,
  extLineExtension: EXTENSION_LINE_EXTENSION,
  useTicks: false,
  tickSize: 0,
};

/**
 * Resolve dimension variables from DXF header.
 * $DIMSCALE multiplies all other $DIM* values.
 */
export function resolveDimVarsFromHeader(
  header: Record<string, unknown> | undefined,
): DimVars {
  if (!header) return { ...DEFAULT_DIM_VARS };

  const dimScale = (header["$DIMSCALE"] as number) ?? 1;
  const scale = dimScale > 0 ? dimScale : 1;

  const arrowSize = ((header["$DIMASZ"] as number) ?? ARROW_SIZE) * scale;
  const textHeight = ((header["$DIMTXT"] as number) ?? DIM_TEXT_HEIGHT) * scale;
  const dimGap = (header["$DIMGAP"] as number) ?? undefined;
  const textGap = dimGap !== undefined
    ? dimGap * scale * DIM_TEXT_GAP_MULTIPLIER * 2
    : textHeight * DIM_TEXT_GAP_MULTIPLIER;
  const extLineDash = EXTENSION_LINE_DASH_SIZE * scale;
  const extLineGap = EXTENSION_LINE_GAP_SIZE * scale;
  const extLineExtension = ((header["$DIMEXE"] as number) ?? EXTENSION_LINE_EXTENSION) * scale;

  const dimtsz = (header["$DIMTSZ"] as number) ?? 0;
  const dimblk = (header["$DIMBLK"] as string) ?? "";
  const useTicks = dimtsz > 0 || isTickBlock(dimblk);
  // When using ticks: DIMTSZ provides explicit size, otherwise fall back to arrowSize
  const tickSize = !useTicks ? 0 : dimtsz > 0 ? dimtsz * scale : arrowSize;

  return { arrowSize, textHeight, textGap, extLineDash, extLineGap, extLineExtension, useTicks, tickSize };
}

/**
 * Merge per-entity XDATA overrides into resolved DimVars.
 * Entity textHeight (code 140) is treated as the final value.
 * Entity arrowSize from XDATA is scaled by entity dimScale.
 */
export function mergeEntityDimVars(
  base: DimVars,
  entity: DxfDimensionEntity,
): DimVars {
  const result = { ...base };

  if (entity.textHeight !== undefined) {
    result.textHeight = entity.textHeight;
    result.textGap = entity.textHeight * DIM_TEXT_GAP_MULTIPLIER;
  }

  if (entity.arrowSize !== undefined) {
    const scale = entity.dimScale ?? 1;
    result.arrowSize = entity.arrowSize * scale;
  }

  return result;
}

/**
 * Apply DIMSTYLE-level overrides to resolved DimVars.
 * Sits between header defaults and entity XDATA in priority chain:
 *   header → DIMSTYLE → entity XDATA
 *
 * DIMSCALE from DIMSTYLE multiplies DIMTXT/DIMASZ.
 * If DIMSTYLE has its own DIMTXT/DIMASZ, those override header values.
 */
export function applyDimStyleVars(
  base: DimVars,
  dimStyle: DxfDimStyle,
  header?: Record<string, unknown>,
): DimVars {
  const result = { ...base };

  // DIMSCALE: DIMSTYLE overrides header $DIMSCALE
  const headerDimScale = (header?.["$DIMSCALE"] as number | undefined) ?? 1;
  const styleDimScale = dimStyle.dimscale;
  const scale = (styleDimScale ?? headerDimScale) || 1;

  if (dimStyle.dimtxt !== undefined) {
    // DIMSTYLE provides its own text height — use it × scale
    result.textHeight = dimStyle.dimtxt * scale;
    result.textGap = result.textHeight * DIM_TEXT_GAP_MULTIPLIER;
  } else if (styleDimScale !== undefined && styleDimScale !== headerDimScale) {
    // DIMSTYLE only overrides DIMSCALE — re-scale header DIMTXT with new scale
    const headerDimTxt = (header?.["$DIMTXT"] as number | undefined) ?? DIM_TEXT_HEIGHT;
    result.textHeight = headerDimTxt * scale;
    result.textGap = result.textHeight * DIM_TEXT_GAP_MULTIPLIER;
  }

  if (dimStyle.dimasz !== undefined) {
    // DIMSTYLE provides its own arrow size — use it × scale
    result.arrowSize = dimStyle.dimasz * scale;
  } else if (styleDimScale !== undefined && styleDimScale !== headerDimScale) {
    // DIMSTYLE only overrides DIMSCALE — re-scale header DIMASZ with new scale
    const headerDimAsz = (header?.["$DIMASZ"] as number | undefined) ?? ARROW_SIZE;
    result.arrowSize = headerDimAsz * scale;
  }

  // When ticks are derived from arrowSize (DIMTSZ=0 + tick block), keep them in sync
  if (result.useTicks && result.tickSize > 0 && dimStyle.dimtsz === undefined) {
    result.tickSize = result.arrowSize;
  }

  // Re-scale extension line geometry
  if (styleDimScale !== undefined && styleDimScale !== headerDimScale) {
    result.extLineDash = EXTENSION_LINE_DASH_SIZE * scale;
    result.extLineGap = EXTENSION_LINE_GAP_SIZE * scale;
  }

  if (dimStyle.dimexe !== undefined) {
    result.extLineExtension = dimStyle.dimexe * scale;
  } else if (styleDimScale !== undefined && styleDimScale !== headerDimScale) {
    const headerDimExe = (header?.["$DIMEXE"] as number | undefined) ?? EXTENSION_LINE_EXTENSION;
    result.extLineExtension = headerDimExe * scale;
  }

  return result;
}

// ── Parameter interfaces ──────────────────────────────────────────────

/** Shared params for dimension type functions (ordinate, radial, diametric, angular) */
export interface DimensionTypeParams {
  entity: DxfDimensionEntity;
  color: string;
  font?: Font;
  collector?: GeometryCollector;
  layer?: string;
  transform?: readonly number[];
  dv?: DimVars;
}

/** Params for createLinearDimensionLines */
export interface LinearDimensionLinesParams {
  point1: DxfVertex;
  point2: DxfVertex;
  anchorPoint: DxfVertex;
  textPos?: DxfVertex;
  dimLineMaterial: THREE.LineBasicMaterial;
  extensionLineMaterial: THREE.LineDashedMaterial;
  arrowMaterial: THREE.MeshBasicMaterial;
  isHorizontal: boolean;
  dv?: DimVars;
}

/** Params for createRotatedDimensionLines */
export interface RotatedDimensionLinesParams {
  point1: DxfVertex;
  point2: DxfVertex;
  anchorPoint: DxfVertex;
  textPos?: DxfVertex;
  dimLineMaterial: THREE.LineBasicMaterial;
  extensionLineMaterial: THREE.LineDashedMaterial;
  arrowMaterial: THREE.MeshBasicMaterial;
  angleRad: number;
  dv?: DimVars;
}

/** Params for createDimensionGroup */
export interface DimensionGroupParams {
  point1: DxfVertex;
  point2: DxfVertex;
  anchorPoint: DxfVertex;
  textPos?: DxfVertex;
  textHeight: number;
  isRadial: boolean;
  color: string;
  angle?: number;
  /** Type-0 (rotated) dimension: always use rotated path, even for angle=0 (horizontal) */
  forceRotated?: boolean;
  dv?: DimVars;
}

/** Params for emitStackedText (vectorTextBuilder.ts) */

/** Line defined by two points for intersectLines2D */
export interface Line2D {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const createExtensionLine = (
  from: THREE.Vector3,
  to: THREE.Vector3,
  material: THREE.LineBasicMaterial | THREE.LineDashedMaterial,
  overshoot?: number,
): THREE.Line => {
  // Extension lines extend beyond the dimension line per AutoCAD convention (DIMEXE)
  let endPoint = to;
  if (overshoot && overshoot > 0) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > EPSILON) {
      endPoint = new THREE.Vector3(
        to.x + (dx / len) * overshoot,
        to.y + (dy / len) * overshoot,
        to.z,
      );
    }
  }

  const geometry = new THREE.BufferGeometry().setFromPoints([from, endPoint]);
  const line = new THREE.Line(geometry, material);

  // computeLineDistances required for LineDashedMaterial to render dashes
  if (material instanceof THREE.LineDashedMaterial) {
    line.computeLineDistances();
  }

  return line;
};

export const createLinearDimensionLines = (p: LinearDimensionLinesParams): THREE.Object3D[] => {
  const {
    point1, point2, anchorPoint, textPos,
    dimLineMaterial, extensionLineMaterial, arrowMaterial,
    isHorizontal, dv = DEFAULT_DIM_VARS,
  } = p;
  const objects: THREE.Object3D[] = [];

  const getMainCoord = (p: DxfVertex) => (isHorizontal ? p.x : p.y);
  const getFixedCoord = (p: DxfVertex) => (isHorizontal ? p.y : p.x);
  const createVec3 = (main: number, fixed: number, z: number) =>
    isHorizontal ? new THREE.Vector3(main, fixed, z) : new THREE.Vector3(fixed, main, z);

  const min = Math.min(getMainCoord(point1), getMainCoord(point2));
  const max = Math.max(getMainCoord(point1), getMainCoord(point2));
  const anchorFixed = getFixedCoord(anchorPoint);

  // Split dimension line around text if text lies on the line
  if (textPos && Math.abs(getFixedCoord(textPos) - anchorFixed) < 1) {
    const gapStart = getMainCoord(textPos) - dv.textGap / 2;
    const gapEnd = getMainCoord(textPos) + dv.textGap / 2;

    if (min < gapStart) {
      objects.push(
        createExtensionLine(
          createVec3(min, anchorFixed, 0),
          createVec3(gapStart, anchorFixed, 0),
          dimLineMaterial,
        ),
      );
    }

    if (max > gapEnd) {
      objects.push(
        createExtensionLine(
          createVec3(gapEnd, anchorFixed, 0),
          createVec3(max, anchorFixed, 0),
          dimLineMaterial,
        ),
      );
    }
  } else {
    objects.push(
      createExtensionLine(
        createVec3(min, anchorFixed, 0),
        createVec3(max, anchorFixed, 0),
        dimLineMaterial,
      ),
    );
  }

  if (Math.abs(getFixedCoord(point1) - anchorFixed) > 0.1) {
    objects.push(
      createExtensionLine(
        createVec3(getMainCoord(point1), getFixedCoord(point1), 0),
        createVec3(getMainCoord(point1), anchorFixed, 0),
        extensionLineMaterial,
        dv.extLineExtension,
      ),
    );
  }
  if (Math.abs(getFixedCoord(point2) - anchorFixed) > 0.1) {
    objects.push(
      createExtensionLine(
        createVec3(getMainCoord(point2), getFixedCoord(point2), 0),
        createVec3(getMainCoord(point2), anchorFixed, 0),
        extensionLineMaterial,
        dv.extLineExtension,
      ),
    );
  }

  if (dv.useTicks) {
    const dimAngle = isHorizontal ? 0 : Math.PI / 2;
    objects.push(createTick(createVec3(min, anchorFixed, 0.1), dv.tickSize, dimAngle, dimLineMaterial));
    objects.push(createTick(createVec3(max, anchorFixed, 0.1), dv.tickSize, dimAngle, dimLineMaterial));
  } else {
    objects.push(createArrow(createVec3(max, anchorFixed, 0.1), createVec3(min, anchorFixed, 0.1), dv.arrowSize, arrowMaterial));
    objects.push(createArrow(createVec3(min, anchorFixed, 0.1), createVec3(max, anchorFixed, 0.1), dv.arrowSize, arrowMaterial));
  }

  return objects;
};

/**
 * Create lines and arrows for a rotated dimension (arbitrary angle).
 * Projects measurement points onto the dimension line via dot product.
 */
export const createRotatedDimensionLines = (p: RotatedDimensionLinesParams): THREE.Object3D[] => {
  const {
    point1, point2, anchorPoint, textPos,
    dimLineMaterial, extensionLineMaterial, arrowMaterial,
    angleRad, dv = DEFAULT_DIM_VARS,
  } = p;
  const objects: THREE.Object3D[] = [];

  const dirX = Math.cos(angleRad);
  const dirY = Math.sin(angleRad);

  // Project points onto dimension line direction (anchorPoint lies on it)
  const t1 = (point1.x - anchorPoint.x) * dirX + (point1.y - anchorPoint.y) * dirY;
  const t2 = (point2.x - anchorPoint.x) * dirX + (point2.y - anchorPoint.y) * dirY;

  // Foot points: perpendicular intersections of measurement points with dimension line
  const foot1 = new THREE.Vector3(
    anchorPoint.x + t1 * dirX,
    anchorPoint.y + t1 * dirY,
    0,
  );
  const foot2 = new THREE.Vector3(
    anchorPoint.x + t2 * dirX,
    anchorPoint.y + t2 * dirY,
    0,
  );

  const tMin = Math.min(t1, t2);
  const tMax = Math.max(t1, t2);
  const minPt = new THREE.Vector3(
    anchorPoint.x + tMin * dirX,
    anchorPoint.y + tMin * dirY,
    0,
  );
  const maxPt = new THREE.Vector3(
    anchorPoint.x + tMax * dirX,
    anchorPoint.y + tMax * dirY,
    0,
  );

  // Split dimension line around text if text lies on it (perpendicular distance < 1)
  if (textPos) {
    const tText = (textPos.x - anchorPoint.x) * dirX + (textPos.y - anchorPoint.y) * dirY;
    const perpDist = Math.abs(
      -(textPos.x - anchorPoint.x) * dirY + (textPos.y - anchorPoint.y) * dirX,
    );

    if (perpDist < 1) {
      const gapStart = tText - dv.textGap / 2;
      const gapEnd = tText + dv.textGap / 2;

      if (tMin < gapStart) {
        objects.push(
          createExtensionLine(
            minPt,
            new THREE.Vector3(
              anchorPoint.x + gapStart * dirX,
              anchorPoint.y + gapStart * dirY,
              0,
            ),
            dimLineMaterial,
          ),
        );
      }
      if (tMax > gapEnd) {
        objects.push(
          createExtensionLine(
            new THREE.Vector3(
              anchorPoint.x + gapEnd * dirX,
              anchorPoint.y + gapEnd * dirY,
              0,
            ),
            maxPt,
            dimLineMaterial,
          ),
        );
      }
    } else {
      objects.push(createExtensionLine(minPt, maxPt, dimLineMaterial));
    }
  } else {
    objects.push(createExtensionLine(minPt, maxPt, dimLineMaterial));
  }

  const p1 = new THREE.Vector3(point1.x, point1.y, 0);
  const p2 = new THREE.Vector3(point2.x, point2.y, 0);

  if (p1.distanceTo(foot1) > 0.1) {
    objects.push(createExtensionLine(p1, foot1, extensionLineMaterial, dv.extLineExtension));
  }
  if (p2.distanceTo(foot2) > 0.1) {
    objects.push(createExtensionLine(p2, foot2, extensionLineMaterial, dv.extLineExtension));
  }

  if (dv.useTicks) {
    objects.push(createTick(new THREE.Vector3(minPt.x, minPt.y, 0.1), dv.tickSize, angleRad, dimLineMaterial));
    objects.push(createTick(new THREE.Vector3(maxPt.x, maxPt.y, 0.1), dv.tickSize, angleRad, dimLineMaterial));
  } else {
    objects.push(createArrow(new THREE.Vector3(maxPt.x, maxPt.y, 0.1), new THREE.Vector3(minPt.x, minPt.y, 0.1), dv.arrowSize, arrowMaterial));
    objects.push(createArrow(new THREE.Vector3(minPt.x, minPt.y, 0.1), new THREE.Vector3(maxPt.x, maxPt.y, 0.1), dv.arrowSize, arrowMaterial));
  }

  return objects;
};

export interface DimFormatOptions {
  dimlunit?: number; // 2=Decimal, 4=Architectural
  dimzin?: number;   // Zero suppression flags
}

export const extractDimensionData = (entity: DxfDimensionEntity, dv: DimVars = DEFAULT_DIM_VARS, fmt?: DimFormatOptions) => {
  let point1 = entity.linearOrAngularPoint1;
  let point2 = entity.linearOrAngularPoint2;
  const anchorPoint = entity.anchorPoint;
  const diameterOrRadiusPoint = entity.diameterOrRadiusPoint;
  const textPos = entity.middleOfText;
  const angle = entity.angle || 0;
  let dimensionText = entity.text;
  let isRadial = false;

  const formatMeasurement = (value: number): string =>
    fmt?.dimlunit === 4
      ? formatArchitectural(value, fmt.dimzin)
      : formatDimNumber(value);

  // Detect radial dimension BEFORE generating text to add "R" prefix
  if (!point1 && !point2 && diameterOrRadiusPoint && anchorPoint) {
    point1 = diameterOrRadiusPoint;
    point2 = anchorPoint;
    isRadial = true;
  }

  // Replace <> placeholder with actual measurement (AutoCAD convention)
  if (dimensionText && typeof entity.actualMeasurement === "number") {
    const measStr =
      (isRadial ? "R" : "") + formatMeasurement(entity.actualMeasurement);
    dimensionText = dimensionText.replace(/<>/g, measStr);
  }

  if (!dimensionText && typeof entity.actualMeasurement === "number") {
    dimensionText =
      (isRadial ? "R" : "") + formatMeasurement(entity.actualMeasurement);
  }

  // Fallback: compute measurement from point coordinates
  if (!dimensionText && point1 && point2) {
    const dx = point2.x - point1.x;
    const dy = point2.y - point1.y;
    const dz = (point2.z || 0) - (point1.z || 0);
    const measurement = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dimensionText = (isRadial ? "R" : "") + formatMeasurement(measurement);
  }

  if (!isRadial && dimensionText && !isNaN(parseFloat(dimensionText)) && fmt?.dimlunit !== 4) {
    dimensionText = formatDimNumber(parseFloat(dimensionText));
  }

  if (!point1 || !point2 || !anchorPoint || !dimensionText) {
    return null;
  }
  const textHeight = entity.textHeight || dv.textHeight;

  return {
    point1,
    point2,
    anchorPoint,
    dimensionText,
    textPos,
    textHeight,
    angle,
    isRadial,
  };
};

export const createDimensionGroup = (p: DimensionGroupParams): THREE.Group => {
  const {
    point1, point2, anchorPoint, textPos,
    textHeight: _textHeight, isRadial, color,
    angle = 0, dv = DEFAULT_DIM_VARS,
  } = p;
  const dimGroup = new THREE.Group();

  const dimLineMaterial = new THREE.LineBasicMaterial({ color });
  const extensionLineMaterial = new THREE.LineDashedMaterial({
    color,
    dashSize: dv.extLineDash,
    gapSize: dv.extLineGap,
  });
  const arrowMaterial = new THREE.MeshBasicMaterial({
    color,
    side: THREE.DoubleSide,
  });

  if (isRadial) {
    const centerX = point2.x;
    const centerY = point2.y;
    const edgeX = point1.x;
    const edgeY = point1.y;

    dimGroup.add(
      createExtensionLine(
        new THREE.Vector3(centerX, centerY, 0),
        new THREE.Vector3(edgeX, edgeY, 0),
        dimLineMaterial,
      ),
    );

    const arrow = createArrow(
      new THREE.Vector3(centerX, centerY, 0.1),
      new THREE.Vector3(edgeX, edgeY, 0.1),
      dv.arrowSize,
      arrowMaterial,
    );
    dimGroup.add(arrow);

    return dimGroup;
  }

  let dimensionObjects: THREE.Object3D[];

  if (angle !== 0 || p.forceRotated) {
    const angleRad = (angle * Math.PI) / DEGREES_TO_RADIANS_DIVISOR;
    dimensionObjects = createRotatedDimensionLines({
      point1, point2, anchorPoint, textPos,
      dimLineMaterial, extensionLineMaterial, arrowMaterial,
      angleRad, dv,
    });
  } else {
    // Determine orientation by comparing point spread in X vs Y
    const spreadX = Math.abs(point2.x - point1.x);
    const spreadY = Math.abs(point2.y - point1.y);
    const isHorizontal = spreadX >= spreadY;

    dimensionObjects = createLinearDimensionLines({
      point1, point2, anchorPoint, textPos,
      dimLineMaterial, extensionLineMaterial, arrowMaterial,
      isHorizontal, dv,
    });
  }

  dimensionObjects.forEach((obj) => dimGroup.add(obj));

  return dimGroup;
};

/**
 * Format dimension number: up to DIM_TEXT_DECIMAL_PLACES digits, no trailing zeros.
 * 28 -> "28", 28.28 -> "28.28", 28.10 -> "28.1"
 */
export const formatDimNumber = (value: number): string =>
  parseFloat(value.toFixed(DIM_TEXT_DECIMAL_PLACES)).toString();

/**
 * Format a measurement in inches as architectural: feet'-inches".
 * dimzin controls zero suppression (DXF code 78):
 *   bit 0 (1): suppress leading zeros in decimals (not relevant here)
 *   bit 1 (2): suppress trailing zeros in decimals (not relevant here)
 *   bit 2 (4): suppress 0 feet → "4\"" instead of "0'-4\""
 *   bit 3 (8): suppress 0 inches → "7'" instead of "7'-0\""
 * Default (dimzin=0): suppress both zero feet and zero inches.
 */
export const formatArchitectural = (totalInches: number, dimzin?: number): string => {
  const sign = totalInches < 0 ? "-" : "";
  const abs = Math.abs(totalInches);
  const feet = Math.floor(abs / 12);
  const inches = Math.round(abs % 12);

  // Handle rounding: 11.5+ inches rounds up to next foot
  const finalFeet = inches >= 12 ? feet + 1 : feet;
  const finalInches = inches >= 12 ? 0 : inches;

  const zin = dimzin ?? 0;
  const suppressZeroFeet = (zin & 4) !== 0;
  const suppressZeroInches = (zin & 8) !== 0;

  // dimzin=0: suppress both zero feet and zero inches (AutoCAD default for architectural)
  if (zin === 0) {
    if (finalFeet === 0 && finalInches === 0) return sign + "0\"";
    if (finalFeet === 0) return sign + finalInches + "\"";
    if (finalInches === 0) return sign + finalFeet + "'";
    return sign + finalFeet + "'-" + finalInches + "\"";
  }

  if (finalFeet === 0 && suppressZeroFeet) {
    return sign + finalInches + "\"";
  }
  if (finalInches === 0 && suppressZeroInches) {
    return sign + finalFeet + "'";
  }
  return sign + finalFeet + "'-" + finalInches + "\"";
};

/**
 * Clean MTEXT formatting codes from dimension text (except \S for stacked fractions).
 * Removes \A, \f, \c, \H, \P, {}, and processes Unicode escapes and special characters.
 */
export const cleanDimensionMText = (rawText: string): string => {
  // Protect escaped backslashes and braces with placeholders before stripping formatting
  let text = rawText.replace(/\\\\/g, "\x01").replace(/\\\{/g, "\x02").replace(/\\\}/g, "\x03");

  text = text.replace(/\\[Aa]\d+;/g, "");
  text = text.replace(/\\[fF][^;]*;/g, "");
  text = text.replace(/\\[cC]\d+;/g, "");
  text = text.replace(/\\[Hh][\d.]+;/g, "");
  text = text.replace(/\\[WTQA][\d.+-]+;/gi, "");
  text = text.replace(/\\[LOKlok]/g, "");
  text = text.replace(/\\P/g, " ");
  text = text.replace(/[{}]/g, "");
  text = text.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) =>
    String.fromCodePoint(parseInt(hex, 16)),
  );
  text = replaceSpecialChars(text);
  text = text.replace(/\x01/g, "\\").replace(/\x02/g, "{").replace(/\x03/g, "}");

  return text;
};

/**
 * Create an ordinate dimension (type 6/7).
 * Displays the X or Y coordinate of a point with a dog-leg leader.
 * No arrows or dashed lines -- solid lines only (per AutoCAD convention).
 */
export const createOrdinateDimension = (p: DimensionTypeParams): THREE.Object3D[] | null => {
  const { entity, color, font, collector, layer, transform, dv = DEFAULT_DIM_VARS } = p;
  const feature = entity.linearOrAngularPoint1; // Code 13 -- point on object
  const leader = entity.linearOrAngularPoint2; // Code 14 -- end of diagonal
  const textPos = entity.middleOfText; // Code 11

  if (!feature || !leader) return null;

  let dimensionText = entity.text;
  const measurement = entity.actualMeasurement;

  if (dimensionText && typeof measurement === "number") {
    dimensionText = dimensionText.replace(/<>/g, formatDimNumber(measurement));
  }

  if (!dimensionText && typeof measurement === "number") {
    dimensionText = formatDimNumber(measurement);
  }

  if (!dimensionText) return null;

  const textHeight = entity.textHeight || dv.textHeight;
  const objects: THREE.Object3D[] = [];
  const material = new THREE.LineBasicMaterial({ color });

  // Create text mesh first to determine actual width for leader endpoint
  let actualTextWidth = 0;
  if (textPos) {
    actualTextWidth = measureDimensionTextWidth(font!, dimensionText, textHeight);
    addDimensionTextToCollector({
      collector: collector!, layer: layer!, color, font: font!, rawText: dimensionText, height: textHeight,
      posX: textPos.x, posY: textPos.y, posZ: 0.2, transform,
    });
  }

  // X-ordinate (bit 0 set in dimensionType) or Y-ordinate (bit 0 clear)
  const isXOrdinate = ((entity.dimensionType ?? 0) & 1) !== 0;

  const featureVec = new THREE.Vector3(feature.x, feature.y, 0);
  const leaderVec = new THREE.Vector3(leader.x, leader.y, 0);

  if (!isXOrdinate) {
    // Y-ordinate: horizontal leader (measures Y coordinate)
    const dy = leader.y - feature.y;

    if (Math.abs(dy) < EPSILON) {
      const endX = textPos ? textPos.x + actualTextWidth / 2 : leader.x;
      const points = [featureVec, new THREE.Vector3(Math.max(leader.x, endX), leader.y, 0)];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      objects.push(new THREE.Line(geometry, material));
    } else {
      // Dog-leg: diagonal offset = abs(dy)/2 (~63 degree angle)
      const diagDx = Math.abs(dy) / 2;
      const dirX = leader.x - feature.x !== 0 ? Math.sign(leader.x - feature.x) : 1;
      let kneeX = leader.x - dirX * diagDx;

      // Clamp knee so it doesn't extend beyond feature point
      if (dirX > 0) {
        kneeX = Math.max(kneeX, feature.x);
      } else {
        kneeX = Math.min(kneeX, feature.x);
      }

      const kneeVec = new THREE.Vector3(kneeX, feature.y, 0);

      if (Math.abs(kneeX - feature.x) > EPSILON) {
        const geom1 = new THREE.BufferGeometry().setFromPoints([featureVec, kneeVec]);
        objects.push(new THREE.Line(geom1, material));
      }

      const geom2 = new THREE.BufferGeometry().setFromPoints([kneeVec, leaderVec]);
      objects.push(new THREE.Line(geom2, material));

      const textEndX = textPos ? textPos.x + actualTextWidth / 2 : leader.x;
      if (Math.abs(textEndX - leader.x) > EPSILON && dirX * (textEndX - leader.x) > 0) {
        const geom3 = new THREE.BufferGeometry().setFromPoints([
          leaderVec,
          new THREE.Vector3(textEndX, leader.y, 0),
        ]);
        objects.push(new THREE.Line(geom3, material));
      }
    }
  } else {
    // X-ordinate: vertical leader (measures X coordinate)
    const dx = leader.x - feature.x;

    if (Math.abs(dx) < EPSILON) {
      const endY = textPos ? textPos.y + actualTextWidth / 2 : leader.y;
      const points = [featureVec, new THREE.Vector3(leader.x, Math.max(leader.y, endY), 0)];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      objects.push(new THREE.Line(geometry, material));
    } else {
      const diagDy = Math.abs(dx) / 2;
      const dirY = leader.y - feature.y !== 0 ? Math.sign(leader.y - feature.y) : 1;
      let kneeY = leader.y - dirY * diagDy;

      if (dirY > 0) {
        kneeY = Math.max(kneeY, feature.y);
      } else {
        kneeY = Math.min(kneeY, feature.y);
      }

      const kneeVec = new THREE.Vector3(feature.x, kneeY, 0);

      if (Math.abs(kneeY - feature.y) > EPSILON) {
        const geom1 = new THREE.BufferGeometry().setFromPoints([featureVec, kneeVec]);
        objects.push(new THREE.Line(geom1, material));
      }

      const geom2 = new THREE.BufferGeometry().setFromPoints([kneeVec, leaderVec]);
      objects.push(new THREE.Line(geom2, material));

      const textEndY = textPos ? textPos.y + actualTextWidth / 2 : leader.y;
      if (Math.abs(textEndY - leader.y) > EPSILON && dirY * (textEndY - leader.y) > 0) {
        const geom3 = new THREE.BufferGeometry().setFromPoints([
          leaderVec,
          new THREE.Vector3(leader.x, textEndY, 0),
        ]);
        objects.push(new THREE.Line(geom3, material));
      }
    }
  }

  return objects.length > 0 ? objects : null;
};

/**
 * Create a radial dimension (type 4).
 * Line from text edge to the point on the arc, arrow pointing outward at the arc.
 */
export const createRadialDimension = (p: DimensionTypeParams): THREE.Object3D[] | null => {
  const { entity, color, font, collector, layer, transform, dv = DEFAULT_DIM_VARS } = p;
  const center = entity.anchorPoint; // code 10
  const arcPt = entity.diameterOrRadiusPoint; // code 15
  const textPos = entity.middleOfText; // code 11

  if (!center || !arcPt) return null;

  let dimensionText = entity.text;
  // Fallback: compute radius from coordinates if actualMeasurement is absent
  const measurement = entity.actualMeasurement ??
    Math.sqrt((center.x - arcPt.x) ** 2 + (center.y - arcPt.y) ** 2);

  if (dimensionText) {
    const measStr = "R" + formatDimNumber(measurement);
    dimensionText = dimensionText.replace(/<>/g, measStr);
  }

  if (!dimensionText) {
    dimensionText = "R" + formatDimNumber(measurement);
  }

  const textHeight = entity.textHeight || dv.textHeight;
  const objects: THREE.Object3D[] = [];
  const lineMat = new THREE.LineBasicMaterial({ color });
  const arrowMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });

  const arcVec = new THREE.Vector3(arcPt.x, arcPt.y, 0);

  // Direction from arcPt toward center (inward)
  const dx = center.x - arcPt.x;
  const dy = center.y - arcPt.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const dirX = len > EPSILON ? dx / len : 1;
  const dirY = len > EPSILON ? dy / len : 0;

  // tailEndPoint determines arrow direction (from tail toward arc point)
  let tailEndPoint: THREE.Vector3 | null = null;

  if (textPos) {
    // textPos is the middle of text per DXF spec ("middle point of dimension text")
    // Underline Y for leader geometry: bottom of text area
    const underlineY = textPos.y - textHeight / 2;

    // Compute where the leader line intersects the text underline horizontal
    let intersectX = textPos.x;
    if (Math.abs(dirY) > EPSILON) {
      const t = (underlineY - arcPt.y) / dirY;
      intersectX = arcPt.x + t * dirX;
    }

    const textWidth = measureDimensionTextWidth(font!, dimensionText, textHeight);
    addDimensionTextToCollector({
      collector: collector!, layer: layer!, color, font: font!, rawText: dimensionText, height: textHeight,
      posX: textPos.x, posY: textPos.y, posZ: 0.2, transform,
    });

    const textLeft = textPos.x - textWidth / 2;
    const textRight = textPos.x + textWidth / 2;

    // Leader line from arc point to text underline
    tailEndPoint = new THREE.Vector3(intersectX, underlineY, 0);
    const tailGeom = new THREE.BufferGeometry().setFromPoints([arcVec, tailEndPoint]);
    objects.push(new THREE.Line(tailGeom, lineMat));

    // Underline extends from leader intersection to far text edge
    const underlineLeft = intersectX <= textPos.x ? intersectX : textLeft;
    const underlineRight = intersectX <= textPos.x ? textRight : intersectX;
    const underlineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(underlineLeft, underlineY, 0),
      new THREE.Vector3(underlineRight, underlineY, 0),
    ]);
    objects.push(new THREE.Line(underlineGeom, lineMat));
  }

  // Arrow at arc point, directed from the line origin (tail or center) toward the arc
  const arrowFrom = tailEndPoint
    ? new THREE.Vector3(tailEndPoint.x, tailEndPoint.y, 0.1)
    : new THREE.Vector3(center.x, center.y, 0.1);
  const arrow = createArrow(
    arrowFrom,
    new THREE.Vector3(arcPt.x, arcPt.y, 0.1),
    dv.arrowSize,
    arrowMat,
  );
  objects.push(arrow);

  return objects.length > 0 ? objects : null;
};

/**
 * Create a diametric dimension (type 3).
 * Diameter line between two points on the circle with arrows on both ends.
 * Text can be along the line or offset with a leader.
 */
export const createDiametricDimension = (p: DimensionTypeParams): THREE.Object3D[] | null => {
  const { entity, color, font, collector, layer, transform, dv = DEFAULT_DIM_VARS } = p;
  const p10 = entity.anchorPoint; // code 10 -- first point on circle
  const p15 = entity.diameterOrRadiusPoint; // code 15 -- opposite point
  const textPos = entity.middleOfText; // code 11

  if (!p10 || !p15) return null;

  let dimensionText = entity.text;
  const measurement = entity.actualMeasurement ??
    Math.sqrt((p10.x - p15.x) ** 2 + (p10.y - p15.y) ** 2);

  if (dimensionText) {
    dimensionText = dimensionText.replace(/<>/g, formatDimNumber(measurement));
  }

  if (!dimensionText) {
    dimensionText = formatDimNumber(measurement);
  }

  const textHeight = entity.textHeight || dv.textHeight;
  const objects: THREE.Object3D[] = [];
  const lineMat = new THREE.LineBasicMaterial({ color });
  const arrowMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });

  const cx = (p10.x + p15.x) / 2;
  const cy = (p10.y + p15.y) / 2;

  const dx10 = cx - p10.x;
  const dy10 = cy - p10.y;
  const len10 = Math.sqrt(dx10 * dx10 + dy10 * dy10);
  const dir10x = len10 > EPSILON ? dx10 / len10 : 1;
  const dir10y = len10 > EPSILON ? dy10 / len10 : 0;

  // Determine if text sits on the diameter line (within textHeight perpendicular distance
  // and between endpoints). This controls arrow direction: outward when text is inside,
  // inward when text is offset outside.
  let textOnLine = false;
  if (textPos) {
    const fullLen = len10 * 2;
    if (fullLen > EPSILON) {
      const ldx = (p10.x - p15.x) / fullLen;
      const ldy = (p10.y - p15.y) / fullLen;
      const t = ((textPos.x - p15.x) * ldx + (textPos.y - p15.y) * ldy) / fullLen;
      const perpDist = Math.abs(-(textPos.x - p15.x) * ldy + (textPos.y - p15.y) * ldx);
      textOnLine = perpDist < textHeight && t >= 0 && t <= 1;
    }
  }

  // Arrow direction: outward (from center) when text inside, inward when text offset
  const arrowSign = textOnLine ? 1 : -1;
  const arrow10From = new THREE.Vector3(
    p10.x + arrowSign * dir10x * dv.arrowSize,
    p10.y + arrowSign * dir10y * dv.arrowSize,
    0.1,
  );
  objects.push(
    createArrow(arrow10From, new THREE.Vector3(p10.x, p10.y, 0.1), dv.arrowSize, arrowMat),
  );
  const arrow15From = new THREE.Vector3(
    p15.x - arrowSign * dir10x * dv.arrowSize,
    p15.y - arrowSign * dir10y * dv.arrowSize,
    0.1,
  );
  objects.push(
    createArrow(arrow15From, new THREE.Vector3(p15.x, p15.y, 0.1), dv.arrowSize, arrowMat),
  );

  const diamLineGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(p15.x, p15.y, 0),
    new THREE.Vector3(p10.x, p10.y, 0),
  ]);
  objects.push(new THREE.Line(diamLineGeom, lineMat));

  if (textPos && textOnLine) {
    // Text along diameter line -- rotated to match line angle
    let angle = Math.atan2(p10.y - p15.y, p10.x - p15.x);
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;
    addDimensionTextToCollector({
      collector: collector!, layer: layer!, color, font: font!, rawText: dimensionText, height: textHeight,
      posX: textPos.x, posY: textPos.y, posZ: 0.2, rotation: angle, transform,
    });
  } else if (textPos) {
    // Text offset outside -- leader from nearest line end toward text
    const dist10 = (textPos.x - p10.x) ** 2 + (textPos.y - p10.y) ** 2;
    const dist15 = (textPos.x - p15.x) ** 2 + (textPos.y - p15.y) ** 2;
    const nearPt = dist10 <= dist15 ? p10 : p15;
    const dxN = cx - nearPt.x;
    const dyN = cy - nearPt.y;
    const lenN = Math.sqrt(dxN * dxN + dyN * dyN);
    const dirNx = lenN > EPSILON ? dxN / lenN : 1;
    const dirNy = lenN > EPSILON ? dyN / lenN : 0;

    // Underline Y for leader geometry: bottom of text area
    const underlineY = textPos.y - textHeight / 2;

    let intersectX = textPos.x;
    if (Math.abs(dirNy) > EPSILON) {
      const t = (underlineY - nearPt.y) / dirNy;
      intersectX = nearPt.x + t * dirNx;
    }

    const textWidth = measureDimensionTextWidth(font!, dimensionText, textHeight);
    addDimensionTextToCollector({
      collector: collector!, layer: layer!, color, font: font!, rawText: dimensionText, height: textHeight,
      posX: textPos.x, posY: textPos.y, posZ: 0.2, transform,
    });

    const textLeft = textPos.x - textWidth / 2;
    const textRight = textPos.x + textWidth / 2;

    const nearVec = new THREE.Vector3(nearPt.x, nearPt.y, 0);
    const tailEnd = new THREE.Vector3(intersectX, underlineY, 0);
    const tailGeom = new THREE.BufferGeometry().setFromPoints([nearVec, tailEnd]);
    objects.push(new THREE.Line(tailGeom, lineMat));

    const underlineLeft = intersectX <= textPos.x ? intersectX : textLeft;
    const underlineRight = intersectX <= textPos.x ? textRight : intersectX;
    const underlineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(underlineLeft, underlineY, 0),
      new THREE.Vector3(underlineRight, underlineY, 0),
    ]);
    objects.push(new THREE.Line(underlineGeom, lineMat));
  } else {
    const diamLineGeom2 = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(p15.x, p15.y, 0),
      new THREE.Vector3(p10.x, p10.y, 0),
    ]);
    objects.push(new THREE.Line(diamLineGeom2, lineMat));
    addDimensionTextToCollector({
      collector: collector!, layer: layer!, color, font: font!, rawText: dimensionText, height: textHeight,
      posX: cx, posY: cy, posZ: 0.2, transform,
    });
  }

  return objects.length > 0 ? objects : null;
};

/**
 * Compute intersection of two infinite lines (2D).
 * Returns null if lines are parallel.
 */
export const intersectLines2D = (a: Line2D, b: Line2D): { x: number; y: number } | null => {
  const d1x = a.x2 - a.x1;
  const d1y = a.y2 - a.y1;
  const d2x = b.x2 - b.x1;
  const d2y = b.y2 - b.y1;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < EPSILON) return null;
  const t = ((b.x1 - a.x1) * d2y - (b.y1 - a.y1) * d2x) / denom;
  return { x: a.x1 + t * d1x, y: a.y1 + t * d1y };
};

/** Normalize angle to [0, 2pi) */
export const normalizeAngle = (a: number): number => {
  const TWO_PI = Math.PI * 2;
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
};

/** Check whether testAngle lies within the CCW arc from startAngle to endAngle. */
export const isAngleInSweep = (startAngle: number, endAngle: number, testAngle: number): boolean => {
  const s = normalizeAngle(startAngle);
  const e = normalizeAngle(endAngle);
  const t = normalizeAngle(testAngle);
  if (s < e) {
    return t >= s && t <= e;
  }
  // Arc crosses 0
  return t >= s || t <= e;
};

/**
 * Create an angular dimension (type 2).
 * Arc between two rays with extension lines, arrows, and angle text in degrees.
 */
export const createAngularDimension = (p: DimensionTypeParams): THREE.Object3D[] | null => {
  const { entity, color, font, collector, layer, transform, dv = DEFAULT_DIM_VARS } = p;
  const p13 = entity.linearOrAngularPoint1; // code 13 -- end 1 of first line
  const p14 = entity.linearOrAngularPoint2; // code 14 -- end 2 of first line
  const p15 = entity.diameterOrRadiusPoint; // code 15 -- end 1 of second line
  const p10 = entity.anchorPoint; // code 10 -- end 2 of second line
  const p16 = entity.arcPoint; // code 16 -- point on arc (defines radius)
  const textPos = entity.middleOfText; // code 11

  if (!p13 || !p14 || !p15 || !p10) return null;

  // Find the angle vertex (intersection of the two lines)
  let vertex: { x: number; y: number };
  const dist14_15 = Math.sqrt((p14.x - p15.x) ** 2 + (p14.y - p15.y) ** 2);
  if (dist14_15 < EPSILON) {
    // Lines converge at the same point
    vertex = { x: p14.x, y: p14.y };
  } else {
    const v = intersectLines2D(
      { x1: p13.x, y1: p13.y, x2: p14.x, y2: p14.y },
      { x1: p15.x, y1: p15.y, x2: p10.x, y2: p10.y },
    );
    if (!v) return null; // Parallel lines
    vertex = v;
  }

  // Compute angles and distances from vertex to all 4 endpoints
  const rays = [
    { angle: Math.atan2(p13.y - vertex.y, p13.x - vertex.x), pt: p13, line: 1 as const,
      dist: Math.sqrt((p13.x - vertex.x) ** 2 + (p13.y - vertex.y) ** 2) },
    { angle: Math.atan2(p14.y - vertex.y, p14.x - vertex.x), pt: p14, line: 1 as const,
      dist: Math.sqrt((p14.x - vertex.x) ** 2 + (p14.y - vertex.y) ** 2) },
    { angle: Math.atan2(p15.y - vertex.y, p15.x - vertex.x), pt: p15, line: 2 as const,
      dist: Math.sqrt((p15.x - vertex.x) ** 2 + (p15.y - vertex.y) ** 2) },
    { angle: Math.atan2(p10.y - vertex.y, p10.x - vertex.x), pt: p10, line: 2 as const,
      dist: Math.sqrt((p10.x - vertex.x) ** 2 + (p10.y - vertex.y) ** 2) },
  ];

  const radius = p16
    ? Math.sqrt((p16.x - vertex.x) ** 2 + (p16.y - vertex.y) ** 2)
    : Math.max(...rays.map(r => r.dist)) * 0.8;

  if (radius < EPSILON) return null;

  // Determine start/end angles and extension line endpoints.
  // Two lines through the vertex create 4 sectors; arcPoint (p16) selects the correct one.
  let startAngle = 0;
  let endAngle = 0;
  let extPtStart: DxfVertex = p13;
  let extPtEnd: DxfVertex = p10;

  if (p16) {
    const arcAngle = Math.atan2(p16.y - vertex.y, p16.x - vertex.x);

    // Filter out degenerate rays (endpoint coincides with vertex)
    const validRays = rays.filter(r => r.dist > EPSILON);

    // Sort rays by normalized angle to identify sectors
    const sorted = validRays
      .map(r => ({ ...r, normAngle: normalizeAngle(r.angle) }))
      .sort((a, b) => a.normAngle - b.normAngle);

    // Find the sector between rays from different lines that contains arcAngle
    const n = sorted.length;
    let found = false;
    for (let i = 0; i < n; i++) {
      const r1 = sorted[i];
      const r2 = sorted[(i + 1) % n];
      if (r1.line === r2.line) continue;

      if (isAngleInSweep(r1.angle, r2.angle, arcAngle)) {
        startAngle = r1.angle;
        endAngle = r2.angle;
        extPtStart = r1.pt;
        extPtEnd = r2.pt;
        found = true;
        break;
      }
    }

    if (!found) {
      // Fallback: use farthest endpoints with original sweep direction logic
      const farA = rays[0].dist >= rays[1].dist ? rays[0] : rays[1];
      const farB = rays[2].dist >= rays[3].dist ? rays[2] : rays[3];
      if (isAngleInSweep(farA.angle, farB.angle, arcAngle)) {
        startAngle = farA.angle;
        endAngle = farB.angle;
        extPtStart = farA.pt;
        extPtEnd = farB.pt;
      } else {
        startAngle = farB.angle;
        endAngle = farA.angle;
        extPtStart = farB.pt;
        extPtEnd = farA.pt;
      }
    }
  } else {
    // No arcPoint: use farthest endpoints
    const farA = rays[0].dist >= rays[1].dist ? rays[0] : rays[1];
    const farB = rays[2].dist >= rays[3].dist ? rays[2] : rays[3];
    startAngle = farA.angle;
    endAngle = farB.angle;
    extPtStart = farA.pt;
    extPtEnd = farB.pt;
  }

  // Always CCW sweep
  let sweep = normalizeAngle(endAngle - startAngle);
  if (sweep < EPSILON) sweep = Math.PI * 2;

  const objects: THREE.Object3D[] = [];
  const lineMat = new THREE.LineBasicMaterial({ color });
  const dashedMat = new THREE.LineDashedMaterial({
    color,
    dashSize: dv.extLineDash,
    gapSize: dv.extLineGap,
  });
  const arrowMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });

  const segments = Math.max(MIN_ARC_SEGMENTS, Math.floor((sweep * CIRCLE_SEGMENTS) / (Math.PI * 2)));
  const arcPoints: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = startAngle + (i / segments) * sweep;
    arcPoints.push(
      new THREE.Vector3(vertex.x + radius * Math.cos(a), vertex.y + radius * Math.sin(a), 0),
    );
  }
  const arcGeom = new THREE.BufferGeometry().setFromPoints(arcPoints);
  objects.push(new THREE.Line(arcGeom, lineMat));

  // Extension lines from ray endpoints to points on the arc
  const arcStartPt = new THREE.Vector3(
    vertex.x + radius * Math.cos(startAngle),
    vertex.y + radius * Math.sin(startAngle),
    0,
  );
  const arcEndPt = new THREE.Vector3(
    vertex.x + radius * Math.cos(endAngle),
    vertex.y + radius * Math.sin(endAngle),
    0,
  );

  const extLineA = createExtensionLine(
    new THREE.Vector3(extPtStart.x, extPtStart.y, 0),
    arcStartPt,
    dashedMat,
    dv.extLineExtension,
  );
  objects.push(extLineA);

  const extLineB = createExtensionLine(
    new THREE.Vector3(extPtEnd.x, extPtEnd.y, 0),
    arcEndPt,
    dashedMat,
    dv.extLineExtension,
  );
  objects.push(extLineB);

  // Arrows follow arc curvature (chord direction, not pure tangent)
  const arrowArcAngle = dv.arrowSize / radius;

  const innerStartA = startAngle + arrowArcAngle;
  const arrowStartFrom = new THREE.Vector3(
    vertex.x + radius * Math.cos(innerStartA),
    vertex.y + radius * Math.sin(innerStartA),
    0.1,
  );
  objects.push(createArrow(arrowStartFrom, new THREE.Vector3(arcStartPt.x, arcStartPt.y, 0.1), dv.arrowSize, arrowMat));

  const innerEndA = endAngle - arrowArcAngle;
  const arrowEndFrom = new THREE.Vector3(
    vertex.x + radius * Math.cos(innerEndA),
    vertex.y + radius * Math.sin(innerEndA),
    0.1,
  );
  objects.push(createArrow(arrowEndFrom, new THREE.Vector3(arcEndPt.x, arcEndPt.y, 0.1), dv.arrowSize, arrowMat));

  let dimensionText = entity.text;
  const measurement = entity.actualMeasurement;

  // Angular measurement is stored in radians; convert to degrees for display
  if (typeof measurement === "number") {
    const degrees = (measurement * DEGREES_TO_RADIANS_DIVISOR) / Math.PI;
    const measStr = formatDimNumber(degrees) + "\u00B0";
    if (dimensionText) {
      dimensionText = dimensionText.replace(/<>/g, measStr);
    } else {
      dimensionText = measStr;
    }
  }

  if (dimensionText) {
    const textHeight = entity.textHeight || dv.textHeight;

    let textAngle: number;
    let textX: number;
    let textY: number;

    if (textPos) {
      textX = textPos.x;
      textY = textPos.y;
      textAngle = Math.atan2(textPos.y - vertex.y, textPos.x - vertex.x);
    } else {
      // Default: place text at arc midpoint, offset outward
      const midAngle = startAngle + sweep / 2;
      const textRadius = radius + textHeight * 0.8;
      textX = vertex.x + textRadius * Math.cos(midAngle);
      textY = vertex.y + textRadius * Math.sin(midAngle);
      textAngle = midAngle;
    }

    // Rotate text along arc tangent (perpendicular to radius), keep it readable
    let textRotation = textAngle + Math.PI / 2;
    const norm = normalizeAngle(textRotation);
    if (norm > Math.PI / 2 && norm < Math.PI * 1.5) {
      textRotation += Math.PI;
    }

    addDimensionTextToCollector({
      collector: collector!, layer: layer!, color, font: font!, rawText: dimensionText, height: textHeight,
      posX: textX, posY: textY, posZ: 0.2, rotation: textRotation, transform,
    });
  }

  return objects.length > 0 ? objects : null;
};
