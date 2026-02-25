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

export const EXTENSION_LINE_OVERSHOOT = 2; // Выступ выносной линии за размерную

export const createExtensionLine = (
  from: THREE.Vector3,
  to: THREE.Vector3,
  material: THREE.LineBasicMaterial | THREE.LineDashedMaterial,
): THREE.Line => {
  // Продлеваем пунктирные выносные линии за размерную на EXTENSION_LINE_OVERSHOOT
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

  if (material instanceof THREE.LineDashedMaterial) {
    line.computeLineDistances();
  }

  return line;
};

/**
 * Создание линий и стрелок для линейной размерности (горизонтальной или вертикальной)
 */
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

  // 1. Размерная линия (с разрывом для текста)
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

  // 2. Выносные линии (пунктирные)
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

  // 3. Стрелки
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
 * Создание линий и стрелок для повёрнутой размерности (произвольный угол)
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

  // Направление размерной линии
  const dirX = Math.cos(angleRad);
  const dirY = Math.sin(angleRad);

  // Проекция точек на размерную линию (anchorPoint лежит на ней)
  const t1 = (point1.x - anchorPoint.x) * dirX + (point1.y - anchorPoint.y) * dirY;
  const t2 = (point2.x - anchorPoint.x) * dirX + (point2.y - anchorPoint.y) * dirY;

  // Точки пересечения выносных линий с размерной линией
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

  // 1. Размерная линия (с разрывом для текста если он на линии)
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

  // 2. Выносные линии (от точек измерения к размерной линии)
  const p1 = new THREE.Vector3(point1.x, point1.y, 0);
  const p2 = new THREE.Vector3(point2.x, point2.y, 0);

  if (p1.distanceTo(foot1) > 0.1) {
    objects.push(createExtensionLine(p1, foot1, extensionLineMaterial));
  }
  if (p2.distanceTo(foot2) > 0.1) {
    objects.push(createExtensionLine(p2, foot2, extensionLineMaterial));
  }

  // 3. Стрелки (направлены наружу)
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

/**
 * Извлечение данных из DIMENSION entity
 */
