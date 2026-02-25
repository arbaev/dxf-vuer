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
  // Цвет и стиль (из dxf-parser IEntity)
  colorIndex?: number; // ACI индекс: 0=ByBlock, 1-255=цвет, 256=ByLayer
  color?: number; // RGB truecolor (DXF code 420)
  lineweight?: number; // -3=Standard, -2=ByLayer, -1=ByBlock, или значение в 0.01мм
  lineType?: string; // Тип линии (CONTINUOUS, DASHED и т.д.)
  visible?: boolean; // Видимость entity
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
  shape?: boolean;
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
  directionVector?: DxfVertex; // MTEXT: вектор направления текста (code 11)
  halign?: number;
  valign?: number;
  attachmentPoint?: number; // MTEXT: 1-9 (TopLeft..BottomRight)
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
  // Точка на дуге для angular dimension
  arcPoint?: DxfVertex;
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

export interface DxfEllipseEntity extends DxfEntityBase {
  type: "ELLIPSE";
  center: DxfVertex;
  majorAxisEndPoint: DxfVertex; // Конец большой полуоси ОТНОСИТЕЛЬНО центра
  axisRatio: number; // Отношение малой оси к большой (0 < ratio <= 1)
  startAngle: number; // В радианах
  endAngle: number; // В радианах
}

export interface DxfPointEntity extends DxfEntityBase {
  type: "POINT";
  position: DxfVertex;
  thickness?: number;
  extrusionDirection?: DxfVertex;
}

export interface Dxf3DFaceEntity extends DxfEntityBase {
  type: "3DFACE";
  vertices: DxfVertex[];
  shape?: boolean;
  hasContinuousLinetypePattern?: boolean;
}

// HATCH boundary edge типы
export interface HatchLineEdge {
  type: "line";
  start: DxfVertex;
  end: DxfVertex;
}

export interface HatchArcEdge {
  type: "arc";
  center: DxfVertex;
  radius: number;
  startAngle: number; // в градусах (из DXF)
  endAngle: number;   // в градусах (из DXF)
  ccw: boolean;
}

export type HatchEdge = HatchLineEdge | HatchArcEdge;

export interface HatchBoundaryPath {
  // Edge-based boundary
  edges?: HatchEdge[];
  // Polyline-based boundary
  polylineVertices?: DxfVertex[];
}

export interface HatchPatternLine {
  angle: number;        // градусы — code 53
  basePoint: DxfVertex; // начало первой линии — codes 43/44
  offset: DxfVertex;    // вектор смещения к следующей параллельной линии — codes 45/46
  dashes: number[];     // длины дэшей — code 49 (+ = линия, - = пробел)
}

export interface DxfHatchEntity extends DxfEntityBase {
  type: "HATCH";
  patternName: string;
  solid: boolean; // code 70 = 1 → solid fill
  boundaryPaths: HatchBoundaryPath[];
  patternLines?: HatchPatternLine[];
}

export interface DxfLeaderEntity extends DxfEntityBase {
  type: "LEADER";
  vertices: DxfVertex[];
  styleName?: string;
  arrowHeadFlag?: number; // 0 = без стрелки, 1 = со стрелкой
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
  | DxfEllipseEntity
  | DxfPointEntity
  | Dxf3DFaceEntity
  | DxfHatchEntity
  | DxfLeaderEntity
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

export function isEllipseEntity(entity: DxfEntity): entity is DxfEllipseEntity {
  return entity.type === "ELLIPSE";
}

export function isPointEntity(entity: DxfEntity): entity is DxfPointEntity {
  return entity.type === "POINT";
}

export function is3DFaceEntity(entity: DxfEntity): entity is Dxf3DFaceEntity {
  return entity.type === "3DFACE";
}

export function isHatchEntity(entity: DxfEntity): entity is DxfHatchEntity {
  return entity.type === "HATCH";
}

export function isLeaderEntity(entity: DxfEntity): entity is DxfLeaderEntity {
  return entity.type === "LEADER";
}

// Слой DXF файла
export interface DxfLayer {
  name: string;
  visible: boolean;
  colorIndex: number;
  color: number; // RGB как число
  frozen: boolean;
}

// Типизированные таблицы DXF
export interface DxfTables {
  layer?: {
    handle?: string;
    ownerHandle?: string;
    layers: Record<string, DxfLayer>;
  };
  [key: string]: unknown;
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
  tables?: DxfTables;
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
