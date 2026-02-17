// Создание геометрии Three.js из DXF данных
import * as THREE from "three";
import { NURBSCurve } from "three/examples/jsm/curves/NURBSCurve.js";
import type {
  DxfVertex,
  DxfEntity,
  DxfData,
  DxfDimensionEntity,
  DxfLayer,
  HatchBoundaryPath,
  HatchEdge,
  HatchPatternLine,
} from "@/types/dxf";
import {
  isLineEntity,
  isCircleEntity,
  isArcEntity,
  isPolylineEntity,
  isSplineEntity,
  isTextEntity,
  isDimensionEntity,
  isInsertEntity,
  isSolidEntity,
  isEllipseEntity,
  isPointEntity,
  is3DFaceEntity,
  isHatchEntity,
} from "@/types/dxf";
import {
  TEXT_HEIGHT,
  DIM_TEXT_HEIGHT,
  DIM_TEXT_GAP,
  DIM_TEXT_DECIMAL_PLACES,
  ARROW_SIZE,
  ARROW_BASE_WIDTH_DIVISOR,
  CIRCLE_SEGMENTS,
  EXTENSION_LINE_DASH_SIZE,
  EXTENSION_LINE_GAP_SIZE,
  DEGREES_TO_RADIANS_DIVISOR,
  EPSILON,
  MIN_ARC_SEGMENTS,
  NURBS_SEGMENTS_MULTIPLIER,
  MIN_NURBS_SEGMENTS,
  CATMULL_ROM_SEGMENTS_MULTIPLIER,
  MIN_CATMULL_ROM_SEGMENTS,
  POINT_MARKER_SIZE,
} from "@/constants";
import { resolveEntityColor, rgbNumberToHex } from "@/utils/colorResolver";
import ACI_PALETTE from "@/parser/acadColorIndex";

/** Контекст цвета для передачи в processEntity */
interface EntityColorContext {
  layers: Record<string, DxfLayer>;
  blockColor?: string; // Цвет INSERT entity для ByBlock наследования
  materialCache: Map<string, THREE.LineBasicMaterial>; // Кеш материалов по цвету
}

/** Получить LineBasicMaterial из кеша или создать новый */
const getLineMaterial = (
  color: string,
  cache: Map<string, THREE.LineBasicMaterial>,
): THREE.LineBasicMaterial => {
  let mat = cache.get(color);
  if (!mat) {
    mat = new THREE.LineBasicMaterial({ color });
    cache.set(color, mat);
  }
  return mat;
};

/**
 * Создание дуги из двух точек с коэффициентом bulge
 * @param p1 - Начальная точка
 * @param p2 - Конечная точка
 * @param bulge - Коэффициент изгиба (bulge = tan(angle/4))
 * @returns Массив точек для отрисовки дуги
 */
const createBulgeArc = (p1: THREE.Vector3, p2: THREE.Vector3, bulge: number): THREE.Vector3[] => {
  // Если bulge близок к нулю - возвращаем прямую линию
  if (Math.abs(bulge) < EPSILON) {
    return [p1, p2];
  }

  // Вычисляем расстояние между точками (длина хорды)
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const chordLength = Math.sqrt(dx * dx + dy * dy);

  // Если точки совпадают - возвращаем их
  if (chordLength < EPSILON) {
    return [p1, p2];
  }

  // Центральный угол дуги: bulge = tan(θ/4) => θ = 4 * atan(bulge)
  const theta = 4 * Math.atan(bulge);

  // Радиус окружности по формуле: r = L / (2 * sin(θ/2))
  // где L - длина хорды, θ - центральный угол
  const radius = chordLength / (2 * Math.sin(theta / 2));

  // Расстояние от середины хорды до центра окружности (со знаком)
  // При θ < π: h > 0, при θ > π: h < 0 (центр по другую сторону хорды)
  // Знак автоматически корректен т.к. theta и radius вычислены с учётом знака bulge
  const h = radius * Math.cos(theta / 2);

  // Середина хорды
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;

  // Единичный вектор вдоль хорды
  const chordDirX = dx / chordLength;
  const chordDirY = dy / chordLength;

  // Перпендикулярный вектор к хорде (поворот на 90° против часовой стрелки)
  const perpX = -chordDirY;
  const perpY = chordDirX;

  // Центр окружности (смещаем от середины хорды по перпендикуляру)
  // Знак h уже учитывает направление: для bulge > 0 и θ < π центр справа от хорды,
  // для bulge > 0 и θ > π центр слева (и наоборот для отрицательного bulge)
  const centerX = midX + perpX * h;
  const centerY = midY + perpY * h;

  // Начальный и конечный углы относительно центра
  const startAngle = Math.atan2(p1.y - centerY, p1.x - centerX);
  const endAngle = Math.atan2(p2.y - centerY, p2.x - centerX);

  // Определяем направление обхода дуги
  let sweepAngle = endAngle - startAngle;

  // Нормализуем угол в диапазон [-π, π]
  while (sweepAngle > Math.PI) sweepAngle -= 2 * Math.PI;
  while (sweepAngle < -Math.PI) sweepAngle += 2 * Math.PI;

  // Корректируем направление в зависимости от знака bulge
  if (bulge > 0 && sweepAngle < 0) {
    sweepAngle += 2 * Math.PI;
  } else if (bulge < 0 && sweepAngle > 0) {
    sweepAngle -= 2 * Math.PI;
  }

  // Количество сегментов для дуги (пропорционально углу)
  const segments = Math.max(
    MIN_ARC_SEGMENTS,
    Math.floor((Math.abs(sweepAngle) * CIRCLE_SEGMENTS) / (2 * Math.PI)),
  );

  const points: THREE.Vector3[] = [];

  // Генерируем точки дуги
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const currentAngle = startAngle + sweepAngle * t;
    const x = centerX + Math.abs(radius) * Math.cos(currentAngle);
    const y = centerY + Math.abs(radius) * Math.sin(currentAngle);
    points.push(new THREE.Vector3(x, y, 0));
  }

  return points;
};

/**
 * Создание стрелки (треугольника) для размерных линий
 * @param tip - Острие стрелки (вершина треугольника)
 * @param direction - Направление стрелки (нормализованный вектор)
 * @param size - Длина стрелки
 * @param material - Материал для отрисовки
 */
const createArrow = (
  tip: THREE.Vector3,
  direction: THREE.Vector2,
  size: number,
  material: THREE.Material,
): THREE.Mesh => {
  const width = size / ARROW_BASE_WIDTH_DIVISOR;

  const perpX = direction.y;
  const perpY = -direction.x;

  const base1 = new THREE.Vector3(
    tip.x - direction.x * size + perpX * width,
    tip.y - direction.y * size + perpY * width,
    tip.z,
  );

  const base2 = new THREE.Vector3(
    tip.x - direction.x * size - perpX * width,
    tip.y - direction.y * size - perpY * width,
    tip.z,
  );

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [tip.x, tip.y, tip.z, base1.x, base1.y, base1.z, base2.x, base2.y, base2.z],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();

  return new THREE.Mesh(geometry, material);
};

/**
 * Создание выносной линии для размерности
 */
const EXTENSION_LINE_OVERSHOOT = 2; // Выступ выносной линии за размерную

