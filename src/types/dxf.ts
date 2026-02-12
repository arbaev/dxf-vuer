// Типы для работы с DXF

export interface DxfVertex {
  x: number;
  y: number;
  z?: number;
  bulge?: number; // Коэффициент изгиба для создания дуг в POLYLINE (0 = прямая, ±1 = полукруг)
}

// Общие поля для всех entity
interface DxfEntityBase {
  handle?: string | number;
  ownerHandle?: string | number;
  layer?: string;
}

export interface DxfLineEntity extends DxfEntityBase {
  type: "LINE";
  vertices: [DxfVertex, DxfVertex];
}

export interface DxfCircleEntity extends DxfEntityBase {
  type: "CIRCLE";
  center: DxfVertex;
  radius: number;
}

export interface DxfArcEntity extends DxfEntityBase {
  type: "ARC";
  center: DxfVertex;
  radius: number;
  startAngle: number;
  endAngle: number;
}

export interface DxfPolylineEntity extends DxfEntityBase {
  type: "POLYLINE" | "LWPOLYLINE";
  vertices: DxfVertex[];
}

export interface DxfSplineEntity extends DxfEntityBase {
  type: "SPLINE";
  controlPoints?: DxfVertex[];
  fitPoints?: DxfVertex[];
  vertices?: DxfVertex[];
  degree?: number;
  // NURBS данные
  degreeOfSplineCurve?: number;
  knotValues?: number[];
  weights?: number[];
  numberOfControlPoints?: number;
  numberOfKnots?: number;
  closed?: boolean;
  periodic?: boolean;
  planar?: boolean;
}

export interface DxfTextEntity extends DxfEntityBase {
  type: "TEXT" | "MTEXT";
  text: string;
  position?: DxfVertex;
  startPoint?: DxfVertex;
  height?: number;
  textHeight?: number;
  rotation?: number;
  halign?: number;
  valign?: number;
}

export interface DxfDimensionEntity extends DxfEntityBase {
  type: "DIMENSION";
  text?: string;
  actualMeasurement?: number;
  dimensionType?: number;
  attachmentPoint?: number;
  // Точки для линейных/угловых размерностей
  linearOrAngularPoint1?: DxfVertex;
  linearOrAngularPoint2?: DxfVertex;
  // Точки для радиальных/диаметральных размерностей
  diameterOrRadiusPoint?: DxfVertex;
  // Общие точки
  anchorPoint?: DxfVertex;
  defPoint?: DxfVertex;
  defPoint2?: DxfVertex;
  defPoint3?: DxfVertex;
  defPoint4?: DxfVertex;
  defPoint5?: DxfVertex;
  middleOfText?: DxfVertex;
  textMidPoint?: DxfVertex;
  height?: number;
  textHeight?: number;
  angle?: number;
  block?: string;
  blockName?: string;
}

export interface DxfInsertEntity extends DxfEntityBase {
  type: "INSERT";
  name: string;
  position: DxfVertex;
  rotation?: number;
  xScale?: number;
  yScale?: number;
  zScale?: number;
  columnCount?: number;
  rowCount?: number;
  columnSpacing?: number;
  rowSpacing?: number;
}

export interface DxfSolidEntity extends DxfEntityBase {
  type: "SOLID";
  points: [DxfVertex, DxfVertex, DxfVertex, DxfVertex];
}

// Для неизвестных или неподдерживаемых типов
export interface DxfUnknownEntity extends DxfEntityBase {
  type: string;
  [key: string]: unknown;
}

export type DxfEntity =
  | DxfLineEntity
  | DxfCircleEntity
  | DxfArcEntity
  | DxfPolylineEntity
  | DxfSplineEntity
  | DxfTextEntity
  | DxfDimensionEntity
  | DxfInsertEntity
  | DxfSolidEntity
  | DxfUnknownEntity;

export function isLineEntity(entity: DxfEntity): entity is DxfLineEntity {
  return entity.type === "LINE";
}

export function isCircleEntity(entity: DxfEntity): entity is DxfCircleEntity {
  return entity.type === "CIRCLE";
}

export function isArcEntity(entity: DxfEntity): entity is DxfArcEntity {
  return entity.type === "ARC";
}

export function isPolylineEntity(entity: DxfEntity): entity is DxfPolylineEntity {
  return entity.type === "POLYLINE" || entity.type === "LWPOLYLINE";
}

export function isSplineEntity(entity: DxfEntity): entity is DxfSplineEntity {
  return entity.type === "SPLINE";
}

export function isTextEntity(entity: DxfEntity): entity is DxfTextEntity {
  return entity.type === "TEXT" || entity.type === "MTEXT";
}

export function isDimensionEntity(entity: DxfEntity): entity is DxfDimensionEntity {
  return entity.type === "DIMENSION";
}

export function isInsertEntity(entity: DxfEntity): entity is DxfInsertEntity {
  return entity.type === "INSERT";
}

export function isSolidEntity(entity: DxfEntity): entity is DxfSolidEntity {
  return entity.type === "SOLID";
}

export interface DxfBlock {
  entities: DxfEntity[];
  name?: string;
  name2?: string;
  type?: number;
  handle?: string;
  ownerHandle?: string;
  layer?: string;
  position?: DxfVertex;
  paperSpace?: boolean;
  xrefPath?: string;
}

export interface DxfData {
  entities: DxfEntity[];
  header?: Record<string, unknown>;
  tables?: Record<string, unknown>;
  blocks?: Record<string, DxfBlock>;
}

export interface DxfStatistics {
  fileName: string;
  fileSize: number; // в байтах
  totalEntities: number;
  entitiesByType: Record<string, number>;
  layersCount: number;
  blocksCount: number;
  autocadVersion?: string;
}
