import * as THREE from "three";
import type { DxfVertex, HatchBoundaryPath, HatchEdge, HatchPatternLine } from "@/types/dxf";
import {
  EPSILON,
  MAX_HATCH_SEGMENTS,
  MAX_HATCH_LINES_PER_PATTERN,
  CIRCLE_SEGMENTS,
  MIN_ARC_SEGMENTS,
} from "@/constants";
import { createBulgeArc } from "./primitives";

/**
 * Получить начальную точку ребра HATCH
 */
const getEdgeStartPoint = (edge: HatchEdge): { x: number; y: number } => {
  if (edge.type === "line") {
    return { x: edge.start.x, y: edge.start.y };
  } else if (edge.type === "arc") {
    const startRad = (edge.startAngle * Math.PI) / 180;
    return {
      x: edge.center.x + edge.radius * Math.cos(startRad),
      y: edge.center.y + edge.radius * Math.sin(startRad),
    };
  } else if (edge.type === "ellipse") {
    const pts = ellipseEdgeToPoints(edge, 1);
    return pts.length > 0 ? { x: pts[0].x, y: pts[0].y } : { x: 0, y: 0 };
  } else if (edge.type === "spline") {
    const pts = splineEdgeToPoints(edge);
    return pts.length > 0 ? { x: pts[0].x, y: pts[0].y } : { x: 0, y: 0 };
  }
  return { x: 0, y: 0 };
};

/**
 * Вычислить точки эллиптического ребра HATCH
 * @param segmentOverride — количество сегментов (0 = авто)
 */
const ellipseEdgeToPoints = (
  edge: { center: DxfVertex; majorAxisEndPoint: DxfVertex; axisRatio: number; startAngle: number; endAngle: number; ccw: boolean },
  segmentOverride = 0,
): THREE.Vector3[] => {
  const majorX = edge.majorAxisEndPoint.x;
  const majorY = edge.majorAxisEndPoint.y;
  const majorLength = Math.sqrt(majorX * majorX + majorY * majorY);
  if (majorLength < EPSILON) return [];
  const minorLength = majorLength * edge.axisRatio;
  const rotation = Math.atan2(majorY, majorX);

  let startAngle = edge.startAngle; // уже в радианах для HATCH ellipse edge
  let endAngle = edge.endAngle;

  // Полный эллипс
  const isFullEllipse =
    Math.abs(endAngle - startAngle - 2 * Math.PI) < EPSILON ||
    (Math.abs(startAngle) < EPSILON && Math.abs(endAngle) < EPSILON);
  if (isFullEllipse) {
    startAngle = 0;
    endAngle = 2 * Math.PI;
  }

  let sweepAngle = endAngle - startAngle;
  if (edge.ccw) {
    if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
  } else {
    if (sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  }

  const segments = segmentOverride > 0 ? segmentOverride : Math.max(
    MIN_ARC_SEGMENTS,
    Math.floor((Math.abs(sweepAngle) * CIRCLE_SEGMENTS) / (2 * Math.PI)),
  );

  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = startAngle + (i / segments) * sweepAngle;
    const localX = majorLength * Math.cos(t);
    const localY = minorLength * Math.sin(t);
    const worldX = edge.center.x + localX * Math.cos(rotation) - localY * Math.sin(rotation);
    const worldY = edge.center.y + localX * Math.sin(rotation) + localY * Math.cos(rotation);
    points.push(new THREE.Vector3(worldX, worldY, 0));
  }
  return points;
};

/**
 * Вычислить точки сплайнового ребра HATCH (CatmullRom fallback)
 */
const splineEdgeToPoints = (
  edge: { degree: number; knots: number[]; controlPoints: DxfVertex[]; fitPoints?: DxfVertex[] },
): THREE.Vector3[] => {
  // Используем fitPoints если есть, иначе controlPoints
  const sourcePoints = edge.fitPoints && edge.fitPoints.length > 1
    ? edge.fitPoints
    : edge.controlPoints;

  if (!sourcePoints || sourcePoints.length < 2) return [];

  const pts = sourcePoints.map((p) => new THREE.Vector3(p.x, p.y, 0));

  // Простой случай — 2 точки = прямая
  if (pts.length === 2) return pts;

  // CatmullRom интерполяция
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  const segments = Math.max(pts.length * 4, 20);
  return curve.getPoints(segments);
};