const createExtensionLine = (
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
const createLinearDimensionLines = (
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
  const createArrowDir = (main: number, fixed: number) =>
    isHorizontal ? new THREE.Vector2(main, fixed) : new THREE.Vector2(fixed, main);

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
    createVec3(min, anchorFixed, 0.1),
    createArrowDir(-1, 0),
    ARROW_SIZE,
    arrowMaterial,
  );
  objects.push(arrow1);

  const arrow2 = createArrow(
    createVec3(max, anchorFixed, 0.1),
    createArrowDir(1, 0),
    ARROW_SIZE,
    arrowMaterial,
  );
  objects.push(arrow2);

  return objects;
};

/**
 * Создание линий и стрелок для повёрнутой размерности (произвольный угол)
 */
const createRotatedDimensionLines = (
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
      new THREE.Vector3(minPt.x, minPt.y, 0.1),
      new THREE.Vector2(-dirX, -dirY),
      ARROW_SIZE,
      arrowMaterial,
    ),
  );
  objects.push(
    createArrow(
      new THREE.Vector3(maxPt.x, maxPt.y, 0.1),
      new THREE.Vector2(dirX, dirY),
      ARROW_SIZE,
      arrowMaterial,
    ),
  );

  return objects;
};

/**
 * Извлечение данных из DIMENSION entity
 */
