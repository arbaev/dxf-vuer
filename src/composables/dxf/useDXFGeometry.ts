// Создание геометрии Three.js из DXF данных
import * as THREE from "three";
import type { DxfVertex, DxfEntity, DxfData, DxfDimensionEntity } from "@/types/dxf";
import {
  isLineEntity,
  isCircleEntity,
  isArcEntity,
  isPolylineEntity,
  isSplineEntity,
  isTextEntity,
  isDimensionEntity,
  isInsertEntity,
} from "@/types/dxf";
import {
  TEXT_COLOR,
  LINE_COLOR,
  DIM_LINE_COLOR,
  TEXT_HEIGHT,
  DIM_TEXT_HEIGHT,
  DIM_TEXT_GAP,
  DIM_TEXT_DECIMAL_PLACES,
  ARROW_SIZE,
  ARROW_BASE_WIDTH_DIVISOR,
  CIRCLE_LINE_THICKNESS,
  CIRCLE_SEGMENTS,
  EXTENSION_LINE_DASH_SIZE,
  EXTENSION_LINE_GAP_SIZE,
  DEGREES_TO_RADIANS_DIVISOR,
} from "@/constants";

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
 * @param point1 - Первая точка измерения
 * @param point2 - Вторая точка измерения
 * @param anchorPoint - Точка якоря (положение размерной линии)
 * @param textPos - Позиция текста (для разрыва линии)
 * @param dimLineMaterial - Материал для размерной линии
 * @param extensionLineMaterial - Материал для выносных линий
 * @param arrowMaterial - Материал для стрелок
 * @param isHorizontal - true для горизонтальной, false для вертикальной
 * @returns Массив объектов Three.js для добавления в группу
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

  if (dimensionText && !isNaN(parseFloat(dimensionText))) {
    dimensionText = parseFloat(dimensionText).toFixed(DIM_TEXT_DECIMAL_PLACES);
  }

  if (!point1 && !point2 && diameterOrRadiusPoint && anchorPoint) {
    point1 = diameterOrRadiusPoint;
    point2 = anchorPoint;
    isRadial = true;
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
 */
const createDimensionGroup = (
  point1: DxfVertex,
  point2: DxfVertex,
  anchorPoint: DxfVertex,
  textPos: DxfVertex | undefined,
  _textHeight: number, // Параметр не используется, но оставлен для совместимости
  isRadial: boolean,
): THREE.Group => {
  const dimGroup = new THREE.Group();

  const dimLineMaterial = new THREE.LineBasicMaterial({ color: DIM_LINE_COLOR });
  const extensionLineMaterial = new THREE.LineDashedMaterial({
    color: DIM_LINE_COLOR,
    dashSize: EXTENSION_LINE_DASH_SIZE,
    gapSize: EXTENSION_LINE_GAP_SIZE,
  });
  const arrowMaterial = new THREE.MeshBasicMaterial({
    color: DIM_LINE_COLOR,
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

  // Определяем ориентацию размерности по положению точек
  const anchorOffsetX = Math.abs(anchorPoint.x - point1.x);
  const anchorOffsetY = Math.abs(anchorPoint.y - point1.y);
  const isHorizontal = anchorOffsetY > anchorOffsetX;

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
 * @param depth - Текущая глубина рекурсии (защита от бесконечной рекурсии)
 * @returns THREE.Group с отрендеренным блоком или null если блок не найден
 */
const createBlockGroup = (insertEntity: DxfEntity, dxf: DxfData, depth = 0): THREE.Group | null => {
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

  if (!block || !block.entities || block.entities.length === 0) {
    console.warn(`⚠️ Блок "${blockName}" не найден или пуст`);
    return null;
  }

  const blockGroup = new THREE.Group();
  const lineMaterial = new THREE.LineBasicMaterial({ color: LINE_COLOR });

  block.entities.forEach((entity: DxfEntity) => {
    try {
      const obj = processEntity(entity, dxf, lineMaterial, depth + 1);
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
 */
const createTextMesh = (text: string, height: number): THREE.Mesh => {
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
  context.fillStyle = TEXT_COLOR;
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
 * Обработка entity
 * @param entity - Entity для обработки
 * @param dxf - Данные DXF файла
 * @param lineMaterial - Материал для линий
 * @param depth - Глубина рекурсии для INSERT entities
 * @returns THREE.Object3D, массив объектов или null
 */
const processEntity = (
  entity: DxfEntity,
  dxf: DxfData,
  lineMaterial: THREE.LineBasicMaterial,
  depth = 0,
): THREE.Object3D | THREE.Object3D[] | null => {
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
        const geometry = new THREE.RingGeometry(
          entity.radius - CIRCLE_LINE_THICKNESS,
          entity.radius,
          CIRCLE_SEGMENTS,
        );
        const material = new THREE.MeshBasicMaterial({
          color: LINE_COLOR,
          side: THREE.DoubleSide,
        });
        const circle = new THREE.Mesh(geometry, material);
        circle.position.set(entity.center.x, entity.center.y, 0);
        return circle;
      }
      break;
    }

    case "ARC": {
      if (isArcEntity(entity)) {
        const geometry = new THREE.RingGeometry(
          entity.radius - CIRCLE_LINE_THICKNESS,
          entity.radius,
          CIRCLE_SEGMENTS,
          1,
          entity.startAngle,
          entity.endAngle - entity.startAngle,
        );
        const material = new THREE.MeshBasicMaterial({
          color: LINE_COLOR,
          side: THREE.DoubleSide,
        });
        const arc = new THREE.Mesh(geometry, material);
        arc.position.set(entity.center.x, entity.center.y, 0);
        return arc;
      }
      break;
    }

    case "LWPOLYLINE":
    case "POLYLINE": {
      if (isPolylineEntity(entity) && entity.vertices.length > 1) {
        const points = entity.vertices.map(
          (vertex: DxfVertex) => new THREE.Vector3(vertex.x, vertex.y, 0),
        );
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return new THREE.Line(geometry, lineMaterial);
      }
      break;
    }

    case "SPLINE": {
      if (isSplineEntity(entity)) {
        const splinePoints = entity.controlPoints || entity.fitPoints || entity.vertices;
        if (splinePoints && splinePoints.length > 1) {
          const points = splinePoints.map(
            (vertex: DxfVertex) => new THREE.Vector3(vertex.x, vertex.y, 0),
          );
          const geometry = new THREE.BufferGeometry().setFromPoints(points);
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
          const textMesh = createTextMesh(textContent, textHeight);
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
        );

        const objects: THREE.Object3D[] = [dimGroup];

        if (dimData.textPos) {
          const textMesh = createTextMesh(dimData.dimensionText, dimData.textHeight);
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

    case "INSERT": {
      const blockGroup = createBlockGroup(entity, dxf, depth);
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

  const lineMaterial = new THREE.LineBasicMaterial({
    color: LINE_COLOR,
  });

  const errors: string[] = [];
  const unsupportedTypes: string[] = [];

  dxf.entities.forEach((entity: DxfEntity, index: number) => {
    try {
      const obj = processEntity(entity, dxf, lineMaterial, 0);
      if (obj) {
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

    // КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: возвращаем unsupportedEntities для отображения на странице
    return {
      group,
      warnings: errorSummary,
      unsupportedEntities: unsupportedTypes.length > 0 ? unsupportedTypes : undefined,
    };
  }

  return { group };
}
