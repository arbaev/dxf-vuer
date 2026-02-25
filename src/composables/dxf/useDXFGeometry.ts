// Создание геометрии Three.js из DXF данных
import * as THREE from "three";
import { NURBSCurve } from "three/examples/jsm/curves/NURBSCurve.js";
import type { DxfVertex, DxfEntity, DxfData, DxfLayer } from "@/types/dxf";
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
  isLeaderEntity,
  isMLeaderEntity,
} from "@/types/dxf";
import {
  TEXT_HEIGHT,
  CIRCLE_SEGMENTS,
  DEGREES_TO_RADIANS_DIVISOR,
  EPSILON,
  MIN_ARC_SEGMENTS,
  NURBS_SEGMENTS_MULTIPLIER,
  MIN_NURBS_SEGMENTS,
  CATMULL_ROM_SEGMENTS_MULTIPLIER,
  MIN_CATMULL_ROM_SEGMENTS,
  ARROW_SIZE,
} from "@/constants";
import { resolveEntityColor } from "@/utils/colorResolver";

// Модули геометрии
import {
  type EntityColorContext,
  degreesToRadians,
  getLineMaterial,
  getMeshMaterial,
  getPointsMaterial,
  createBulgeArc,
  createArrow,
  setLayerName,
} from "./geometry/primitives";
import {
  extractDimensionData,
  createDimensionGroup,
  createDimensionTextMesh,
  createOrdinateDimension,
  createRadialDimension,
  createDiametricDimension,
  createAngularDimension,
} from "./geometry/dimensions";
import {
  replaceSpecialChars,
  parseMTextContent,
  getMTextHAlign,
  getTextHAlign,
  getMTextVAlign,
  getTextVAlign,
  createStackedTextMesh,
  createTextMesh,
} from "./geometry/text";
import {
  boundaryPathToShapePath,
  boundaryPathToLinePoints,
  generateHatchPattern,
  type Point2D,
} from "./geometry/hatch";

/**
 * Создание Three.js Mesh для треугольника/четырёхугольника (SOLID, 3DFACE)
 */
const createFaceMesh = (
  pts: DxfVertex[],
  material: THREE.MeshBasicMaterial,
): THREE.Mesh | null => {
  if (!pts || pts.length < 3) return null;

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

  return new THREE.Mesh(geometry, material);
};