const extractDimensionData = (entity: DxfDimensionEntity) => {
  let point1 = entity.linearOrAngularPoint1;
  let point2 = entity.linearOrAngularPoint2;
  const anchorPoint = entity.anchorPoint;
  const diameterOrRadiusPoint = entity.diameterOrRadiusPoint;
  const textPos = entity.middleOfText || entity.textMidPoint;
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
      (isRadial ? "R" : "") + entity.actualMeasurement.toFixed(DIM_TEXT_DECIMAL_PLACES);
    dimensionText = dimensionText.replace(/<>/g, measStr);
  }

  // Авто-текст если не задан в DXF
  if (!dimensionText && typeof entity.actualMeasurement === "number") {
    dimensionText =
      (isRadial ? "R" : "") + entity.actualMeasurement.toFixed(DIM_TEXT_DECIMAL_PLACES);
  }

  // Вычислить измерение из координат если текст не задан в DXF
  if (!dimensionText && point1 && point2) {
    const dx = point2.x - point1.x;
    const dy = point2.y - point1.y;
    const dz = (point2.z || 0) - (point1.z || 0);
    const measurement = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dimensionText = (isRadial ? "R" : "") + measurement.toFixed(DIM_TEXT_DECIMAL_PLACES);
  }

  if (!isRadial && dimensionText && !isNaN(parseFloat(dimensionText))) {
    dimensionText = parseFloat(dimensionText).toFixed(DIM_TEXT_DECIMAL_PLACES);
  }

  if (!point1 || !point2 || !anchorPoint || !dimensionText) {
    return null;
  }
  const textHeight = entity.height || entity.textHeight || DIM_TEXT_HEIGHT;

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
const createDimensionGroup = (
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

    const dx = edgeX - centerX;
    const dy = edgeY - centerY;
    const length = Math.sqrt(dx * dx + dy * dy);
    const directionX = dx / length;
    const directionY = dy / length;

    dimGroup.add(
      createExtensionLine(
        new THREE.Vector3(centerX, centerY, 0),
        new THREE.Vector3(edgeX, edgeY, 0),
        dimLineMaterial,
      ),
    );

    const arrow = createArrow(
      new THREE.Vector3(edgeX, edgeY, 0.1),
      new THREE.Vector2(directionX, directionY),
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
 * Очистка MTEXT форматирования из dimension текста (кроме \S).
 * Возвращает текст с удалёнными \A, \f, \c, \H, \P, {}, и обработанными спецсимволами.
 */
const cleanDimensionMText = (rawText: string): string => {
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
const createDimensionTextMesh = (
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
const createOrdinateDimension = (
  entity: DxfDimensionEntity,
  color: string,
): THREE.Object3D[] | null => {
  const feature = entity.linearOrAngularPoint1; // Code 13 — точка на объекте
  const leader = entity.linearOrAngularPoint2; // Code 14 — конец диагонали
  const textPos = entity.middleOfText || entity.textMidPoint; // Code 11

  if (!feature || !leader) return null;

  // Получаем текст dimension
  let dimensionText = entity.text;
  const measurement = entity.actualMeasurement;

  // Замена <> на actualMeasurement
  if (dimensionText && typeof measurement === "number") {
    dimensionText = dimensionText.replace(/<>/g, measurement.toFixed(DIM_TEXT_DECIMAL_PLACES));
  }

  if (!dimensionText && typeof measurement === "number") {
    dimensionText = measurement.toFixed(DIM_TEXT_DECIMAL_PLACES);
  }

  if (!dimensionText) return null;

  const textHeight = entity.height || entity.textHeight || DIM_TEXT_HEIGHT;
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
const createRadialDimension = (
  entity: DxfDimensionEntity,
  color: string,
): THREE.Object3D[] | null => {
  const center = entity.anchorPoint; // code 10 — центр дуги
  const arcPt = entity.diameterOrRadiusPoint; // code 15 — точка на дуге
  const textPos = entity.middleOfText || entity.textMidPoint; // code 11

  if (!center || !arcPt) return null;

  // Текст dimension
  let dimensionText = entity.text;
  const measurement = entity.actualMeasurement;

  if (dimensionText && typeof measurement === "number") {
    const measStr = "R" + measurement.toFixed(DIM_TEXT_DECIMAL_PLACES);
    dimensionText = dimensionText.replace(/<>/g, measStr);
  }

  if (!dimensionText && typeof measurement === "number") {
    dimensionText = "R" + measurement.toFixed(DIM_TEXT_DECIMAL_PLACES);
  }

  if (!dimensionText) return null;

  const textHeight = entity.height || entity.textHeight || DIM_TEXT_HEIGHT;
  const objects: THREE.Object3D[] = [];
  const lineMat = new THREE.LineBasicMaterial({ color });
  const arrowMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });

  const arcVec = new THREE.Vector3(arcPt.x, arcPt.y, 0);

  // Направление стрелки: внутрь (к центру от точки на дуге)
  const dx = center.x - arcPt.x;
  const dy = center.y - arcPt.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const dirX = len > EPSILON ? dx / len : 1;
  const dirY = len > EPSILON ? dy / len : 0;

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

    // Хвост стрелки — от arcPt в направлении стрелки до underlineY
    const tailEnd = new THREE.Vector3(intersectX, underlineY, 0);
    const tailGeom = new THREE.BufferGeometry().setFromPoints([arcVec, tailEnd]);
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

  // 2. Стрелка на точке дуги, направлена внутрь (к центру)
  const arrow = createArrow(
    new THREE.Vector3(arcPt.x, arcPt.y, 0.1),
    new THREE.Vector2(dirX, dirY),
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
 * Создание группы для INSERT entity (вставка блока)
 * @param insertEntity - INSERT entity с параметрами вставки
 * @param dxf - Данные DXF файла с блоками
 * @param colorCtx - Контекст цвета
 * @param depth - Текущая глубина рекурсии (защита от бесконечной рекурсии)
 * @returns THREE.Group с отрендеренным блоком или null если блок не найден
 */
const createBlockGroup = (
  insertEntity: DxfEntity,
  dxf: DxfData,
  colorCtx: EntityColorContext,
  depth = 0,
): THREE.Group | null => {
  const MAX_RECURSION_DEPTH = 10;

  if (depth > MAX_RECURSION_DEPTH) {
    console.warn(`⚠️ Достигнута максимальная глубина рекурсии при обработке INSERT: ${depth}`);
    return null;
  }

  if (!isInsertEntity(insertEntity)) {
    return null;
  }

  if (!dxf.blocks || typeof dxf.blocks !== "object") {
    console.warn("⚠️ DXF не содержит blocks!");
    return null;
  }

  const blockName = insertEntity.name;
  const block = dxf.blocks[blockName];

  if (!block) {
    return null;
  }

  if (!block.entities || block.entities.length === 0) {
    // Блок существует, но пуст — возвращаем пустую группу (не unsupported)
    const emptyGroup = new THREE.Group();
    const position = insertEntity.position;
    emptyGroup.position.set(position.x, position.y, position.z || 0);
    return emptyGroup;
  }

  // Вычисляем цвет INSERT entity для ByBlock наследования
  const insertColor = resolveEntityColor(insertEntity, colorCtx.layers, colorCtx.blockColor);
  const blockColorCtx: EntityColorContext = {
    layers: colorCtx.layers,
    blockColor: insertColor,
    materialCache: colorCtx.materialCache,
  };

  const blockGroup = new THREE.Group();

  block.entities.forEach((entity: DxfEntity) => {
    try {
      const obj = processEntity(entity, dxf, blockColorCtx, depth + 1);
      if (obj) {
        if (Array.isArray(obj)) {
          obj.forEach((o) => blockGroup.add(o));
        } else {
          blockGroup.add(obj);
        }
      }
    } catch (error) {
      console.warn(`⚠️ Error processing entity in block "${blockName}":`, error);
    }
  });

  const position = insertEntity.position;
  blockGroup.position.set(position.x, position.y, position.z || 0);

  const xScale = insertEntity.xScale ?? 1;
  const yScale = insertEntity.yScale ?? 1;
  const zScale = insertEntity.zScale ?? 1;
  blockGroup.scale.set(xScale, yScale, zScale);

  if (insertEntity.rotation) {
    const rotationRadians = (insertEntity.rotation * Math.PI) / DEGREES_TO_RADIANS_DIVISOR;
    blockGroup.rotation.z = rotationRadians;
  }

  return blockGroup;
};

/** Строка MTEXT с опциональным переопределением цвета, высоты и стиля */
interface MTextLine {
  text: string;
  color?: string;
  height?: number;
  bold?: boolean;
  italic?: boolean;
  fontFamily?: string;
}

/**
 * Замена DXF спецсимволов:
 * %%d → °, %%p → ±, %%c → Ø, %%nnn → символ по коду, %%u/%%o → убираем
 */
const replaceSpecialChars = (text: string): string =>
  text
    .replace(/%%[dD]/g, "°")
    .replace(/%%[pP]/g, "±")
    .replace(/%%[cC]/g, "Ø")
    .replace(/%%[uUoO]/g, "") // toggle underline/overline — убираем
    .replace(/%%(\d{3})/g, (_, code) => String.fromCharCode(parseInt(code)));

/**
 * Парсинг MTEXT форматирования в массив строк с цветом и высотой.
 * Обрабатывает: \P (перенос), \C<n>; (цвет ACI), \H<n>; (высота),
 * \f...; (шрифт), %%d/%%p/%%c (спецсимволы), {}, \L/\O/\K и др.
 */
const parseMTextContent = (rawText: string): MTextLine[] => {
  // 1. Защищаем литеральные escape-последовательности placeholder'ами,
  //    чтобы они не были съедены парсером форматирования (\\ → \, \{ → {, \} → })
  let text = rawText.replace(/\\\\/g, "\x01").replace(/\\\{/g, "\x02").replace(/\\\}/g, "\x03");

  // 2. Unicode символы по коду: \U+XXXX → символ
  text = text.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) =>
    String.fromCodePoint(parseInt(hex, 16)),
  );

  // 3. Спецсимволы %%d, %%p, %%c, %%nnn
  text = replaceSpecialChars(text);

  // 4. Разбиваем по \P (перенос строки в MTEXT)
  const rawLines = text.split(/\\P/);

  const lines: MTextLine[] = [];
  let currentColor: string | undefined;
  let currentHeight: number | undefined;
  let currentBold = false;
  let currentItalic = false;
  let currentFont: string | undefined;

  for (const rawLine of rawLines) {
    let clean = rawLine;

    // Сохраняем стиль на начало строки (carry-over от предыдущей строки)
    let lineFont = currentFont;
    let lineBold = currentBold;
    let lineItalic = currentItalic;
    let firstFontInLine = true;

    // Шрифт: \fFontName|b1|i0|c0|p0; — извлекаем имя шрифта, bold, italic
    // Первый \f в строке определяет стиль видимого текста этой строки,
    // последний \f обновляет carry-over состояние для следующих строк
    clean = clean.replace(/\\f([^|;]*)\|?[^;]*;/g, (fullMatch, fontName) => {
      if (fontName) currentFont = fontName;
      const boldMatch = fullMatch.match(/\|b(\d)/);
      const italicMatch = fullMatch.match(/\|i(\d)/);
      if (boldMatch) currentBold = boldMatch[1] === "1";
      if (italicMatch) currentItalic = italicMatch[1] === "1";
      // Первый \f определяет стиль для текста этой строки
      if (firstFontInLine) {
        lineFont = currentFont;
        lineBold = currentBold;
        lineItalic = currentItalic;
        firstFontInLine = false;
      }
      return "";
    });

    // Цвет ACI: \C<index>; или \c<index>;
    clean = clean.replace(/\\[cC](\d+);/g, (_, indexStr) => {
      const idx = parseInt(indexStr);
      if (idx === 0 || idx === 256) {
        currentColor = undefined; // ByBlock/ByLayer — используем цвет entity
      } else if (idx >= 1 && idx <= 255) {
        currentColor = rgbNumberToHex(ACI_PALETTE[idx]);
      }
      return "";
    });

    // Высота: \H<value>;
    clean = clean.replace(/\\H([\d.]+);/gi, (_, val) => {
      currentHeight = parseFloat(val);
      return "";
    });

    // Отступы абзаца: \pi<indent>,l<left>,r<right>,t<tabs>;
    clean = clean.replace(/\\p[^;]*;/g, "");
    // Ширина, трекинг, наклон, выравнивание: \W, \T, \Q, \A
    clean = clean.replace(/\\[WTQA][\d.+-]+;/gi, "");
    // Подчёркивание, надчёркивание, зачёркивание: \L/\l, \O/\o, \K/\k
    clean = clean.replace(/\\[LOKlok]/g, "");
    // Дроби: \S<text>^<text>;
    clean = clean.replace(/\\S[^;]*;/g, "");
    // Неразрывный пробел
    clean = clean.replace(/\\~/g, " ");
    // Разрыв колонки \N → пробел
    clean = clean.replace(/\\N/g, " ");
    // Фигурные скобки группировки (литеральные уже защищены placeholder'ами)
    clean = clean.replace(/[{}]/g, "");
    // Оставшиеся неизвестные escape-последовательности \X...;
    clean = clean.replace(/\\[a-zA-Z][^;]*;/g, "");

    // Восстанавливаем литеральные символы из placeholder'ов
    clean = clean.replace(/\x01/g, "\\").replace(/\x02/g, "{").replace(/\x03/g, "}");

    if (clean.length > 0) {
      lines.push({
        text: clean,
        color: currentColor,
        height: currentHeight,
        bold: lineBold,
        italic: lineItalic,
        fontFamily: lineFont,
      });
    }
  }

  return lines;
};

/**
 * Определение горизонтального выравнивания из MTEXT attachmentPoint (code 71)
 * 1,4,7 = Left; 2,5,8 = Center; 3,6,9 = Right
 */
const getMTextHAlign = (attachmentPoint?: number): "left" | "center" | "right" => {
  if (!attachmentPoint) return "left";
  const col = (attachmentPoint - 1) % 3; // 0=left, 1=center, 2=right
  if (col === 1) return "center";
  if (col === 2) return "right";
  return "left";
};

/**
 * Определение горизонтального выравнивания из TEXT halign (code 72)
 * 0 = Left, 1 = Center, 2 = Right, 3 = Aligned, 4 = Middle, 5 = Fit
 */
const getTextHAlign = (halign?: number): "left" | "center" | "right" => {
  if (halign === 1 || halign === 4) return "center";
  if (halign === 2) return "right";
  return "left";
};

/**
 * Определение вертикального выравнивания из MTEXT attachmentPoint (code 71)
 * 1-3 = Top; 4-6 = Middle; 7-9 = Bottom
 */
const getMTextVAlign = (attachmentPoint?: number): "top" | "middle" | "bottom" => {
  if (!attachmentPoint) return "top";
  const row = Math.ceil(attachmentPoint / 3); // 1=top, 2=middle, 3=bottom
  if (row === 2) return "middle";
  if (row === 3) return "bottom";
  return "top";
};

/**
 * Определение вертикального выравнивания из TEXT valign (code 73)
 * 0 = Baseline, 1 = Bottom, 2 = Middle, 3 = Top
 */
const getTextVAlign = (valign?: number): "top" | "middle" | "bottom" => {
  if (valign === 3) return "top";
  if (valign === 2) return "middle";
  return "bottom"; // 0=Baseline ≈ bottom, 1=Bottom
};

/**
 * Создание текстового меша с использованием Canvas текстуры
 * @param color - Цвет текста (hex строка)
 * @param bold - Жирный шрифт
 * @param italic - Курсив
 * @param hAlign - Горизонтальное выравнивание: 'left' | 'center' | 'right'
 * @param fontFamily - Имя шрифта (по умолчанию Arial)
 * @param vAlign - Вертикальное выравнивание: 'top' | 'middle' | 'bottom'
 */
const createTextMesh = (
  text: string,
  height: number,
  color: string,
  bold = false,
  italic = false,
  hAlign: "left" | "center" | "right" = "center",
  fontFamily = "Arial",
  vAlign: "top" | "middle" | "bottom" = "middle",
): THREE.Mesh => {
  const CANVAS_SCALE = 10;
  const TEXT_CANVAS_PADDING = 4;
  const TEXT_HEIGHT_MULTIPLIER = 1.2;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;

  const fontSize = Math.max(height * CANVAS_SCALE, TEXT_HEIGHT);
  const fontStyle = `${italic ? "italic " : ""}${bold ? "bold " : ""}${fontSize}px '${fontFamily}', Arial, sans-serif`;
  context.font = fontStyle;
  const textMetrics = context.measureText(text);

  const canvasWidth = Math.ceil(textMetrics.width) + TEXT_CANVAS_PADDING * 2;
  const canvasHeight = Math.ceil(fontSize * TEXT_HEIGHT_MULTIPLIER) + TEXT_CANVAS_PADDING * 2;

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  context.font = fontStyle;
  context.fillStyle = color;
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(text, TEXT_CANVAS_PADDING, canvasHeight / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
  });

  const aspectRatio = canvasWidth / canvasHeight;
  const meshWidth = height * aspectRatio;
  const geometry = new THREE.PlaneGeometry(meshWidth, height);

  // Сдвигаем геометрию для выравнивания: origin = точка привязки текста
  const tx = hAlign === "left" ? meshWidth / 2 : hAlign === "right" ? -meshWidth / 2 : 0;
  const ty = vAlign === "top" ? -height / 2 : vAlign === "bottom" ? height / 2 : 0;
  if (tx !== 0 || ty !== 0) {
    geometry.translate(tx, ty, 0);
  }

  const mesh = new THREE.Mesh(geometry, material);

  mesh.userData = {
    type: "TEXT",
    text: text,
    height: height,
    originalWidth: canvasWidth,
    originalHeight: canvasHeight,
  };

  return mesh;
};

/**
 * Конвертация boundary path HATCH в THREE.ShapePath (для Shape/Path)
 */
const boundaryPathToShapePath = (bp: HatchBoundaryPath): THREE.ShapePath | null => {
  const shapePath = new THREE.ShapePath();

  if (bp.edges && bp.edges.length > 0) {
    // Edge-based boundary
    const firstEdge = bp.edges[0];
    if (firstEdge.type === "line") {
      shapePath.moveTo(firstEdge.start.x, firstEdge.start.y);
    } else {
      // Для дуги — начальная точка на окружности
      const startRad = (firstEdge.startAngle * Math.PI) / 180;
      shapePath.moveTo(
        firstEdge.center.x + firstEdge.radius * Math.cos(startRad),
        firstEdge.center.y + firstEdge.radius * Math.sin(startRad),
      );
    }

    for (const edge of bp.edges) {
      addEdgeToPath(shapePath, edge);
    }
  } else if (bp.polylineVertices && bp.polylineVertices.length > 1) {
    // Polyline-based boundary
    const verts = bp.polylineVertices;
    shapePath.moveTo(verts[0].x, verts[0].y);

    for (let i = 0; i < verts.length - 1; i++) {
      const v1 = verts[i];
      const v2 = verts[i + 1];
      if (!shapePath.currentPath) break;
      if (v1.bulge && Math.abs(v1.bulge) > EPSILON) {
        addBulgeArcToPath(shapePath, v1, v2, v1.bulge);
      } else {
        shapePath.currentPath.lineTo(v2.x, v2.y);
      }
    }
  } else {
    return null;
  }

  return shapePath;
};

/**
 * Добавляет ребро HATCH (линия или дуга) в ShapePath
 */
const addEdgeToPath = (shapePath: THREE.ShapePath, edge: HatchEdge): void => {
  if (!shapePath.currentPath) return;
  if (edge.type === "line") {
    shapePath.currentPath.lineTo(edge.end.x, edge.end.y);
  } else {
    // Arc edge — углы в градусах, конвертируем в радианы
    const startRad = (edge.startAngle * Math.PI) / 180;
    const endRad = (edge.endAngle * Math.PI) / 180;
    shapePath.currentPath.absarc(
      edge.center.x,
      edge.center.y,
      edge.radius,
      startRad,
      endRad,
      !edge.ccw, // THREE.js: aClockwise=true означает CW, DXF ccw=true означает CCW
    );
  }
};

/**
 * Добавляет bulge-дугу между двумя вершинами полилайна в ShapePath
 */
const addBulgeArcToPath = (
  shapePath: THREE.ShapePath,
  v1: DxfVertex,
  v2: DxfVertex,
  bulge: number,
): void => {
  if (!shapePath.currentPath) return;
  const dx = v2.x - v1.x;
  const dy = v2.y - v1.y;
  const chordLength = Math.sqrt(dx * dx + dy * dy);
  if (chordLength < EPSILON) {
    shapePath.currentPath.lineTo(v2.x, v2.y);
    return;
  }

  const theta = 4 * Math.atan(bulge);
  const radius = chordLength / (2 * Math.sin(theta / 2));
  const h = radius * Math.cos(theta / 2);

  const midX = (v1.x + v2.x) / 2;
  const midY = (v1.y + v2.y) / 2;
  const perpX = -dy / chordLength;
  const perpY = dx / chordLength;

  const cx = midX + perpX * h;
  const cy = midY + perpY * h;

  const startAngle = Math.atan2(v1.y - cy, v1.x - cx);
  const endAngle = Math.atan2(v2.y - cy, v2.x - cx);

  // bulge > 0 → CCW, bulge < 0 → CW
  // THREE.js absarc: aClockwise=true → CW
  const clockwise = bulge < 0;

  shapePath.currentPath!.absarc(cx, cy, Math.abs(radius), startAngle, endAngle, clockwise);
};

/**
 * Конвертация boundary path в массив THREE.Vector3 для контурного отображения
 */
const boundaryPathToLinePoints = (bp: HatchBoundaryPath): THREE.Vector3[] => {
  const points: THREE.Vector3[] = [];

  if (bp.edges && bp.edges.length > 0) {
    for (const edge of bp.edges) {
      if (edge.type === "line") {
        if (points.length === 0) {
          points.push(new THREE.Vector3(edge.start.x, edge.start.y, 0));
        }
        points.push(new THREE.Vector3(edge.end.x, edge.end.y, 0));
      } else {
        const startRad = (edge.startAngle * Math.PI) / 180;
        const endRad = (edge.endAngle * Math.PI) / 180;
        let sweep = endRad - startRad;
        if (edge.ccw) {
          if (sweep < 0) sweep += 2 * Math.PI;
        } else {
          if (sweep > 0) sweep -= 2 * Math.PI;
        }
        const segments = Math.max(
          MIN_ARC_SEGMENTS,
          Math.floor((Math.abs(sweep) * CIRCLE_SEGMENTS) / (2 * Math.PI)),
        );
        for (let i = 0; i <= segments; i++) {
          const a = startRad + (i / segments) * sweep;
          points.push(
            new THREE.Vector3(
              edge.center.x + edge.radius * Math.cos(a),
              edge.center.y + edge.radius * Math.sin(a),
              0,
            ),
          );
        }
      }
    }
  } else if (bp.polylineVertices && bp.polylineVertices.length > 1) {
    const verts = bp.polylineVertices;
    points.push(new THREE.Vector3(verts[0].x, verts[0].y, 0));
    for (let i = 0; i < verts.length - 1; i++) {
      const v1 = verts[i];
      const v2 = verts[i + 1];
      if (v1.bulge && Math.abs(v1.bulge) > EPSILON) {
        const p1 = new THREE.Vector3(v1.x, v1.y, 0);
        const p2 = new THREE.Vector3(v2.x, v2.y, 0);
        const arcPts = createBulgeArc(p1, p2, v1.bulge);
        points.push(...arcPts.slice(1));
      } else {
        points.push(new THREE.Vector3(v2.x, v2.y, 0));
      }
    }
  }

  return points;
};

// ==================== HATCH Pattern Rendering ====================

interface Point2D {
  x: number;
  y: number;
}

/**
 * Тест точки внутри полигона (ray casting алгоритм)
 */
const pointInPolygon2D = (px: number, py: number, polygon: Point2D[]): boolean => {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = polygon[i].y,
      yj = polygon[j].y;
    if (
      yi > py !== yj > py &&
      px < ((polygon[j].x - polygon[i].x) * (py - yi)) / (yj - yi) + polygon[i].x
    ) {
      inside = !inside;
    }
  }
  return inside;
};

/**
 * Обрезка отрезка по полигону: возвращает массив [x1,y1,x2,y2] для частей внутри полигона
 */
const clipSegmentToPolygon = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  polygon: Point2D[],
): [number, number, number, number][] => {
  const dx = x2 - x1;
  const dy = y2 - y1;

  // Собираем параметры t пересечений отрезка с рёбрами полигона
  const params: number[] = [];
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = polygon[j].x - polygon[i].x;
    const ey = polygon[j].y - polygon[i].y;

    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-10) continue; // параллельные

    const t = ((polygon[i].x - x1) * ey - (polygon[i].y - y1) * ex) / denom;
    const u = ((polygon[i].x - x1) * dy - (polygon[i].y - y1) * dx) / denom;

    if (t > 1e-9 && t < 1 - 1e-9 && u > -1e-9 && u < 1 + 1e-9) {
      params.push(t);
    }
  }

  params.sort((a, b) => a - b);

  // Определяем, находится ли начальная точка внутри полигона
  const startInside = pointInPolygon2D(x1, y1, polygon);

  const result: [number, number, number, number][] = [];
  let inside = startInside;
  let prevT = 0;

  for (const t of params) {
    if (inside) {
      result.push([x1 + prevT * dx, y1 + prevT * dy, x1 + t * dx, y1 + t * dy]);
    }
    inside = !inside;
    prevT = t;
  }

  if (inside) {
    result.push([x1 + prevT * dx, y1 + prevT * dy, x2, y2]);
  }

  return result;
};

