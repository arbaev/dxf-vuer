export interface DxfVertex {
  x: number;
  y: number;
  z?: number;
  bulge?: number; // Bulge factor for arcs in POLYLINE (0 = straight, +-1 = semicircle)
}

export interface DxfEntityBase {
  handle?: string | number;
  ownerHandle?: string | number;
  layer?: string;
  colorIndex?: number; // ACI index: 0=ByBlock, 1-255=color, 256=ByLayer
  color?: number; // RGB truecolor (DXF code 420)
  lineweight?: number; // -3=Standard, -2=ByLayer, -1=ByBlock, or value in 0.01mm
  lineType?: string;
  lineTypeScale?: number;
  visible?: boolean;
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
  directionVector?: DxfVertex; // MTEXT: text direction vector (code 11)
  halign?: number;
  valign?: number;
  attachmentPoint?: number; // MTEXT: 1-9 (TopLeft..BottomRight)
}

export interface DxfDimensionEntity extends DxfEntityBase {
  type: "DIMENSION";
  block?: string; // code 2
  styleName?: string; // code 3
  text?: string; // code 1
  actualMeasurement?: number; // code 42
  dimensionType?: number; // code 70
  attachmentPoint?: number; // code 71
  textHeight?: number; // code 140
  angle?: number; // code 50
  anchorPoint?: DxfVertex; // code 10
  middleOfText?: DxfVertex; // code 11
  insertionPoint?: DxfVertex; // code 12
  linearOrAngularPoint1?: DxfVertex; // code 13
  linearOrAngularPoint2?: DxfVertex; // code 14
  diameterOrRadiusPoint?: DxfVertex; // code 15
  arcPoint?: DxfVertex; // code 16
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
  majorAxisEndPoint: DxfVertex; // Major semi-axis endpoint RELATIVE to center
  axisRatio: number; // Minor-to-major axis ratio (0 < ratio <= 1)
  startAngle: number; // In radians
  endAngle: number; // In radians
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

export interface HatchLineEdge {
  type: "line";
  start: DxfVertex;
  end: DxfVertex;
}

export interface HatchArcEdge {
  type: "arc";
  center: DxfVertex;
  radius: number;
  startAngle: number; // in degrees (from DXF)
  endAngle: number;   // in degrees (from DXF)
  ccw: boolean;
}

export interface HatchEllipseEdge {
  type: "ellipse";
  center: DxfVertex;
  majorAxisEndPoint: DxfVertex; // relative to center
  axisRatio: number; // minor-to-major axis ratio
  startAngle: number; // in radians (from DXF)
  endAngle: number;   // in radians (from DXF)
  ccw: boolean;
}

export interface HatchSplineEdge {
  type: "spline";
  degree: number;
  knots: number[];
  controlPoints: DxfVertex[];
  weights?: number[];
  fitPoints?: DxfVertex[];
}

export type HatchEdge = HatchLineEdge | HatchArcEdge | HatchEllipseEdge | HatchSplineEdge;

export interface HatchBoundaryPath {
  edges?: HatchEdge[];
  polylineVertices?: DxfVertex[];
}

export interface HatchPatternLine {
  angle: number;        // degrees -- code 53
  basePoint: DxfVertex; // first line origin -- codes 43/44
  offset: DxfVertex;    // offset vector to next parallel line -- codes 45/46
  dashes: number[];     // dash lengths -- code 49 (+ = line, - = gap)
}

export interface DxfHatchEntity extends DxfEntityBase {
  type: "HATCH";
  patternName: string;
  solid: boolean; // code 70 = 1 -> solid fill
  boundaryPaths: HatchBoundaryPath[];
  patternLines?: HatchPatternLine[];
}

export interface DxfLeaderEntity extends DxfEntityBase {
  type: "LEADER";
  vertices: DxfVertex[];
  styleName?: string;
  arrowHeadFlag?: number; // 0 = no arrow, 1 = with arrow
}

export interface MLeaderLine {
  vertices: DxfVertex[];
}

export interface MLeaderBranch {
  lines: MLeaderLine[];
  lastLeaderPoint?: DxfVertex; // Landing point -- leader end closest to text
  doglegVector?: DxfVertex;    // Direction of the horizontal shelf
  doglegLength?: number;
}

export interface DxfMLeaderEntity extends DxfEntityBase {
  type: "MULTILEADER";
  leaders: MLeaderBranch[];
  text?: string;
  textPosition?: DxfVertex;
  textHeight?: number;
  arrowSize?: number;
  hasArrowHead?: boolean; // Defaults to true for MLEADER
}

export interface DxfAttdefEntity extends DxfEntityBase {
  type: "ATTDEF";
  text?: string;
  tag?: string;
  prompt?: string;
  textStyle?: string;
  startPoint?: DxfVertex;
  endPoint?: DxfVertex;
  thickness?: number;
  textHeight?: number;
  rotation?: number;
  scale?: number;
  obliqueAngle?: number;
  invisible?: boolean;
  constant?: boolean;
  verificationRequired?: boolean;
  preset?: boolean;
  backwards?: boolean;
  mirrored?: boolean;
  horizontalJustification?: number;
  fieldLength?: number;
  verticalJustification?: number;
  extrusionDirection?: DxfVertex;
}

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
  | DxfMLeaderEntity
  | DxfAttdefEntity
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

export function isMLeaderEntity(entity: DxfEntity): entity is DxfMLeaderEntity {
  return entity.type === "MULTILEADER";
}

export function isAttdefEntity(entity: DxfEntity): entity is DxfAttdefEntity {
  return entity.type === "ATTDEF";
}

export interface DxfLayer {
  name: string;
  visible: boolean;
  colorIndex: number;
  color: number; // RGB as number
  frozen: boolean;
  lineType?: string;
}

export interface DxfLineType {
  name: string;
  description: string;
  pattern: number[];
  patternLength: number;
}

export interface DxfTables {
  layer?: {
    handle?: string;
    ownerHandle?: string;
    layers: Record<string, DxfLayer>;
  };
  lineType?: {
    handle?: string;
    ownerHandle?: string;
    lineTypes: Record<string, DxfLineType>;
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
  fileSize: number; // in bytes
  totalEntities: number;
  entitiesByType: Record<string, number>;
  layersCount: number;
  blocksCount: number;
  autocadVersion?: string;
}
