// Создание геометрии Three.js из DXF данных
import * as THREE from "three";
import { NURBSCurve } from "three/examples/jsm/curves/NURBSCurve.js";
import type { DxfVertex, DxfEntity, DxfData, DxfDimensionEntity, DxfLayer } from "@/types/dxf";
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
import { resolveEntityColor } from "@/utils/colorResolver";

/** Контекст цвета для передачи в processEntity */
interface EntityColorContext {
  layers: Record<string, DxfLayer>;
  blockColor?: string; // Цвет INSERT entity для ByBlock наследования
  materialCache: Map<string, THREE.LineBasicMaterial>; // Кеш материалов по цвету
}

/** Получить LineBasicMaterial из кеша или создать новый */
const getLineMaterial = (color: string, cache: Map<string, THREE.LineBasicMaterial>): THREE.LineBasicMaterial => {
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
const createBulgeArc = (
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  bulge: number,
): THREE.Vector3[] => {
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

  // Расстояние от середины хорды до центра окружности
  // h = r * cos(θ/2) или h = sqrt(r² - (L/2)²)
  const h = Math.abs(radius * Math.cos(theta / 2));

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
  // Направление зависит от знака bulge
  const centerX = midX + perpX * h * Math.sign(bulge);
  const centerY = midY + perpY * h * Math.sign(bulge);

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
  const segments = Math.max(MIN_ARC_SEGMENTS, Math.floor(Math.abs(sweepAngle) * CIRCLE_SEGMENTS / (2 * Math.PI)));

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
const createExtensionLine = (
  from: THREE.Vector3,
  to: THREE.Vector3,
  material: THREE.LineBasicMaterial | THREE.LineDashedMaterial,
): THREE.Line => {
  const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
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

  if (!dimensionText && typeof entity.actualMeasurement === "number") {
    dimensionText = entity.actualMeasurement.toFixed(DIM_TEXT_DECIMAL_PLACES);
  }

  if (!point1 && !point2 && diameterOrRadiusPoint && anchorPoint) {
    point1 = diameterOrRadiusPoint;
    point2 = anchorPoint;
    isRadial = true;
  }

  // Вычислить измерение из координат если текст не задан в DXF
  if (!dimensionText && point1 && point2) {
    const dx = point2.x - point1.x;
    const dy = point2.y - point1.y;
    const dz = (point2.z || 0) - (point1.z || 0);
    const measurement = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dimensionText = measurement.toFixed(DIM_TEXT_DECIMAL_PLACES);
  }

  if (dimensionText && !isNaN(parseFloat(dimensionText))) {
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

  // Определяем ориентацию размерности по разбросу точек измерения
  const spreadX = Math.abs(point2.x - point1.x);
  const spreadY = Math.abs(point2.y - point1.y);
  const isHorizontal = spreadX >= spreadY;

  // Создаем линии и стрелки для линейной размерности
  const dimensionObjects = createLinearDimensionLines(
    point1,
    point2,
    anchorPoint,
    textPos,
    dimLineMaterial,
    extensionLineMaterial,
    arrowMaterial,
    isHorizontal,
  );

  dimensionObjects.forEach((obj) => dimGroup.add(obj));

  return dimGroup;
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

/**
 * Создание текстового меша с использованием Canvas текстуры
 * @param color - Цвет текста (hex строка)
 */
const createTextMesh = (text: string, height: number, color: string): THREE.Mesh => {
  const CANVAS_SCALE = 10; // коэффициент увеличения разрешения для четкости текстуры
  const TEXT_CANVAS_PADDING = 4;
  const TEXT_HEIGHT_MULTIPLIER = 1.2;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;

  const fontSize = Math.max(height * CANVAS_SCALE, TEXT_HEIGHT);
  const font = `${fontSize}px Arial, sans-serif`;
  context.font = font;
  const textMetrics = context.measureText(text);

  const canvasWidth = Math.ceil(textMetrics.width) + TEXT_CANVAS_PADDING * 2;
  const canvasHeight = Math.ceil(fontSize * TEXT_HEIGHT_MULTIPLIER) + TEXT_CANVAS_PADDING * 2;

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  context.font = font;
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
  const geometry = new THREE.PlaneGeometry(height * aspectRatio, height);

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
 * Установить layerName в userData объекта
 */
const setLayerName = (obj: THREE.Object3D | THREE.Object3D[], layerName: string) => {
  if (Array.isArray(obj)) {
    obj.forEach((o) => { o.userData.layerName = layerName; });
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
          points.push(new THREE.Vector3(
            entity.center.x + entity.radius * Math.cos(angle),
            entity.center.y + entity.radius * Math.sin(angle),
            0,
          ));
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
        const segments = Math.max(MIN_ARC_SEGMENTS, Math.floor(sweepAngle * CIRCLE_SEGMENTS / (2 * Math.PI)));

        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= segments; i++) {
          const angle = startAngle + (i / segments) * sweepAngle;
          points.push(new THREE.Vector3(
            entity.center.x + entity.radius * Math.cos(angle),
            entity.center.y + entity.radius * Math.sin(angle),
            0,
          ));
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
          Math.floor(Math.abs(sweepAngle) * CIRCLE_SEGMENTS / (2 * Math.PI)),
        );

        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= segments; i++) {
          const t = startAngle + (i / segments) * sweepAngle;
          // Параметрическое уравнение эллипса с поворотом
          const localX = majorLength * Math.cos(t);
          const localY = minorLength * Math.sin(t);
          const worldX = entity.center.x + localX * Math.cos(rotation) - localY * Math.sin(rotation);
          const worldY = entity.center.y + localX * Math.sin(rotation) + localY * Math.cos(rotation);
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
        if (entity.controlPoints && entity.controlPoints.length > 1 &&
            entity.degreeOfSplineCurve !== undefined &&
            entity.knotValues && entity.knotValues.length > 0) {

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
            const segments = Math.max(controlPoints.length * NURBS_SEGMENTS_MULTIPLIER, MIN_NURBS_SEGMENTS);
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

          const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
          const segments = Math.max(points.length * CATMULL_ROM_SEGMENTS_MULTIPLIER, MIN_CATMULL_ROM_SEGMENTS);
          const interpolatedPoints = curve.getPoints(segments);

          const geometry = new THREE.BufferGeometry().setFromPoints(interpolatedPoints);
          return new THREE.Line(geometry, lineMaterial);
        }
      }
      break;
    }

    case "TEXT":
    case "MTEXT": {
      if (isTextEntity(entity)) {
        const textPosition = entity.position || entity.startPoint;
        const textContent = entity.text;
        const textHeight = entity.height || entity.textHeight || TEXT_HEIGHT;

        if (textPosition && textContent) {
          const textMesh = createTextMesh(textContent, textHeight, entityColor);
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

    case "DIMENSION": {
      if (isDimensionEntity(entity)) {
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
        );

        const objects: THREE.Object3D[] = [dimGroup];

        if (dimData.textPos) {
          const textMesh = createTextMesh(dimData.dimensionText, dimData.textHeight, entityColor);
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
        const size = POINT_MARKER_SIZE;

        // Крестик: две линии (горизонтальная + вертикальная)
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(pos.x - size, pos.y, 0),
          new THREE.Vector3(pos.x + size, pos.y, 0),
          new THREE.Vector3(pos.x, pos.y - size, 0),
          new THREE.Vector3(pos.x, pos.y + size, 0),
        ]);
        return new THREE.LineSegments(geometry, lineMaterial);
      }
      break;
    }

    case "INSERT": {
      const blockGroup = createBlockGroup(entity, dxf, colorCtx, depth);
      return blockGroup;
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