/**
 * Генерация сегментов паттерна HATCH, обрезанных по полигону boundary
 */
const generateHatchPattern = (
  patternLines: HatchPatternLine[],
  polygon: Point2D[],
): THREE.Vector3[][] => {
  // Bounding box полигона
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const diagX = maxX - minX;
  const diagY = maxY - minY;
  const diag = Math.sqrt(diagX * diagX + diagY * diagY);

  const allSegments: THREE.Vector3[][] = [];

  for (const pl of patternLines) {
    const angleRad = (pl.angle * Math.PI) / 180;
    const dirX = Math.cos(angleRad);
    const dirY = Math.sin(angleRad);
    // Перпендикуляр к направлению линии
    const perpX = -dirY;
    const perpY = dirX;

    // Перпендикулярное расстояние между линиями = |offset · perp|
    const spacing = Math.abs(pl.offset.x * perpX + pl.offset.y * perpY);
    if (spacing < EPSILON) continue;

    // Сдвиг вдоль направления линии между соседними линиями
    const stagger = pl.offset.x * dirX + pl.offset.y * dirY;

    // Проецируем углы bbox на перпендикулярное направление относительно basePoint
    const corners = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];

    let minProj = Infinity,
      maxProj = -Infinity;
    for (const c of corners) {
      const proj = (c.x - pl.basePoint.x) * perpX + (c.y - pl.basePoint.y) * perpY;
      if (proj < minProj) minProj = proj;
      if (proj > maxProj) maxProj = proj;
    }

    const startIdx = Math.floor(minProj / spacing);
    const endIdx = Math.ceil(maxProj / spacing);

    // Общая длина одного повтора дэш-паттерна
    const dashTotal = pl.dashes.reduce((s, d) => s + Math.abs(d), 0);
    // Если нет дэшей — сплошная линия
    const isSolid = pl.dashes.length === 0 || dashTotal < EPSILON;

    for (let i = startIdx; i <= endIdx; i++) {
      // Начало линии: basePoint + i * spacing * perp + i * stagger * dir
      const ox = pl.basePoint.x + i * spacing * perpX + i * stagger * dirX;
      const oy = pl.basePoint.y + i * spacing * perpY + i * stagger * dirY;

      if (isSolid) {
        // Сплошная линия через весь bbox
        const x1 = ox - diag * dirX,
          y1 = oy - diag * dirY;
        const x2 = ox + diag * dirX,
          y2 = oy + diag * dirY;
        const clipped = clipSegmentToPolygon(x1, y1, x2, y2, polygon);
        for (const seg of clipped) {
          allSegments.push([
            new THREE.Vector3(seg[0], seg[1], 0),
            new THREE.Vector3(seg[2], seg[3], 0),
          ]);
        }
      } else {
        // Дэш-паттерн: генерируем сегменты вдоль линии
        let t = -diag;
        // Выравниваем начало по периоду паттерна
        const phase = ((t % dashTotal) + dashTotal) % dashTotal;
        t -= phase;

        while (t < diag) {
          for (const d of pl.dashes) {
            const segLen = Math.abs(d);
            if (d > 0) {
              // Видимый дэш
              const sx = ox + t * dirX,
                sy = oy + t * dirY;
              const ex = ox + (t + segLen) * dirX,
                ey = oy + (t + segLen) * dirY;
              const clipped = clipSegmentToPolygon(sx, sy, ex, ey, polygon);
              for (const seg of clipped) {
                allSegments.push([
                  new THREE.Vector3(seg[0], seg[1], 0),
                  new THREE.Vector3(seg[2], seg[3], 0),
                ]);
              }
            }
            // d < 0 → пробел, d === 0 → точка (пропускаем)
            t += segLen;
          }
        }
      }
    }
  }

  return allSegments;
};