/**
 * Создание группы объектов для блока (INSERT entity)
 * @param insertEntity - INSERT entity с ссылкой на блок
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
    meshMaterialCache: colorCtx.meshMaterialCache,
    pointsMaterialCache: colorCtx.pointsMaterialCache,
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

  const xScale = insertEntity.xScale || 1;
  const yScale = insertEntity.yScale || 1;
  const zScale = insertEntity.zScale || 1;
  blockGroup.scale.set(xScale, yScale, zScale);

  if (insertEntity.rotation) {
    blockGroup.rotation.z = degreesToRadians(insertEntity.rotation);
  }

  return blockGroup;
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

        // Замыкающий сегмент для closed полилиний (shape = true)
        if (entity.shape && entity.vertices.length > 2) {
          const vLast = entity.vertices[entity.vertices.length - 1];
          const vFirst = entity.vertices[0];
          const pLast = new THREE.Vector3(vLast.x, vLast.y, 0);
          const pFirst = new THREE.Vector3(vFirst.x, vFirst.y, 0);

          if (vLast.bulge && Math.abs(vLast.bulge) > EPSILON) {
            const arcPoints = createBulgeArc(pLast, pFirst, vLast.bulge);
            allPoints.push(...arcPoints.slice(1));
          } else {
            allPoints.push(pFirst);
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
        // Пустой текст — пропускаем без ошибки
        if (!textContent) return new THREE.Group();
        const textHeight = entity.height || entity.textHeight || TEXT_HEIGHT;
        const hAlign = getTextHAlign(entity.halign);
        const vAlign = getTextVAlign(entity.valign);

        if (textPosition) {
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
            textMesh.rotation.z = degreesToRadians(entity.rotation);
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
        // Пустой текст — пропускаем без ошибки
        if (!textContent) return new THREE.Group();
        const defaultHeight = entity.height || entity.textHeight || TEXT_HEIGHT;
        const hAlign = getMTextHAlign(entity.attachmentPoint);
        const vAlign = getMTextVAlign(entity.attachmentPoint);

        if (textPosition) {
          const lines = parseMTextContent(textContent);

          if (lines.length === 1) {
            // Одна строка — простой меш (или stacked)
            const line = lines[0];
            const h = line.height || defaultHeight;
            const c = line.color || entityColor;
            const textMesh = (line.stackedTop || line.stackedBottom)
              ? createStackedTextMesh(
                  line.text,
                  line.stackedTop || "",
                  line.stackedBottom || "",
                  h,
                  c,
                  line.bold,
                  line.italic,
                  hAlign,
                  line.fontFamily,
                  vAlign,
                )
              : createTextMesh(
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
              textMesh.rotation.z = degreesToRadians(entity.rotation);
            } else if (entity.directionVector) {
              textMesh.rotation.z = Math.atan2(entity.directionVector.y, entity.directionVector.x);
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
            const mesh = (line.stackedTop || line.stackedBottom)
              ? createStackedTextMesh(
                  line.text,
                  line.stackedTop || "",
                  line.stackedBottom || "",
                  h,
                  c,
                  line.bold,
                  line.italic,
                  hAlign,
                  line.fontFamily,
                  "top",
                )
              : createTextMesh(
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
            textGroup.rotation.z = degreesToRadians(entity.rotation);
          } else if (entity.directionVector) {
            textGroup.rotation.z = Math.atan2(entity.directionVector.y, entity.directionVector.x);
          }

          return textGroup;
        }
      }
      break;
    }

    case "DIMENSION": {
      if (isDimensionEntity(entity)) {
        // Строим из семантических данных
        const baseDimType = (entity.dimensionType ?? 0) & 0x0f;

        // Ordinate dimension (тип 6 = Y-ordinate, тип 7 = X-ordinate)
        if ((baseDimType & 0x0e) === 6) {
          return createOrdinateDimension(entity, entityColor);
        }

        // Angular dimension (тип 2)
        if (baseDimType === 2) {
          return createAngularDimension(entity, entityColor);
        }

        // Diametric dimension (тип 3)
        if (baseDimType === 3) {
          return createDiametricDimension(entity, entityColor);
        }

        // Radial dimension (тип 4)
        if (baseDimType === 4) {
          return createRadialDimension(entity, entityColor);
        }

        const dimData = extractDimensionData(entity);
        if (!dimData) {
          break;
        }

        // Aligned dimension (тип 1): вычисляем угол из координат точек
        let dimAngle = dimData.angle;
        if (baseDimType === 1 && dimAngle === 0) {
          const dx = dimData.point2.x - dimData.point1.x;
          const dy = dimData.point2.y - dimData.point1.y;
          dimAngle = (Math.atan2(dy, dx) * DEGREES_TO_RADIANS_DIVISOR) / Math.PI;
        }

        const dimGroup = createDimensionGroup(
          dimData.point1,
          dimData.point2,
          dimData.anchorPoint,
          dimData.textPos,
          dimData.textHeight,
          dimData.isRadial,
          entityColor,
          dimAngle,
        );

        const objects: THREE.Object3D[] = [dimGroup];

        if (dimData.textPos) {
          const textMesh = createDimensionTextMesh(
            dimData.dimensionText,
            dimData.textHeight,
            entityColor,
          );
          textMesh.position.set(dimData.textPos.x, dimData.textPos.y, 0.2);

          if (dimAngle !== 0) {
            textMesh.rotation.z = degreesToRadians(dimAngle);
          }

          objects.push(textMesh);
        }

        return objects;
      }
      break;
    }

    case "SOLID": {
      if (isSolidEntity(entity)) {
        const meshMat = getMeshMaterial(entityColor, colorCtx.meshMaterialCache);
        return createFaceMesh(entity.points, meshMat);
      }
      break;
    }

    case "3DFACE": {
      if (is3DFaceEntity(entity)) {
        const meshMat = getMeshMaterial(entityColor, colorCtx.meshMaterialCache);
        return createFaceMesh(entity.vertices, meshMat);
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
        const pointMat = getPointsMaterial(entityColor, colorCtx.pointsMaterialCache);
        return new THREE.Points(geometry, pointMat);
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
          const meshMat = getMeshMaterial(entityColor, colorCtx.meshMaterialCache);
          return new THREE.Mesh(geometry, meshMat);
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

    case "LEADER": {
      if (isLeaderEntity(entity) && entity.vertices.length >= 2) {
        const points = entity.vertices.map(
          (v) => new THREE.Vector3(v.x, v.y, v.z || 0),
        );
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const leaderLine = new THREE.Line(geometry, lineMaterial);

        // Стрелка на первой вершине (если флаг arrowHeadFlag === 1)
        if (entity.arrowHeadFlag === 1 && points.length >= 2) {
          const group = new THREE.Group();
          group.add(leaderLine);
          const arrowMat = getMeshMaterial(entityColor, colorCtx.meshMaterialCache);
          const arrow = createArrow(points[1], points[0], ARROW_SIZE, arrowMat);
          group.add(arrow);
          return group;
        }
        return leaderLine;
      }
      break;
    }

    case "MULTILEADER":
    case "MLEADER": {
      if (isMLeaderEntity(entity) && entity.leaders.length > 0) {
        const group = new THREE.Group();
        const arrowSize = entity.arrowSize || ARROW_SIZE;
        const arrowMat = getMeshMaterial(entityColor, colorCtx.meshMaterialCache);

        for (const leader of entity.leaders) {
          for (const line of leader.lines) {
            if (line.vertices.length < 2) continue;
            const points = line.vertices.map(
              (v) => new THREE.Vector3(v.x, v.y, v.z || 0),
            );

            // Добавляем lastLeaderPoint как конечную точку (полка)
            if (leader.lastLeaderPoint) {
              points.push(new THREE.Vector3(
                leader.lastLeaderPoint.x,
                leader.lastLeaderPoint.y,
                leader.lastLeaderPoint.z || 0,
              ));
            }

            const geo = new THREE.BufferGeometry().setFromPoints(points);
            group.add(new THREE.Line(geo, lineMaterial));

            // Стрелка на первой вершине
            if (entity.hasArrowHead !== false && points.length >= 2) {
              const arrow = createArrow(points[1], points[0], arrowSize, arrowMat);
              group.add(arrow);
            }
          }
        }

        // Текст
        if (entity.text && entity.textPosition) {
          const textHeight = entity.textHeight || TEXT_HEIGHT;
          const textContent = replaceSpecialChars(entity.text);
          if (textContent) {
            const textMesh = createTextMesh(
              textContent,
              textHeight,
              entityColor,
              false,
              false,
              "left",
              "Arial",
              "middle",
            );
            textMesh.position.set(
              entity.textPosition.x,
              entity.textPosition.y,
              0,
            );
            group.add(textMesh);
          }
        }

        return group.children.length > 0 ? group : null;
      }
      break;
    }

    // Распознанные, но не рендерящиеся entity — тихий пропуск (не unsupported)
    case "VIEWPORT":
    case "IMAGE":
    case "WIPEOUT":
    case "ATTDEF":
      return new THREE.Group();

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

  // Контекст цвета с кешами материалов
  const colorCtx: EntityColorContext = {
    layers,
    materialCache: new Map(),
    meshMaterialCache: new Map(),
    pointsMaterialCache: new Map(),
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