/**
 * Конвертация boundary path HATCH в THREE.ShapePath (для Shape/Path)
 */
export const boundaryPathToShapePath = (bp: HatchBoundaryPath): THREE.ShapePath | null => {
  const shapePath = new THREE.ShapePath();

  if (bp.edges && bp.edges.length > 0) {
    // Edge-based boundary
    const firstEdge = bp.edges[0];
    const firstPt = getEdgeStartPoint(firstEdge);
    shapePath.moveTo(firstPt.x, firstPt.y);

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
 * Добавляет ребро HATCH (линия, дуга, эллипс, сплайн) в ShapePath
 */
export const addEdgeToPath = (shapePath: THREE.ShapePath, edge: HatchEdge): void => {
  if (!shapePath.currentPath) return;
  if (edge.type === "line") {
    shapePath.currentPath.lineTo(edge.end.x, edge.end.y);
  } else if (edge.type === "arc") {
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
  } else if (edge.type === "ellipse") {
    // Ellipse edge — аппроксимируем точками
    const pts = ellipseEdgeToPoints(edge);
    for (let i = 1; i < pts.length; i++) {
      shapePath.currentPath.lineTo(pts[i].x, pts[i].y);
    }
  } else if (edge.type === "spline") {
    // Spline edge — аппроксимируем точками
    const pts = splineEdgeToPoints(edge);
    for (let i = 1; i < pts.length; i++) {
      shapePath.currentPath.lineTo(pts[i].x, pts[i].y);
    }
  }
};

/**
 * Добавляет bulge-дугу между двумя вершинами полилайна в ShapePath
 */
export const addBulgeArcToPath = (
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
export const boundaryPathToLinePoints = (bp: HatchBoundaryPath): THREE.Vector3[] => {
  const points: THREE.Vector3[] = [];

  if (bp.edges && bp.edges.length > 0) {
    for (const edge of bp.edges) {
      if (edge.type === "line") {
        if (points.length === 0) {
          points.push(new THREE.Vector3(edge.start.x, edge.start.y, 0));
        }
        points.push(new THREE.Vector3(edge.end.x, edge.end.y, 0));
      } else if (edge.type === "arc") {
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
      } else if (edge.type === "ellipse") {
        const ePts = ellipseEdgeToPoints(edge);
        // Пропускаем первую точку если уже есть точки (чтобы не дублировать)
        const startIdx = points.length > 0 ? 1 : 0;
        for (let i = startIdx; i < ePts.length; i++) {
          points.push(ePts[i]);
        }
      } else if (edge.type === "spline") {
        const sPts = splineEdgeToPoints(edge);
        const startIdx = points.length > 0 ? 1 : 0;
        for (let i = startIdx; i < sPts.length; i++) {
          points.push(sPts[i]);
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

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Тест точки внутри полигона (ray casting алгоритм)
 */
export const pointInPolygon2D = (px: number, py: number, polygon: Point2D[]): boolean => {
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
export const clipSegmentToPolygon = (
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
export const generateHatchPattern = (
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

    // Защита от слишком большого количества линий
    if (endIdx - startIdx > MAX_HATCH_LINES_PER_PATTERN) continue;

    // Общая длина одного повтора дэш-паттерна
    const dashTotal = pl.dashes.reduce((s, d) => s + Math.abs(d), 0);
    // Если нет дэшей — сплошная линия
    const isSolid = pl.dashes.length === 0 || dashTotal < EPSILON;

    for (let i = startIdx; i <= endIdx; i++) {
      // Защита от слишком большого количества сегментов
      if (allSegments.length >= MAX_HATCH_SEGMENTS) break;

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

    // Защита от слишком большого количества сегментов (между patternLines)
    if (allSegments.length >= MAX_HATCH_SEGMENTS) break;
  }

  return allSegments;
};
