// Точка входа парсера — без зависимостей от Vue и Three.js
// Использование: import { parseDxf } from 'dxf-vuer/parser'

export { parseDxf } from "./parser";
export { collectDXFStatistics } from "./utils/dxfStatistics";

// Все DXF-типы
export type {
  DxfVertex,
  DxfEntityBase,
  DxfLineEntity,
  DxfCircleEntity,
  DxfArcEntity,
  DxfPolylineEntity,
  DxfSplineEntity,
  DxfTextEntity,
  DxfDimensionEntity,
  DxfInsertEntity,
  DxfSolidEntity,
  DxfEllipseEntity,
  DxfPointEntity,
  Dxf3DFaceEntity,
  HatchLineEdge,
  HatchArcEdge,
  HatchEllipseEdge,
  HatchSplineEdge,
  HatchEdge,
  HatchBoundaryPath,
  HatchPatternLine,
  DxfHatchEntity,
  DxfLeaderEntity,
  MLeaderLine,
  MLeaderBranch,
  DxfMLeaderEntity,
  DxfAttdefEntity,
  DxfUnknownEntity,
  DxfEntity,
  DxfLayer,
  DxfTables,
  DxfBlock,
  DxfData,
  DxfStatistics,
} from "./types/dxf";

// Type-guard функции
export {
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
  isAttdefEntity,
} from "./types/dxf";
