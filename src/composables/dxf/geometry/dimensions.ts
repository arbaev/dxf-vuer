import * as THREE from "three";
import type { DxfVertex, DxfDimensionEntity } from "@/types/dxf";
import {
  DIM_TEXT_HEIGHT,
  DIM_TEXT_GAP,
  DIM_TEXT_DECIMAL_PLACES,
  ARROW_SIZE,
  EXTENSION_LINE_DASH_SIZE,
  EXTENSION_LINE_GAP_SIZE,
  DEGREES_TO_RADIANS_DIVISOR,
  EPSILON,
  TEXT_HEIGHT,
  CIRCLE_SEGMENTS,
  MIN_ARC_SEGMENTS,
} from "@/constants";
import { createArrow } from "./primitives";
import { replaceSpecialChars } from "./text";

export const EXTENSION_LINE_OVERSHOOT = 2;

export const createExtensionLine = (
  from: THREE.Vector3,
  to: THREE.Vector3,
  material: THREE.LineBasicMaterial | THREE.LineDashedMaterial,
): THREE.Line => {
  // Dashed extension lines extend beyond the dimension line per AutoCAD convention
  let endPoint = to;
  if (material instanceof THREE.LineDashedMaterial) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > EPSILON) {
      endPoint = new THREE.Vector3(
        to.x + (dx / len) * EXTENSION_LINE_OVERSHOOT,
        to.y + (dy / len) * EXTENSION_LINE_OVERSHOOT,
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

export const createLinearDimensionLines = (
  point1: DxfVertex,
  point2: DxfVertex,
  anchorPoint: DxfVertex,
  textPos: DxfVertex | undefined,
  dimLineMaterial: THREE.LineBasicMaterial,
  extensionLineMaterial: THREE.LineDashedMaterial,
  arrowMaterial: THREE.MeshBasicMaterial,
  isHorizontal: boolean,
): THREE.Object3D[] => {
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
    const gapStart = getMainCoord(textPos) - DIM_TEXT_GAP / 2;
    const gapEnd = getMainCoord(textPos) + DIM_TEXT_GAP / 2;

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
      ),
    );
  }
  if (Math.abs(getFixedCoord(point2) - anchorFixed) > 0.1) {
    objects.push(
      createExtensionLine(
        createVec3(getMainCoord(point2), getFixedCoord(point2), 0),
        createVec3(getMainCoord(point2), anchorFixed, 0),
        extensionLineMaterial,
      ),
    );
  }

  const arrow1 = createArrow(
    createVec3(max, anchorFixed, 0.1),
    createVec3(min, anchorFixed, 0.1),
    ARROW_SIZE,
    arrowMaterial,
  );
  objects.push(arrow1);

  const arrow2 = createArrow(
    createVec3(min, anchorFixed, 0.1),
    createVec3(max, anchorFixed, 0.1),
    ARROW_SIZE,
    arrowMaterial,
  );
  objects.push(arrow2);

  return objects;
};

/**
 * Create lines and arrows for a rotated dimension (arbitrary angle).
 * Projects measurement points onto the dimension line via dot product.
 */
export const createRotatedDimensionLines = (
  point1: DxfVertex,
  point2: DxfVertex,
  anchorPoint: DxfVertex,
  textPos: DxfVertex | undefined,
  dimLineMaterial: THREE.LineBasicMaterial,
  extensionLineMaterial: THREE.LineDashedMaterial,
  arrowMaterial: THREE.MeshBasicMaterial,
  angleRad: number,
): THREE.Object3D[] => {
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
      const gapStart = tText - DIM_TEXT_GAP / 2;
      const gapEnd = tText + DIM_TEXT_GAP / 2;

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
    objects.push(createExtensionLine(p1, foot1, extensionLineMaterial));
  }
  if (p2.distanceTo(foot2) > 0.1) {
    objects.push(createExtensionLine(p2, foot2, extensionLineMaterial));
  }

  objects.push(
    createArrow(
      new THREE.Vector3(maxPt.x, maxPt.y, 0.1),
      new THREE.Vector3(minPt.x, minPt.y, 0.1),
      ARROW_SIZE,
      arrowMaterial,
    ),
  );
  objects.push(
    createArrow(
      new THREE.Vector3(minPt.x, minPt.y, 0.1),
      new THREE.Vector3(maxPt.x, maxPt.y, 0.1),
      ARROW_SIZE,
      arrowMaterial,
    ),
  );

  return objects;
};

