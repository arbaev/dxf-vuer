// Общие утилиты для создания геометрических примитивов из DXF данных
import * as THREE from "three";
import type { DxfLayer } from "@/types/dxf";
import {
  EPSILON,
  CIRCLE_SEGMENTS,
  MIN_ARC_SEGMENTS,
  ARROW_BASE_WIDTH_DIVISOR,
  DEGREES_TO_RADIANS_DIVISOR,
  POINT_MARKER_SIZE,
} from "@/constants";

/** Контекст цвета для передачи в processEntity */
export interface EntityColorContext {
  layers: Record<string, DxfLayer>;
  blockColor?: string; // Цвет INSERT entity для ByBlock наследования
  materialCache: Map<string, THREE.LineBasicMaterial>; // Кеш линейных материалов по цвету
  meshMaterialCache: Map<string, THREE.MeshBasicMaterial>; // Кеш mesh материалов (color + DoubleSide)
  pointsMaterialCache: Map<string, THREE.PointsMaterial>; // Кеш материалов для точек
}

/** Преобразование градусов в радианы */
export const degreesToRadians = (degrees: number): number =>
  (degrees * Math.PI) / DEGREES_TO_RADIANS_DIVISOR;

/** Получить LineBasicMaterial из кеша или создать новый */
export const getLineMaterial = (
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

/** Получить MeshBasicMaterial (color + DoubleSide) из кеша или создать новый */
export const getMeshMaterial = (
  color: string,
  cache: Map<string, THREE.MeshBasicMaterial>,
): THREE.MeshBasicMaterial => {
  let mat = cache.get(color);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    cache.set(color, mat);
  }
  return mat;
};

/** Получить PointsMaterial из кеша или создать новый */
export const getPointsMaterial = (
  color: string,
  cache: Map<string, THREE.PointsMaterial>,
): THREE.PointsMaterial => {
  let mat = cache.get(color);
  if (!mat) {
    mat = new THREE.PointsMaterial({
      color,
      size: POINT_MARKER_SIZE,
      sizeAttenuation: false,
    });
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
export const createBulgeArc = (
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
 * Создание стрелки (треугольника) для размерных линий.
 * Направление вычисляется как from → tip (нормализованный вектор).
 * @param from - Точка, откуда идёт линия (определяет направление стрелки)
 * @param tip - Острие стрелки (вершина треугольника)
 * @param size - Длина стрелки
 * @param material - Материал для отрисовки
 */
export const createArrow = (
  from: THREE.Vector3,
  tip: THREE.Vector3,
  size: number,
  material: THREE.Material,
): THREE.Mesh => {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const dirX = len > EPSILON ? dx / len : 1;
  const dirY = len > EPSILON ? dy / len : 0;

  const width = size / ARROW_BASE_WIDTH_DIVISOR;

  const perpX = dirY;
  const perpY = -dirX;

  const base1 = new THREE.Vector3(
    tip.x - dirX * size + perpX * width,
    tip.y - dirY * size + perpY * width,
    tip.z,
  );

  const base2 = new THREE.Vector3(
    tip.x - dirX * size - perpX * width,
    tip.y - dirY * size - perpY * width,
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

  return new THREE.Mesh(geometry, material);
};

/**
 * Установить layerName в userData объекта
 */
export const setLayerName = (obj: THREE.Object3D | THREE.Object3D[], layerName: string) => {
  if (Array.isArray(obj)) {
    obj.forEach((o) => {
      o.userData.layerName = layerName;
    });
  } else {
    obj.userData.layerName = layerName;
  }
};