/**
 * Установить layerName в userData объекта
 */
const setLayerName = (obj: THREE.Object3D | THREE.Object3D[], layerName: string) => {
  if (Array.isArray(obj)) {
    obj.forEach((o) => {
      o.userData.layerName = layerName;
    });
  } else {
    obj.userData.layerName = layerName;
  }
};

/**
 * Обработка entity
 * @param entity - Entity для обработки
 * @param dxf - Данные DXF файла
 * @param colorCtx - Контекст цвета (слои, blockColor, кеш материалов)
 * @param depth - Глубина рекурсии для INSERT entities
 * @returns THREE.Object3D, массив объектов или null
 */
const processEntity = (
  entity: DxfEntity,
  dxf: DxfData,
  colorCtx: EntityColorContext,
  depth = 0,
): THREE.Object3D | THREE.Object3D[] | null => {
  // Вычисляем цвет для этого entity
  const entityColor = resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor);
  const lineMaterial = getLineMaterial(entityColor, colorCtx.materialCache);

  switch (entity.type) {
    case "LINE": {
      if (isLineEntity(entity)) {
        const vertex0 = entity.vertices[0];
        const vertex1 = entity.vertices[1];
        const points = [
          new THREE.Vector3(vertex0.x, vertex0.y, 0),
          new THREE.Vector3(vertex1.x, vertex1.y, 0),
        ];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return new THREE.Line(geometry, lineMaterial);
      }
      break;
    }

    case "CIRCLE": {
      if (isCircleEntity(entity)) {
        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
          const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
          points.push(
            new THREE.Vector3(
              entity.center.x + entity.radius * Math.cos(angle),
              entity.center.y + entity.radius * Math.sin(angle),
              0,
            ),
          );
        }
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return new THREE.Line(geometry, lineMaterial);
      }
      break;
    }

    case "ARC": {
      if (isArcEntity(entity)) {
        const startAngle = entity.startAngle;
        let endAngle = entity.endAngle;
        // Нормализуем: если endAngle <= startAngle, добавляем полный оборот
        if (endAngle <= startAngle) {
          endAngle += Math.PI * 2;
        }
        const sweepAngle = endAngle - startAngle;
        const segments = Math.max(
          MIN_ARC_SEGMENTS,
          Math.floor((sweepAngle * CIRCLE_SEGMENTS) / (2 * Math.PI)),
        );

        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= segments; i++) {
          const angle = startAngle + (i / segments) * sweepAngle;
          points.push(
            new THREE.Vector3(
              entity.center.x + entity.radius * Math.cos(angle),
              entity.center.y + entity.radius * Math.sin(angle),
              0,
            ),
          );
        }
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return new THREE.Line(geometry, lineMaterial);
      }
      break;
    }

    case "ELLIPSE": {
      if (isEllipseEntity(entity)) {
        const majorX = entity.majorAxisEndPoint.x;
        const majorY = entity.majorAxisEndPoint.y;

        // Длина большой полуоси
        const majorLength = Math.sqrt(majorX * majorX + majorY * majorY);
        // Длина малой полуоси
        const minorLength = majorLength * entity.axisRatio;

        // Угол поворота эллипса (угол большой оси относительно оси X)
        const rotation = Math.atan2(majorY, majorX);

        let startAngle = entity.startAngle;
        let endAngle = entity.endAngle;

        // Полный эллипс: startAngle≈0 и endAngle≈2π, или оба≈0
        const isFullEllipse =
          Math.abs(endAngle - startAngle - 2 * Math.PI) < EPSILON ||
          (Math.abs(startAngle) < EPSILON && Math.abs(endAngle) < EPSILON);

        if (isFullEllipse) {
          startAngle = 0;
          endAngle = 2 * Math.PI;
        }

        const sweepAngle = endAngle - startAngle;
        const segments = Math.max(
          MIN_ARC_SEGMENTS,
          Math.floor((Math.abs(sweepAngle) * CIRCLE_SEGMENTS) / (2 * Math.PI)),
        );

        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= segments; i++) {
          const t = startAngle + (i / segments) * sweepAngle;
          // Параметрическое уравнение эллипса с поворотом
          const localX = majorLength * Math.cos(t);
          const localY = minorLength * Math.sin(t);
          const worldX =
            entity.center.x + localX * Math.cos(rotation) - localY * Math.sin(rotation);
          const worldY =
            entity.center.y + localX * Math.sin(rotation) + localY * Math.cos(rotation);
          points.push(new THREE.Vector3(worldX, worldY, 0));
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return new THREE.Line(geometry, lineMaterial);
      }
      break;
    }

    case "LWPOLYLINE":
    case "POLYLINE": {
      if (isPolylineEntity(entity) && entity.vertices.length > 1) {
        const allPoints: THREE.Vector3[] = [];

        // Обрабатываем каждый сегмент POLYLINE
        for (let i = 0; i < entity.vertices.length - 1; i++) {
          const v1 = entity.vertices[i];
          const v2 = entity.vertices[i + 1];
          if (!v1 || !v2) continue;

          const p1 = new THREE.Vector3(v1.x, v1.y, 0);
          const p2 = new THREE.Vector3(v2.x, v2.y, 0);

          // Всегда добавляем первую точку первого сегмента
          if (i === 0) {
            allPoints.push(p1);
          }

          // Если у вершины есть bulge - создаём дугу, иначе прямую линию
          if (v1.bulge && Math.abs(v1.bulge) > EPSILON) {
            const arcPoints = createBulgeArc(p1, p2, v1.bulge);
            // Пропускаем первую точку дуги (она уже добавлена как p1 или конец предыдущего сегмента)
            allPoints.push(...arcPoints.slice(1));
          } else {
            // Прямая линия - добавляем конечную точку сегмента
            allPoints.push(p2);
          }
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(allPoints);
        return new THREE.Line(geometry, lineMaterial);
      }
      break;
    }

    case "SPLINE": {
      if (isSplineEntity(entity)) {
        // Если есть NURBS данные (degree, knots, controlPoints) - используем NURBSCurve
        if (
          entity.controlPoints &&
          entity.controlPoints.length > 1 &&
          entity.degreeOfSplineCurve !== undefined &&
          entity.knotValues &&
          entity.knotValues.length > 0
        ) {
          const degree = entity.degreeOfSplineCurve;
          const knots = entity.knotValues;

          // Преобразуем controlPoints в Vector4 с весами (weights)
          // Если weights нет - используем 1.0 для всех точек
          const controlPoints = entity.controlPoints.map((vertex: DxfVertex, i: number) => {
            const weight = entity.weights?.[i] ?? 1.0;
            return new THREE.Vector4(vertex.x, vertex.y, 0, weight);
          });

          try {
            // startKnot/endKnot — индексы в массиве knots, ограничивающие валидный диапазон
            // Для периодических сплайнов knots[0] < knots[degree], и без ограничения кривая "улетает"
            const startKnot = degree;
            const endKnot = controlPoints.length;
            const curve = new NURBSCurve(degree, knots, controlPoints, startKnot, endKnot);

            // Количество сегментов для отрисовки: пропорционально количеству контрольных точек
            const segments = Math.max(
              controlPoints.length * NURBS_SEGMENTS_MULTIPLIER,
              MIN_NURBS_SEGMENTS,
            );
            const interpolatedPoints = curve.getPoints(segments);

            const geometry = new THREE.BufferGeometry().setFromPoints(interpolatedPoints);
            return new THREE.Line(geometry, lineMaterial);
          } catch (error) {
            console.warn("⚠️ Ошибка создания NURBS, используем fallback:", error);
          }
        }

        // Fallback: если нет NURBS данных, используем fitPoints/vertices
        const splinePoints = entity.fitPoints || entity.vertices || entity.controlPoints;
        if (splinePoints && splinePoints.length > 1) {
          const points = splinePoints.map(
            (vertex: DxfVertex) => new THREE.Vector3(vertex.x, vertex.y, 0),
          );

          const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
          const segments = Math.max(
            points.length * CATMULL_ROM_SEGMENTS_MULTIPLIER,
            MIN_CATMULL_ROM_SEGMENTS,
          );
          const interpolatedPoints = curve.getPoints(segments);

          const geometry = new THREE.BufferGeometry().setFromPoints(interpolatedPoints);
          return new THREE.Line(geometry, lineMaterial);
        }
      }
      break;
    }

    case "TEXT": {
      if (isTextEntity(entity)) {
        const textPosition = entity.position || entity.startPoint;
        const textContent = entity.text;
        const textHeight = entity.height || entity.textHeight || TEXT_HEIGHT;
        const hAlign = getTextHAlign(entity.halign);
        const vAlign = getTextVAlign(entity.valign);

        if (textPosition && textContent) {
          const textMesh = createTextMesh(
            replaceSpecialChars(textContent),
            textHeight,
            entityColor,
            false,
            false,
            hAlign,
            "Arial",
            vAlign,
          );
          textMesh.position.set(textPosition.x, textPosition.y, 0);

          if (entity.rotation) {
            const rotationRadians = (entity.rotation * Math.PI) / DEGREES_TO_RADIANS_DIVISOR;
            textMesh.rotation.z = rotationRadians;
          }

          return textMesh;
        }
      }
      break;
    }

    case "MTEXT": {
      if (isTextEntity(entity)) {
        const textPosition = entity.position || entity.startPoint;
        const textContent = entity.text;
        const defaultHeight = entity.height || entity.textHeight || TEXT_HEIGHT;
        const hAlign = getMTextHAlign(entity.attachmentPoint);
        const vAlign = getMTextVAlign(entity.attachmentPoint);

        if (textPosition && textContent) {
          const lines = parseMTextContent(textContent);

          if (lines.length === 1) {
            // Одна строка — простой меш
            const line = lines[0];
            const h = line.height || defaultHeight;
            const c = line.color || entityColor;
            const textMesh = createTextMesh(
              line.text,
              h,
              c,
              line.bold,
              line.italic,
              hAlign,
              line.fontFamily,
              vAlign,
            );
            textMesh.position.set(textPosition.x, textPosition.y, 0);

            if (entity.rotation) {
              const rotationRadians = (entity.rotation * Math.PI) / DEGREES_TO_RADIANS_DIVISOR;
              textMesh.rotation.z = rotationRadians;
            }

            return textMesh;
          }

          // Многострочный текст — Group с мешем на каждую строку
          // Все строки выравниваем с vAlign="top": origin каждого меша на верхнем крае
          const textGroup = new THREE.Group();
          const LINE_SPACING = 1.4;
          let yOffset = 0;
          let totalHeight = 0;

          for (const line of lines) {
            const h = line.height || defaultHeight;
            const c = line.color || entityColor;
            const mesh = createTextMesh(
              line.text,
              h,
              c,
              line.bold,
              line.italic,
              hAlign,
              line.fontFamily,
              "top",
            );
            mesh.position.set(0, yOffset, 0);
            textGroup.add(mesh);
            yOffset -= h * LINE_SPACING;
            totalHeight += h * LINE_SPACING;
          }
          // Корректируем totalHeight: последняя строка без trailing spacing
          const lastLineHeight = lines[lines.length - 1].height || defaultHeight;
          totalHeight = totalHeight - lastLineHeight * LINE_SPACING + lastLineHeight;

          // Вертикальное смещение группы в зависимости от vAlign
          let groupYOffset = 0;
          if (vAlign === "middle") {
            groupYOffset = totalHeight / 2;
          } else if (vAlign === "bottom") {
            groupYOffset = totalHeight;
          }
          // Top: без смещения (строки идут вниз от позиции)

          textGroup.position.set(textPosition.x, textPosition.y + groupYOffset, 0);

          if (entity.rotation) {
            const rotationRadians = (entity.rotation * Math.PI) / DEGREES_TO_RADIANS_DIVISOR;
            textGroup.rotation.z = rotationRadians;
          }

          return textGroup;
        }
      }
      break;
    }

    case "DIMENSION": {
      if (isDimensionEntity(entity)) {
        const baseDimType = (entity.dimensionType ?? 0) & 0x0f;

        // Ordinate dimension (тип 6 = Y-ordinate, тип 7 = X-ordinate)
        if ((baseDimType & 0x0e) === 6) {
          return createOrdinateDimension(entity, entityColor);
        }

        // Radial dimension (тип 4)
        if (baseDimType === 4) {
          return createRadialDimension(entity, entityColor);
        }

        const dimData = extractDimensionData(entity);
        if (!dimData) {
          break;
        }

        const dimGroup = createDimensionGroup(
          dimData.point1,
          dimData.point2,
          dimData.anchorPoint,
          dimData.textPos,
          dimData.textHeight,
          dimData.isRadial,
          entityColor,
          dimData.angle,
        );

        const objects: THREE.Object3D[] = [dimGroup];

        if (dimData.textPos) {
          const textMesh = createDimensionTextMesh(
            dimData.dimensionText,
            dimData.textHeight,
            entityColor,
          );
          textMesh.position.set(dimData.textPos.x, dimData.textPos.y, 0.2);

          if (dimData.angle !== 0) {
            const rotationRadians = (dimData.angle * Math.PI) / DEGREES_TO_RADIANS_DIVISOR;
            textMesh.rotation.z = rotationRadians;
          }

          objects.push(textMesh);
        }

        return objects;
      }
      break;
    }

    case "SOLID": {
      if (isSolidEntity(entity)) {
        const pts = entity.points;
        if (!pts || pts.length < 3) break;

        const geometry = new THREE.BufferGeometry();
        const vertices: number[] = [];
        const indices: number[] = [];

        for (const p of pts) {
          vertices.push(p.x, p.y, p.z || 0);
        }

        // Треугольник или четырёхугольник (два треугольника)
        indices.push(0, 1, 2);
        if (pts.length >= 4) {
          indices.push(0, 2, 3);
        }

        geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        const material = new THREE.MeshBasicMaterial({
          color: entityColor,
          side: THREE.DoubleSide,
        });
        return new THREE.Mesh(geometry, material);
      }
      break;
    }

    case "3DFACE": {
      if (is3DFaceEntity(entity)) {
        const pts = entity.vertices;
        if (!pts || pts.length < 3) break;

        const geometry = new THREE.BufferGeometry();
        const vertices: number[] = [];
        const indices: number[] = [];

        for (const p of pts) {
          vertices.push(p.x, p.y, p.z || 0);
        }

        indices.push(0, 1, 2);
        if (pts.length >= 4) {
          indices.push(0, 2, 3);
        }

        geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        const material = new THREE.MeshBasicMaterial({
          color: entityColor,
          side: THREE.DoubleSide,
        });
        return new THREE.Mesh(geometry, material);
      }
      break;
    }

    case "POINT": {
      if (isPointEntity(entity)) {
        const pos = entity.position;

        // Точка: одна вершина, рендерится как GL_POINTS
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(pos.x, pos.y, 0),
        ]);
        const pointMaterial = new THREE.PointsMaterial({
          color: entityColor,
          size: POINT_MARKER_SIZE,
          sizeAttenuation: false,
        });
        return new THREE.Points(geometry, pointMaterial);
      }
      break;
    }

    case "INSERT": {
      const blockGroup = createBlockGroup(entity, dxf, colorCtx, depth);
      return blockGroup;
    }

    case "HATCH": {
      if (isHatchEntity(entity) && entity.boundaryPaths.length > 0) {
        if (entity.solid) {
          // Solid fill — ShapeGeometry + MeshBasicMaterial
          const shapes: THREE.Shape[] = [];

          for (let i = 0; i < entity.boundaryPaths.length; i++) {
            const sp = boundaryPathToShapePath(entity.boundaryPaths[i]);
            if (!sp) continue;
            const pathShapes = sp.toShapes(false);
            shapes.push(...pathShapes);
          }

          if (shapes.length === 0) break;

          // Если несколько shapes — первый основной, остальные holes
          // (Если в DXF отдельные контуры, ShapeGeometry обработает каждый)
          const geometry = new THREE.ShapeGeometry(shapes);
          const material = new THREE.MeshBasicMaterial({
            color: entityColor,
            side: THREE.DoubleSide,
          });
          return new THREE.Mesh(geometry, material);
        } else {
          // Pattern hatch — контуры + линии паттерна
          const objects: THREE.Object3D[] = [];

          // Контуры boundary
          for (const bp of entity.boundaryPaths) {
            const pts = boundaryPathToLinePoints(bp);
            if (pts.length > 1) {
              const geometry = new THREE.BufferGeometry().setFromPoints(pts);
              objects.push(new THREE.Line(geometry, lineMaterial));
            }
          }

          // Линии паттерна внутри boundary
          if (entity.patternLines && entity.patternLines.length > 0) {
            // Собираем полигон из первого boundary path (основной контур)
            const boundaryPts = boundaryPathToLinePoints(entity.boundaryPaths[0]);
            if (boundaryPts.length > 2) {
              const polygon: Point2D[] = boundaryPts.map((v) => ({ x: v.x, y: v.y }));
              const segments = generateHatchPattern(entity.patternLines, polygon);
              for (const seg of segments) {
                const geometry = new THREE.BufferGeometry().setFromPoints(seg);
                objects.push(new THREE.Line(geometry, lineMaterial));
              }
            }
          }

          return objects.length > 0 ? objects : null;
        }
      }
      break;
    }

    default:
      return null;
  }

  return null;
};