export const extractDimensionData = (entity: DxfDimensionEntity) => {
  let point1 = entity.linearOrAngularPoint1;
  let point2 = entity.linearOrAngularPoint2;
  const anchorPoint = entity.anchorPoint;
  const diameterOrRadiusPoint = entity.diameterOrRadiusPoint;
  const textPos = entity.middleOfText;
  const angle = entity.angle || 0;
  let dimensionText = entity.text;
  let isRadial = false;

  // Detect radial dimension BEFORE generating text to add "R" prefix
  if (!point1 && !point2 && diameterOrRadiusPoint && anchorPoint) {
    point1 = diameterOrRadiusPoint;
    point2 = anchorPoint;
    isRadial = true;
  }

  // Replace <> placeholder with actual measurement (AutoCAD convention)
  if (dimensionText && typeof entity.actualMeasurement === "number") {
    const measStr =
      (isRadial ? "R" : "") + formatDimNumber(entity.actualMeasurement);
    dimensionText = dimensionText.replace(/<>/g, measStr);
  }

  if (!dimensionText && typeof entity.actualMeasurement === "number") {
    dimensionText =
      (isRadial ? "R" : "") + formatDimNumber(entity.actualMeasurement);
  }

  // Fallback: compute measurement from point coordinates
  if (!dimensionText && point1 && point2) {
    const dx = point2.x - point1.x;
    const dy = point2.y - point1.y;
    const dz = (point2.z || 0) - (point1.z || 0);
    const measurement = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dimensionText = (isRadial ? "R" : "") + formatDimNumber(measurement);
  }

  if (!isRadial && dimensionText && !isNaN(parseFloat(dimensionText))) {
    dimensionText = formatDimNumber(parseFloat(dimensionText));
  }

  if (!point1 || !point2 || !anchorPoint || !dimensionText) {
    return null;
  }
  const textHeight = entity.textHeight || DIM_TEXT_HEIGHT;

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

export const createDimensionGroup = (
  point1: DxfVertex,
  point2: DxfVertex,
  anchorPoint: DxfVertex,
  textPos: DxfVertex | undefined,
  _textHeight: number,
  isRadial: boolean,
  color: string,
  angle: number = 0,
): THREE.Group => {
  const dimGroup = new THREE.Group();

  const dimLineMaterial = new THREE.LineBasicMaterial({ color });
  const extensionLineMaterial = new THREE.LineDashedMaterial({
    color,
    dashSize: EXTENSION_LINE_DASH_SIZE,
    gapSize: EXTENSION_LINE_GAP_SIZE,
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
      ARROW_SIZE,
      arrowMaterial,
    );
    dimGroup.add(arrow);

    return dimGroup;
  }

  let dimensionObjects: THREE.Object3D[];

  if (angle !== 0) {
    const angleRad = (angle * Math.PI) / DEGREES_TO_RADIANS_DIVISOR;
    dimensionObjects = createRotatedDimensionLines(
      point1,
      point2,
      anchorPoint,
      textPos,
      dimLineMaterial,
      extensionLineMaterial,
      arrowMaterial,
      angleRad,
    );
  } else {
    // Determine orientation by comparing point spread in X vs Y
    const spreadX = Math.abs(point2.x - point1.x);
    const spreadY = Math.abs(point2.y - point1.y);
    const isHorizontal = spreadX >= spreadY;

    dimensionObjects = createLinearDimensionLines(
      point1,
      point2,
      anchorPoint,
      textPos,
      dimLineMaterial,
      extensionLineMaterial,
      arrowMaterial,
      isHorizontal,
    );
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
 * Create a text mesh for a dimension with stacked text (\S) support.
 * \S format: \Stop^bottom; -- renders "top" as superscript and "bottom" as subscript.
 * Text baseline aligns with mesh position (drawn at bottom edge of canvas).
 */
export const createDimensionTextMesh = (
  rawText: string,
  height: number,
  color: string,
  hAlign: "left" | "center" | "right" = "center",
): THREE.Mesh => {
  const cleaned = cleanDimensionMText(rawText);

  const stackedMatch = cleaned.match(/^(.*?)\\S([^^/;]*)\^([^;]*);(.*)$/);

  const CANVAS_SCALE = 10;
  const PADDING = 4;
  const STACKED_RATIO = 0.6;
  const STACKED_GAP = 2;
  const STACKED_V_GAP = 4;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;

  const mainFontSize = Math.max(height * CANVAS_SCALE, TEXT_HEIGHT);
  const DIM_FONT = `"Cascadia Code", "Consolas", "Liberation Mono", monospace`;
  const mainFont = `100 ${mainFontSize}px ${DIM_FONT}`;

  // Reference height for font size normalization (keeps dimensions consistent with createTextMesh)
  const refCanvasHeight = Math.ceil(mainFontSize * 1.2) + PADDING * 2;

  if (!stackedMatch) {
    const plain = cleaned.replace(/\\S[^;]*;/g, "").trim();

    context.font = mainFont;
    const metrics = context.measureText(plain);
    const ascent = metrics.actualBoundingBoxAscent ?? mainFontSize * 0.8;
    const descent = metrics.actualBoundingBoxDescent ?? mainFontSize * 0.05;

    const canvasWidth = Math.ceil(metrics.width) + PADDING * 2;
    const canvasHeight = Math.ceil(ascent + descent) + PADDING * 2;

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    context.font = mainFont;
    context.fillStyle = color;
    context.textBaseline = "alphabetic";
    context.fillText(plain, PADDING, PADDING + Math.ceil(ascent));

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });

    // Normalize mesh height by reference canvas so font matches createTextMesh sizing
    const meshHeight = (height * canvasHeight) / refCanvasHeight;
    const aspectRatio = canvasWidth / canvasHeight;
    const meshWidth = meshHeight * aspectRatio;
    const geometry = new THREE.PlaneGeometry(meshWidth, meshHeight);

    // Offset baseline slightly above textPos.y to leave room for descenders
    const baselineGap = height * 0.15;
    const bottomPaddingFrac = (PADDING - Math.ceil(descent)) / canvasHeight;
    const tx = hAlign === "left" ? meshWidth / 2 : hAlign === "right" ? -meshWidth / 2 : 0;
    geometry.translate(
      tx,
      meshHeight / 2 - meshHeight * Math.max(0, bottomPaddingFrac) + baselineGap,
      0,
    );

    return new THREE.Mesh(geometry, material);
  }

  // Stacked text: prefix + superscript/subscript pair
  const mainText = stackedMatch[1].trim();
  const topText = stackedMatch[2].trim();
  const bottomText = stackedMatch[3].trim();

  const stackedFontSize = mainFontSize * STACKED_RATIO;
  const stackedFont = `100 ${stackedFontSize}px ${DIM_FONT}`;

  context.font = mainFont;
  const mainMetrics = mainText ? context.measureText(mainText) : null;
  const mainWidth = mainMetrics ? mainMetrics.width : 0;
  const mainAscent = mainMetrics?.actualBoundingBoxAscent ?? mainFontSize * 0.8;
  const mainDescent = mainMetrics?.actualBoundingBoxDescent ?? mainFontSize * 0.05;

  context.font = stackedFont;
  const topWidth = topText ? context.measureText(topText).width : 0;
  const bottomWidth = bottomText ? context.measureText(bottomText).width : 0;
  const stackedMaxWidth = Math.max(topWidth, bottomWidth);
  const topMetricsSt = topText ? context.measureText(topText) : null;
  const topAscentSt = topMetricsSt?.actualBoundingBoxAscent ?? stackedFontSize * 0.8;
  const topDescentSt = topMetricsSt?.actualBoundingBoxDescent ?? stackedFontSize * 0.05;
  const subMetrics = bottomText ? context.measureText(bottomText) : null;
  const subAscent = subMetrics?.actualBoundingBoxAscent ?? stackedFontSize * 0.8;
  const subDescent = subMetrics?.actualBoundingBoxDescent ?? stackedFontSize * 0.05;

  // Center stacked text on the visual center of main text glyphs
  const mainCenterAboveBaseline = mainAscent / 2;

  const halfVGap = STACKED_V_GAP / 2;
  const topExtent = Math.max(
    mainAscent,
    mainCenterAboveBaseline + halfVGap + topAscentSt + topDescentSt,
  );
  const bottomExtent = Math.max(
    mainDescent,
    subAscent + subDescent + halfVGap - mainCenterAboveBaseline,
  );

  const gap = mainText ? STACKED_GAP : 0;
  const totalWidth = mainWidth + gap + stackedMaxWidth;
  const canvasWidth = Math.ceil(totalWidth) + PADDING * 2;
  const canvasHeight = Math.ceil(topExtent + bottomExtent) + PADDING * 2;

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  context.fillStyle = color;

  // Baseline position: leave room above for superscript
  const baselineY = PADDING + Math.ceil(topExtent);
  // Visual center of main text -- split point between super/subscript
  const stackedCenterY = baselineY - mainCenterAboveBaseline;

  if (mainText) {
    context.font = mainFont;
    context.textBaseline = "alphabetic";
    context.fillText(mainText, PADDING, baselineY);
  }

  const stackedX = PADDING + mainWidth + gap;
  context.font = stackedFont;

  if (topText) {
    context.textBaseline = "alphabetic";
    context.fillText(topText, stackedX, stackedCenterY - halfVGap - topDescentSt);
  }

  if (bottomText) {
    context.textBaseline = "alphabetic";
    context.fillText(bottomText, stackedX, stackedCenterY + halfVGap + subAscent);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });

  const meshHeight = (height * canvasHeight) / refCanvasHeight;
  const aspectRatio = canvasWidth / canvasHeight;
  const meshWidth = meshHeight * aspectRatio;
  const geometry = new THREE.PlaneGeometry(meshWidth, meshHeight);

  const baselineGap = height * 0.15;
  const belowBaselineFrac = (Math.ceil(bottomExtent) + PADDING) / canvasHeight;
  const tx = hAlign === "left" ? meshWidth / 2 : hAlign === "right" ? -meshWidth / 2 : 0;
  geometry.translate(tx, meshHeight / 2 - meshHeight * belowBaselineFrac + baselineGap, 0);

  return new THREE.Mesh(geometry, material);
};