export const extractDimensionData = (entity: DxfDimensionEntity) => {
  let point1 = entity.linearOrAngularPoint1;
  let point2 = entity.linearOrAngularPoint2;
  const anchorPoint = entity.anchorPoint;
  const diameterOrRadiusPoint = entity.diameterOrRadiusPoint;
  const textPos = entity.middleOfText;
  const angle = entity.angle || 0;
  let dimensionText = entity.text;
  let isRadial = false;

  // Определяем radial ДО генерации текста, чтобы добавить префикс "R"
  if (!point1 && !point2 && diameterOrRadiusPoint && anchorPoint) {
    point1 = diameterOrRadiusPoint;
    point2 = anchorPoint;
    isRadial = true;
  }

  // Замена <> на измерение (с префиксом "R" для radial)
  if (dimensionText && typeof entity.actualMeasurement === "number") {
    const measStr =
      (isRadial ? "R" : "") + formatDimNumber(entity.actualMeasurement);
    dimensionText = dimensionText.replace(/<>/g, measStr);
  }

  // Авто-текст если не задан в DXF
  if (!dimensionText && typeof entity.actualMeasurement === "number") {
    dimensionText =
      (isRadial ? "R" : "") + formatDimNumber(entity.actualMeasurement);
  }

  // Вычислить измерение из координат если текст не задан в DXF
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

/**
 * Создание группы объектов для размерности
 * @param color - Цвет размерной линии (hex строка)
 */
export const createDimensionGroup = (
  point1: DxfVertex,
  point2: DxfVertex,
  anchorPoint: DxfVertex,
  textPos: DxfVertex | undefined,
  _textHeight: number, // Параметр не используется, но оставлен для совместимости
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
    // Повёрнутая размерность — используем векторную геометрию с произвольным углом
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
    // Стандартная размерность — определяем ориентацию по разбросу точек
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
 * Форматирование числа для dimension текста: до DIM_TEXT_DECIMAL_PLACES знаков, без лишних нулей.
 * 28 → "28", 28.28 → "28.28", 28.2842 → "28.2842", 28.10 → "28.1"
 */
export const formatDimNumber = (value: number): string =>
  parseFloat(value.toFixed(DIM_TEXT_DECIMAL_PLACES)).toString();

/**
 * Очистка MTEXT форматирования из dimension текста (кроме \S).
 * Возвращает текст с удалёнными \A, \f, \c, \H, \P, {}, и обработанными спецсимволами.
 */
export const cleanDimensionMText = (rawText: string): string => {
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
 * Создание текстового меша для dimension с поддержкой stacked text (\S).
 * Формат \S: \Sверх^низ; — рисует «верх» как надстрочный и «низ» как подстрочный текст.
 * Текст рисуется у нижнего края canvas — низ видимых символов совпадает с позицией меша.
 */
export const createDimensionTextMesh = (
  rawText: string,
  height: number,
  color: string,
  hAlign: "left" | "center" | "right" = "center",
): THREE.Mesh => {
  const cleaned = cleanDimensionMText(rawText);

  // Ищем паттерн \S: \Sверх^низ; или \Sверх/низ;
  const stackedMatch = cleaned.match(/^(.*?)\\S([^^/;]*)\^([^;]*);(.*)$/);

  const CANVAS_SCALE = 10;
  const PADDING = 4;
  const STACKED_RATIO = 0.6;
  const STACKED_GAP = 2;
  const STACKED_V_GAP = 4; // Вертикальный зазор между superscript и subscript

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;

  const mainFontSize = Math.max(height * CANVAS_SCALE, TEXT_HEIGHT);
  const DIM_FONT = `"Cascadia Code", "Consolas", "Liberation Mono", monospace`;
  const mainFont = `100 ${mainFontSize}px ${DIM_FONT}`;

  // Эталонная высота canvas как в createTextMesh — для нормализации размера шрифта
  const refCanvasHeight = Math.ceil(mainFontSize * 1.2) + PADDING * 2;

  if (!stackedMatch) {
    // Нет stacked text — простой рендеринг
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

    // meshHeight нормализован по эталонному canvas — шрифт того же размера что в createTextMesh
    const meshHeight = (height * canvasHeight) / refCanvasHeight;
    const aspectRatio = canvasWidth / canvasHeight;
    const meshWidth = meshHeight * aspectRatio;
    const geometry = new THREE.PlaneGeometry(meshWidth, meshHeight);

    // baseline чуть выше textPos.y (зазор для подчёркивания)
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

  // Stacked text: mainText + superscript/subscript
  const mainText = stackedMatch[1].trim();
  const topText = stackedMatch[2].trim();
  const bottomText = stackedMatch[3].trim();

  const stackedFontSize = mainFontSize * STACKED_RATIO;
  const stackedFont = `100 ${stackedFontSize}px ${DIM_FONT}`;

  // Измеряем ширины и метрики
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

  // Stacked текст центрируется по визуальному центру основного текста
  const mainCenterAboveBaseline = mainAscent / 2;

  // Расстояния от baseline: вверх и вниз (с учётом вертикального зазора между super/subscript)
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

  // Baseline в canvas: padding сверху + topExtent (оставляем место для superscript)
  const baselineY = PADDING + Math.ceil(topExtent);
  // Визуальный центр основного текста — точка разделения super/subscript
  const stackedCenterY = baselineY - mainCenterAboveBaseline;

  // Рисуем основной текст
  if (mainText) {
    context.font = mainFont;
    context.textBaseline = "alphabetic";
    context.fillText(mainText, PADDING, baselineY);
  }

  // Stacked текст: по центру основного текста
  const stackedX = PADDING + mainWidth + gap;
  context.font = stackedFont;

  if (topText) {
    // alphabetic baseline: низ видимых глифов = stackedCenterY - halfVGap
    context.textBaseline = "alphabetic";
    context.fillText(topText, stackedX, stackedCenterY - halfVGap - topDescentSt);
  }

  if (bottomText) {
    // alphabetic baseline: верх видимых глифов = stackedCenterY + halfVGap
    context.textBaseline = "alphabetic";
    context.fillText(bottomText, stackedX, stackedCenterY + halfVGap + subAscent);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });

  // meshHeight нормализован по эталонному canvas — шрифт того же размера что в createTextMesh
  const meshHeight = (height * canvasHeight) / refCanvasHeight;
  const aspectRatio = canvasWidth / canvasHeight;
  const meshWidth = meshHeight * aspectRatio;
  const geometry = new THREE.PlaneGeometry(meshWidth, meshHeight);

  // Сдвигаем меш: baseline основного текста чуть выше textPos.y (зазор для подчёркивания)
  const baselineGap = height * 0.15;
  const belowBaselineFrac = (Math.ceil(bottomExtent) + PADDING) / canvasHeight;
  const tx = hAlign === "left" ? meshWidth / 2 : hAlign === "right" ? -meshWidth / 2 : 0;
  geometry.translate(tx, meshHeight / 2 - meshHeight * belowBaselineFrac + baselineGap, 0);

  return new THREE.Mesh(geometry, material);
};

/**
 * Создание ординатного размера (ordinate dimension).
 * Ординатный размер показывает координату точки (X или Y) и состоит из:
 * 1. Горизонтальной линии от feature point
 * 2. Диагонали до leader point
 * 3. Горизонтальной линии от leader до конца текста
 * Без стрелок и пунктирных линий — только сплошные линии.
 */
export const createOrdinateDimension = (
  entity: DxfDimensionEntity,
  color: string,
): THREE.Object3D[] | null => {
  const feature = entity.linearOrAngularPoint1; // Code 13 — точка на объекте
  const leader = entity.linearOrAngularPoint2; // Code 14 — конец диагонали
  const textPos = entity.middleOfText; // Code 11

  if (!feature || !leader) return null;

  // Получаем текст dimension
  let dimensionText = entity.text;
  const measurement = entity.actualMeasurement;

  // Замена <> на actualMeasurement
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

  // Создаём текстовый меш первым, чтобы узнать реальную ширину текста
  let textMesh: THREE.Mesh | null = null;
  let actualTextWidth = 0;
  if (textPos) {
    textMesh = createDimensionTextMesh(dimensionText, textHeight, color, "center");
    textMesh.position.set(textPos.x, textPos.y - textHeight / 2, 0.2);
    // Ширина из PlaneGeometry — реальная ширина меша в мировых координатах
    textMesh.geometry.computeBoundingBox();
    const bbox = textMesh.geometry.boundingBox;
    if (bbox) {
      actualTextWidth = bbox.max.x - bbox.min.x;
    }
  }

  // X-ordinate (бит 0 установлен) или Y-ordinate (бит 0 сброшен)
  const isXOrdinate = ((entity.dimensionType ?? 0) & 1) !== 0;

  const featureVec = new THREE.Vector3(feature.x, feature.y, 0);
  const leaderVec = new THREE.Vector3(leader.x, leader.y, 0);

  if (!isXOrdinate) {
    // Y-ordinate: горизонтальная выноска (измеряет Y координату)
    const dy = leader.y - feature.y;

    if (Math.abs(dy) < EPSILON) {
      // Одна горизонтальная линия от feature до конца текста
      const endX = textPos ? textPos.x + actualTextWidth / 2 : leader.x;
      const points = [featureVec, new THREE.Vector3(Math.max(leader.x, endX), leader.y, 0)];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      objects.push(new THREE.Line(geometry, material));
    } else {
      // Dog-leg: 3 сегмента
      // Смещение диагонали от leader = abs(dy)/2 (угол ~63°)
      const diagDx = Math.abs(dy) / 2;
      const dirX = leader.x - feature.x !== 0 ? Math.sign(leader.x - feature.x) : 1;
      let kneeX = leader.x - dirX * diagDx;

      // Ограничиваем knee: не за feature
      if (dirX > 0) {
        kneeX = Math.max(kneeX, feature.x);
      } else {
        kneeX = Math.min(kneeX, feature.x);
      }

      const kneeVec = new THREE.Vector3(kneeX, feature.y, 0);

      // Сегмент 1: горизонтальный от feature до knee
      if (Math.abs(kneeX - feature.x) > EPSILON) {
        const geom1 = new THREE.BufferGeometry().setFromPoints([featureVec, kneeVec]);
        objects.push(new THREE.Line(geom1, material));
      }

      // Сегмент 2: диагональ от knee до leader
      const geom2 = new THREE.BufferGeometry().setFromPoints([kneeVec, leaderVec]);
      objects.push(new THREE.Line(geom2, material));

      // Сегмент 3: горизонтальный от leader до конца текста
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
    // X-ordinate: вертикальная выноска (измеряет X координату)
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

  // Добавляем текстовый меш (создан выше для расчёта ширины)
  if (textMesh) {
    objects.push(textMesh);
  }

  return objects.length > 0 ? objects : null;
};

/**
 * Создание радиального размера (radial dimension, тип 4).
 * Линия от правого края текста до точки на дуге, стрелка на дуге направлена наружу.
 */
export const createRadialDimension = (
  entity: DxfDimensionEntity,
  color: string,
): THREE.Object3D[] | null => {
  const center = entity.anchorPoint; // code 10 — центр дуги
  const arcPt = entity.diameterOrRadiusPoint; // code 15 — точка на дуге
  const textPos = entity.middleOfText; // code 11

  if (!center || !arcPt) return null;

  // Текст dimension — вычисляем радиус из координат если measurement отсутствует
  let dimensionText = entity.text;
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

  // Направление от arcPt к центру (внутрь окружности)
  const dx = center.x - arcPt.x;
  const dy = center.y - arcPt.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const dirX = len > EPSILON ? dx / len : 1;
  const dirY = len > EPSILON ? dy / len : 0;

  // Определяем, откуда идёт линия размерности к arcPt
  // tailEnd — конец хвоста (текст/подчёркивание), определяет направление стрелки
  let tailEndPoint: THREE.Vector3 | null = null;

  let textMesh: THREE.Mesh | null = null;
  if (textPos) {
    // textPos — середина текста (по спецификации DXF "middle point of dimension text")
    const underlineY = textPos.y - textHeight / 2;

    // Вычисляем пересечение хвоста с горизонталью подчёркивания
    let intersectX = textPos.x;
    if (Math.abs(dirY) > EPSILON) {
      const t = (underlineY - arcPt.y) / dirY;
      intersectX = arcPt.x + t * dirX;
    }

    // Создаём текстовый меш (center-aligned по textPos.x, baseline на underlineY)
    textMesh = createDimensionTextMesh(dimensionText, textHeight, color, "center");
    textMesh.position.set(textPos.x, underlineY, 0.2);
    textMesh.geometry.computeBoundingBox();
    let textWidth = 0;
    const bbox = textMesh.geometry.boundingBox;
    if (bbox) {
      textWidth = bbox.max.x - bbox.min.x;
    }

    // Координаты подчёркивания (текст центрирован по textPos.x)
    const textLeft = textPos.x - textWidth / 2;
    const textRight = textPos.x + textWidth / 2;

    // Хвост стрелки — от arcPt до underlineY
    tailEndPoint = new THREE.Vector3(intersectX, underlineY, 0);
    const tailGeom = new THREE.BufferGeometry().setFromPoints([arcVec, tailEndPoint]);
    objects.push(new THREE.Line(tailGeom, lineMat));

    // Подчёркивание — от точки пересечения с ножкой до дальнего края текста
    const underlineLeft = intersectX <= textPos.x ? intersectX : textLeft;
    const underlineRight = intersectX <= textPos.x ? textRight : intersectX;
    const underlineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(underlineLeft, underlineY, 0),
      new THREE.Vector3(underlineRight, underlineY, 0),
    ]);
    objects.push(new THREE.Line(underlineGeom, lineMat));
  }

  // 2. Стрелка на arcPt — направлена от линии размерности к точке на дуге
  // arrowFrom на стороне откуда приходит линия (tail или центр)
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

  // Текст
  if (textMesh) {
    objects.push(textMesh);
  }

  return objects.length > 0 ? objects : null;
};

/**
 * Создание diametric dimension (диаметральный размер, тип 3).
 * Рисует линию диаметра между двумя точками на окружности, стрелки на обоих концах,
 * и текст с выноской (ножка + подчёркивание).
 */
export const createDiametricDimension = (
  entity: DxfDimensionEntity,
  color: string,
): THREE.Object3D[] | null => {
  const p10 = entity.anchorPoint; // code 10 — первая точка на окружности
  const p15 = entity.diameterOrRadiusPoint; // code 15 — противоположная точка (второй конец диаметра)
  const textPos = entity.middleOfText; // code 11

  if (!p10 || !p15) return null;

  // Текст dimension — вычисляем диаметр из координат если measurement отсутствует
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

  // Центр окружности — середина отрезка p10<->p15
  const cx = (p10.x + p15.x) / 2;
  const cy = (p10.y + p15.y) / 2;

  // Направление от p10 к центру (для стрелки на p10)
  const dx10 = cx - p10.x;
  const dy10 = cy - p10.y;
  const len10 = Math.sqrt(dx10 * dx10 + dy10 * dy10);
  const dir10x = len10 > EPSILON ? dx10 / len10 : 1;
  const dir10y = len10 > EPSILON ? dy10 / len10 : 0;

  // Определяем: текст вдоль линии диаметра или вынесен наружу
  // Проекция textPos на линию p15->p10 (параметр t и перпендикулярное расстояние)
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

  // Стрелки на обоих концах
  // Тип 1 (текст внутри): стрелки наружу (от центра к окружности)
  // Тип 2 (текст вынесен): стрелки внутрь (к центру)
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

  // Линия диаметра: всегда сплошная от p15 до p10
  const diamLineGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(p15.x, p15.y, 0),
    new THREE.Vector3(p10.x, p10.y, 0),
  ]);
  objects.push(new THREE.Line(diamLineGeom, lineMat));

  let textMesh: THREE.Mesh | null = null;

  if (textPos && textOnLine) {
    // Текст вдоль линии диаметра — повёрнут по углу линии, без выноски
    textMesh = createDimensionTextMesh(dimensionText, textHeight, color, "center");
    let angle = Math.atan2(p10.y - p15.y, p10.x - p15.x);
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;
    textMesh.position.set(textPos.x, textPos.y, 0.2);
    textMesh.rotation.z = angle;
  } else if (textPos) {

    // Текст вынесен наружу — выноска (ножка + подчёркивание)
    // Ножка идёт от ближайшего конца линии в направлении стрелки
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
    // Fallback: сплошная линия + текст в центре
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
 * Вычисление пересечения двух линий (2D).
 * Line1: p1 -> p2, Line2: p3 -> p4.
 * Возвращает точку пересечения или null если линии параллельны.
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

/**
 * Нормализация угла в диапазон [0, 2pi)
 */
export const normalizeAngle = (a: number): number => {
  const TWO_PI = Math.PI * 2;
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
};

/**
 * Проверка: лежит ли угол testAngle внутри дуги от startAngle до endAngle (CCW sweep).
 */
export const isAngleInSweep = (startAngle: number, endAngle: number, testAngle: number): boolean => {
  const s = normalizeAngle(startAngle);
  const e = normalizeAngle(endAngle);
  const t = normalizeAngle(testAngle);
  if (s < e) {
    return t >= s && t <= e;
  }
  // Дуга пересекает 0
  return t >= s || t <= e;
};

/**
 * Создание angular dimension (угловой размер между двумя линиями, тип 2).
 * Рисует дугу между лучами, выносные линии, стрелки и текст с градусами.
 */
export const createAngularDimension = (
  entity: DxfDimensionEntity,
  color: string,
): THREE.Object3D[] | null => {
  const p13 = entity.linearOrAngularPoint1; // code 13 — конец 1 первой линии
  const p14 = entity.linearOrAngularPoint2; // code 14 — конец 2 первой линии
  const p15 = entity.diameterOrRadiusPoint; // code 15 — конец 1 второй линии
  const p10 = entity.anchorPoint; // code 10 — конец 2 второй линии
  const p16 = entity.arcPoint; // code 16 — точка на дуге (определяет радиус и угол)
  const textPos = entity.middleOfText; // code 11

  if (!p13 || !p14 || !p15 || !p10) return null;

  // 1. Найти вершину угла (пересечение двух линий)
  let vertex: { x: number; y: number };
  const dist14_15 = Math.sqrt((p14.x - p15.x) ** 2 + (p14.y - p15.y) ** 2);
  if (dist14_15 < EPSILON) {
    // Линии сходятся в одной точке
    vertex = { x: p14.x, y: p14.y };
  } else {
    const v = intersectLines2D(p13.x, p13.y, p14.x, p14.y, p15.x, p15.y, p10.x, p10.y);
    if (!v) return null; // Параллельные линии — не можем построить угловой размер
    vertex = v;
  }

  // 2. Определить дальние концы лучей (дальние от вершины на каждой линии)
  const dist13 = Math.sqrt((p13.x - vertex.x) ** 2 + (p13.y - vertex.y) ** 2);
  const dist14 = Math.sqrt((p14.x - vertex.x) ** 2 + (p14.y - vertex.y) ** 2);
  const farA = dist13 >= dist14 ? p13 : p14;

  const dist15 = Math.sqrt((p15.x - vertex.x) ** 2 + (p15.y - vertex.y) ** 2);
  const dist10 = Math.sqrt((p10.x - vertex.x) ** 2 + (p10.y - vertex.y) ** 2);
  const farB = dist15 >= dist10 ? p15 : p10;

  // 3. Углы лучей
  const angleA = Math.atan2(farA.y - vertex.y, farA.x - vertex.x);
  const angleB = Math.atan2(farB.y - vertex.y, farB.x - vertex.x);

  // 4. Радиус дуги
  const radius = p16
    ? Math.sqrt((p16.x - vertex.x) ** 2 + (p16.y - vertex.y) ** 2)
    : Math.max(dist13, dist14, dist15, dist10) * 0.8;

  if (radius < EPSILON) return null;

  // 5. Определить startAngle/endAngle по arcPoint
  let startAngle: number;
  let endAngle: number;

  if (p16) {
    const arcAngle = Math.atan2(p16.y - vertex.y, p16.x - vertex.x);
    // Проверяем оба варианта sweep (A->B CCW и B->A CCW)
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

  // Вычисляем sweep (всегда CCW)
  let sweep = normalizeAngle(endAngle - startAngle);
  if (sweep < EPSILON) sweep = Math.PI * 2;

  // 6. Рисуем
  const objects: THREE.Object3D[] = [];
  const lineMat = new THREE.LineBasicMaterial({ color });
  const dashedMat = new THREE.LineDashedMaterial({
    color,
    dashSize: EXTENSION_LINE_DASH_SIZE,
    gapSize: EXTENSION_LINE_GAP_SIZE,
  });
  const arrowMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });

  // 6a. Дуга
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

  // 6b. Выносные линии (от дальних концов к точкам на дуге)
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

  // 6c. Стрелки — направление по хорде дуги (следует кривизне, а не чистой касательной)
  const arrowArcAngle = ARROW_SIZE / radius;

  // На startAngle: хорда от точки внутри дуги (startAngle + delta) к arcStartPt
  const innerStartA = startAngle + arrowArcAngle;
  const arrowStartFrom = new THREE.Vector3(
    vertex.x + radius * Math.cos(innerStartA),
    vertex.y + radius * Math.sin(innerStartA),
    0.1,
  );
  objects.push(createArrow(arrowStartFrom, new THREE.Vector3(arcStartPt.x, arcStartPt.y, 0.1), ARROW_SIZE, arrowMat));

  // На endAngle: хорда от точки внутри дуги (endAngle - delta) к arcEndPt
  const innerEndA = endAngle - arrowArcAngle;
  const arrowEndFrom = new THREE.Vector3(
    vertex.x + radius * Math.cos(innerEndA),
    vertex.y + radius * Math.sin(innerEndA),
    0.1,
  );
  objects.push(createArrow(arrowEndFrom, new THREE.Vector3(arcEndPt.x, arcEndPt.y, 0.1), ARROW_SIZE, arrowMat));

  // 6d. Текст
  let dimensionText = entity.text;
  const measurement = entity.actualMeasurement;

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

    // Угол от вершины к позиции текста — для поворота вдоль касательной
    let textAngle: number;

    if (textPos) {
      textMesh.position.set(textPos.x, textPos.y, 0.2);
      textAngle = Math.atan2(textPos.y - vertex.y, textPos.x - vertex.x);
    } else {
      // Разместить текст посередине дуги
      const midAngle = startAngle + sweep / 2;
      const textRadius = radius + textHeight * 0.8;
      textMesh.position.set(
        vertex.x + textRadius * Math.cos(midAngle),
        vertex.y + textRadius * Math.sin(midAngle),
        0.2,
      );
      textAngle = midAngle;
    }

    // Поворот текста вдоль касательной к дуге (перпендикулярно радиусу)
    let textRotation = textAngle + Math.PI / 2;
    // Нормализация: текст не должен быть вверх ногами
    const norm = normalizeAngle(textRotation);
    if (norm > Math.PI / 2 && norm < Math.PI * 1.5) {
      textRotation += Math.PI;
    }
    textMesh.rotation.z = textRotation;

    objects.push(textMesh);
  }

  return objects.length > 0 ? objects : null;
};