// Создание Three.js объектов из DXF данных
export function createThreeObjectsFromDXF(dxf: DxfData): {
  group: THREE.Group;
  warnings?: string;
  unsupportedEntities?: string[];
} {
  const group = new THREE.Group();

  if (!dxf.entities || dxf.entities.length === 0) {
    console.warn("⚠️ DXF не содержит entities!");
    return { group };
  }

  // Извлекаем слои из tables
  const layers: Record<string, DxfLayer> = {};
  if (dxf.tables?.layer?.layers) {
    Object.assign(layers, dxf.tables.layer.layers);
  }

  // Контекст цвета с кешем материалов
  const colorCtx: EntityColorContext = {
    layers,
    materialCache: new Map(),
  };

  const errors: string[] = [];
  const unsupportedTypes: string[] = [];

  dxf.entities.forEach((entity: DxfEntity, index: number) => {
    try {
      const obj = processEntity(entity, dxf, colorCtx, 0);
      if (obj) {
        // Сохраняем имя слоя в userData для управления видимостью
        setLayerName(obj, entity.layer || "0");

        if (Array.isArray(obj)) {
          obj.forEach((o) => group.add(o));
        } else {
          group.add(obj);
        }
      } else {
        unsupportedTypes.push(`Entity ${index}: ${entity.type || "unknown type"}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      errors.push(`Entity ${index} (${entity.type || "unknown type"}): ${errorMsg}`);
    }
  });

  // Формируем итоговое предупреждение
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