/**
 * Create an ordinate dimension (type 6/7).
 * Displays the X or Y coordinate of a point with a dog-leg leader.
 * No arrows or dashed lines -- solid lines only (per AutoCAD convention).
 */
export const createOrdinateDimension = (
  entity: DxfDimensionEntity,
  color: string,
): THREE.Object3D[] | null => {
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

  const textHeight = entity.textHeight || DIM_TEXT_HEIGHT;
  const objects: THREE.Object3D[] = [];
  const material = new THREE.LineBasicMaterial({ color });

  // Create text mesh first to determine actual width for leader endpoint
  let textMesh: THREE.Mesh | null = null;
  let actualTextWidth = 0;
  if (textPos) {
    textMesh = createDimensionTextMesh(dimensionText, textHeight, color, "center");
    textMesh.position.set(textPos.x, textPos.y - textHeight / 2, 0.2);
    textMesh.geometry.computeBoundingBox();
    const bbox = textMesh.geometry.boundingBox;
    if (bbox) {
      actualTextWidth = bbox.max.x - bbox.min.x;
    }
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

  if (textMesh) {
    objects.push(textMesh);
  }

  return objects.length > 0 ? objects : null;
};

/**
 * Create a radial dimension (type 4).
 * Line from text edge to the point on the arc, arrow pointing outward at the arc.
 */
export const createRadialDimension = (
  entity: DxfDimensionEntity,
  color: string,
): THREE.Object3D[] | null => {
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

  const textHeight = entity.textHeight || DIM_TEXT_HEIGHT;
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

  let textMesh: THREE.Mesh | null = null;
  if (textPos) {
    // textPos is the middle of text per DXF spec ("middle point of dimension text")
    const underlineY = textPos.y - textHeight / 2;

    // Compute where the leader line intersects the text underline horizontal
    let intersectX = textPos.x;
    if (Math.abs(dirY) > EPSILON) {
      const t = (underlineY - arcPt.y) / dirY;
      intersectX = arcPt.x + t * dirX;
    }

    textMesh = createDimensionTextMesh(dimensionText, textHeight, color, "center");
    textMesh.position.set(textPos.x, underlineY, 0.2);
    textMesh.geometry.computeBoundingBox();
    let textWidth = 0;
    const bbox = textMesh.geometry.boundingBox;
    if (bbox) {
      textWidth = bbox.max.x - bbox.min.x;
    }

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
    ARROW_SIZE,
    arrowMat,
  );
  objects.push(arrow);

  if (textMesh) {
    objects.push(textMesh);
  }

  return objects.length > 0 ? objects : null;
};

/**
 * Create a diametric dimension (type 3).
 * Diameter line between two points on the circle with arrows on both ends.
 * Text can be along the line or offset with a leader.
 */
export const createDiametricDimension = (
  entity: DxfDimensionEntity,
  color: string,
): THREE.Object3D[] | null => {
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

  const textHeight = entity.textHeight || DIM_TEXT_HEIGHT;
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
    p10.x + arrowSign * dir10x * ARROW_SIZE,
    p10.y + arrowSign * dir10y * ARROW_SIZE,
    0.1,
  );
  objects.push(
    createArrow(arrow10From, new THREE.Vector3(p10.x, p10.y, 0.1), ARROW_SIZE, arrowMat),
  );
  const arrow15From = new THREE.Vector3(
    p15.x - arrowSign * dir10x * ARROW_SIZE,
    p15.y - arrowSign * dir10y * ARROW_SIZE,
    0.1,
  );
  objects.push(
    createArrow(arrow15From, new THREE.Vector3(p15.x, p15.y, 0.1), ARROW_SIZE, arrowMat),
  );

  const diamLineGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(p15.x, p15.y, 0),
    new THREE.Vector3(p10.x, p10.y, 0),
  ]);
  objects.push(new THREE.Line(diamLineGeom, lineMat));

  let textMesh: THREE.Mesh | null = null;

  if (textPos && textOnLine) {
    // Text along diameter line -- rotated to match line angle
    textMesh = createDimensionTextMesh(dimensionText, textHeight, color, "center");
    // Keep text readable (not upside down)
    let angle = Math.atan2(p10.y - p15.y, p10.x - p15.x);
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;
    textMesh.position.set(textPos.x, textPos.y, 0.2);
    textMesh.rotation.z = angle;
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

    const underlineY = textPos.y - textHeight / 2;

    let intersectX = textPos.x;
    if (Math.abs(dirNy) > EPSILON) {
      const t = (underlineY - nearPt.y) / dirNy;
      intersectX = nearPt.x + t * dirNx;
    }

    textMesh = createDimensionTextMesh(dimensionText, textHeight, color, "center");
    textMesh.position.set(textPos.x, underlineY, 0.2);
    textMesh.geometry.computeBoundingBox();
    let textWidth = 0;
    const bbox = textMesh.geometry.boundingBox;
    if (bbox) {
      textWidth = bbox.max.x - bbox.min.x;
    }

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
    const diamLineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(p15.x, p15.y, 0),
      new THREE.Vector3(p10.x, p10.y, 0),
    ]);
    objects.push(new THREE.Line(diamLineGeom, lineMat));
    textMesh = createDimensionTextMesh(dimensionText, textHeight, color, "center");
    textMesh.position.set(cx, cy, 0.2);
  }

  if (textMesh) {
    objects.push(textMesh);
  }

  return objects.length > 0 ? objects : null;
};

