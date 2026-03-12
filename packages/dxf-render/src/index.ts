// Parser
export { parseDxf } from "./parser";
export { parseDxfAsync, terminateParserWorker } from "./parseDxfAsync";
export { collectDXFStatistics } from "./utils/dxfStatistics";
export { getInsUnitsScale } from "./utils/insUnitsScale";

// Renderer
export { createThreeObjectsFromDXF, type CreateDXFSceneOptions } from "./render/createDXFScene";
export { MaterialCacheStore } from "./render/materialCache";
export { computePolylinePoints } from "./render/collectors";

// Scene helpers
export { useCamera } from "./scene/useCamera";
export { useOrbitControls } from "./scene/useOrbitControls";

// Fonts
export { loadDefaultFont, loadFont, getDefaultFont, loadSerifFont, getSerifFont } from "./render/text/fontManager";

// Utils
export { resolveEntityColor, rgbNumberToHex, ACI7_COLOR, resolveAci7Hex, isThemeAdaptiveColor, resolveThemeColor } from "./utils/colorResolver";
export { resolveEntityLinetype, scalePattern, applyLinetypePattern } from "./utils/linetypeResolver";
export { default as ACI_PALETTE } from "./parser/acadColorIndex";

// Constants
export * from "./constants";

// Types
export type {
  DxfVertex,
  DxfEntityBase,
  DxfLineEntity,
  DxfCircleEntity,
  DxfArcEntity,
  DxfPolylineEntity,
  DxfPolylineVertex,
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
  DxfAttribEntity,
  DxfMlineEntity,
  DxfXlineEntity,
  DxfUnknownEntity,
  DxfEntity,
  DxfLayer,
  DxfTables,
  DxfBlockRecord,
  DxfBlock,
  DxfData,
  DxfStatistics,
  DxfDimStyle,
  DxfLineType,
  DxfStyle,
} from "./types/dxf";

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
  isAttribEntity,
  isMlineEntity,
  isXlineEntity,
} from "./types/dxf";

export type { DxfHeader } from "./types/header";