/**
 * Compute intersection of two infinite lines (2D).
 * Returns null if lines are parallel.
 */
export const intersectLines2D = (
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  p3x: number,
  p3y: number,
  p4x: number,
  p4y: number,
): { x: number; y: number } | null => {
  const d1x = p2x - p1x;
  const d1y = p2y - p1y;
  const d2x = p4x - p3x;
  const d2y = p4y - p3y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < EPSILON) return null;
  const t = ((p3x - p1x) * d2y - (p3y - p1y) * d2x) / denom;
  return { x: p1x + t * d1x, y: p1y + t * d1y };
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
export const createAngularDimension = (
  entity: DxfDimensionEntity,
  color: string,
): THREE.Object3D[] | null => {
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
    const v = intersectLines2D(p13.x, p13.y, p14.x, p14.y, p15.x, p15.y, p10.x, p10.y);
    if (!v) return null; // Parallel lines
    vertex = v;
  }

  // Use the endpoint farthest from vertex on each line to determine ray directions
  const dist13 = Math.sqrt((p13.x - vertex.x) ** 2 + (p13.y - vertex.y) ** 2);
  const dist14 = Math.sqrt((p14.x - vertex.x) ** 2 + (p14.y - vertex.y) ** 2);
  const farA = dist13 >= dist14 ? p13 : p14;

  const dist15 = Math.sqrt((p15.x - vertex.x) ** 2 + (p15.y - vertex.y) ** 2);
  const dist10 = Math.sqrt((p10.x - vertex.x) ** 2 + (p10.y - vertex.y) ** 2);
  const farB = dist15 >= dist10 ? p15 : p10;

  const angleA = Math.atan2(farA.y - vertex.y, farA.x - vertex.x);
  const angleB = Math.atan2(farB.y - vertex.y, farB.x - vertex.x);

  const radius = p16
    ? Math.sqrt((p16.x - vertex.x) ** 2 + (p16.y - vertex.y) ** 2)
    : Math.max(dist13, dist14, dist15, dist10) * 0.8;

  if (radius < EPSILON) return null;

  // Use arcPoint to determine which of the two possible sweep directions to use
  let startAngle: number;
  let endAngle: number;

  if (p16) {
    const arcAngle = Math.atan2(p16.y - vertex.y, p16.x - vertex.x);
    if (isAngleInSweep(angleA, angleB, arcAngle)) {
      startAngle = angleA;
      endAngle = angleB;
    } else {
      startAngle = angleB;
      endAngle = angleA;
    }
  } else {
    startAngle = angleA;
    endAngle = angleB;
  }

  // Always CCW sweep
  let sweep = normalizeAngle(endAngle - startAngle);
  if (sweep < EPSILON) sweep = Math.PI * 2;

  const objects: THREE.Object3D[] = [];
  const lineMat = new THREE.LineBasicMaterial({ color });
  const dashedMat = new THREE.LineDashedMaterial({
    color,
    dashSize: EXTENSION_LINE_DASH_SIZE,
    gapSize: EXTENSION_LINE_GAP_SIZE,
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
    new THREE.Vector3(farA.x, farA.y, 0),
    startAngle === angleA ? arcStartPt : arcEndPt,
    dashedMat,
  );
  objects.push(extLineA);

  const extLineB = createExtensionLine(
    new THREE.Vector3(farB.x, farB.y, 0),
    startAngle === angleA ? arcEndPt : arcStartPt,
    dashedMat,
  );
  objects.push(extLineB);

  // Arrows follow arc curvature (chord direction, not pure tangent)
  const arrowArcAngle = ARROW_SIZE / radius;

  const innerStartA = startAngle + arrowArcAngle;
  const arrowStartFrom = new THREE.Vector3(
    vertex.x + radius * Math.cos(innerStartA),
    vertex.y + radius * Math.sin(innerStartA),
    0.1,
  );
  objects.push(createArrow(arrowStartFrom, new THREE.Vector3(arcStartPt.x, arcStartPt.y, 0.1), ARROW_SIZE, arrowMat));

  const innerEndA = endAngle - arrowArcAngle;
  const arrowEndFrom = new THREE.Vector3(
    vertex.x + radius * Math.cos(innerEndA),
    vertex.y + radius * Math.sin(innerEndA),
    0.1,
  );
  objects.push(createArrow(arrowEndFrom, new THREE.Vector3(arcEndPt.x, arcEndPt.y, 0.1), ARROW_SIZE, arrowMat));

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
    const textHeight = entity.textHeight || DIM_TEXT_HEIGHT;
    const textMesh = createDimensionTextMesh(dimensionText, textHeight, color, "center");

    let textAngle: number;

    if (textPos) {
      textMesh.position.set(textPos.x, textPos.y, 0.2);
      textAngle = Math.atan2(textPos.y - vertex.y, textPos.x - vertex.x);
    } else {
      // Default: place text at arc midpoint, offset outward
      const midAngle = startAngle + sweep / 2;
      const textRadius = radius + textHeight * 0.8;
      textMesh.position.set(
        vertex.x + textRadius * Math.cos(midAngle),
        vertex.y + textRadius * Math.sin(midAngle),
        0.2,
      );
      textAngle = midAngle;
    }

    // Rotate text along arc tangent (perpendicular to radius), keep it readable
    let textRotation = textAngle + Math.PI / 2;
    const norm = normalizeAngle(textRotation);
    if (norm > Math.PI / 2 && norm < Math.PI * 1.5) {
      textRotation += Math.PI;
    }
    textMesh.rotation.z = textRotation;

    objects.push(textMesh);
  }

  return objects.length > 0 ? objects : null;
};
