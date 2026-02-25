export const CAMERA_NEAR_PLANE = -2000;
export const CAMERA_FAR_PLANE = 2000;
export const CAMERA_INITIAL_Z_POSITION = 100;
// Multiplier for fitCameraToObject viewport padding
export const CAMERA_PADDING = 1.25;

export const SCENE_BG_COLOR = "#fafafa";

// ACI 7 maps to black on light background (AutoCAD behavior)
export const DEFAULT_ENTITY_COLOR = "#000000";

export const TEXT_HEIGHT = 16;
export const DIM_TEXT_HEIGHT = 5;
export const DIM_TEXT_GAP_MULTIPLIER = 1.5;
export const DIM_TEXT_GAP = DIM_TEXT_HEIGHT * DIM_TEXT_GAP_MULTIPLIER;
// Trailing zeros are removed after formatting
export const DIM_TEXT_DECIMAL_PLACES = 4;
// Limits memory consumption for text with large world coordinates
export const MAX_TEXT_FONT_SIZE = 256;

export const ARROW_SIZE = 3;
export const ARROW_BASE_WIDTH_DIVISOR = 4;
export const CIRCLE_SEGMENTS = 128;
export const EXTENSION_LINE_DASH_SIZE = 2;
export const EXTENSION_LINE_GAP_SIZE = 1;
// Threshold for near-zero checks (bulge, lengths, parallel lines)
export const EPSILON = 0.0001;
export const MIN_ARC_SEGMENTS = 8;
export const NURBS_SEGMENTS_MULTIPLIER = 4;
export const MIN_NURBS_SEGMENTS = 100;
export const CATMULL_ROM_SEGMENTS_MULTIPLIER = 2;
export const MIN_CATMULL_ROM_SEGMENTS = 50;
// sizeAttenuation: false -- constant screen-space size
export const POINT_MARKER_SIZE = 3;

export const MAX_HATCH_SEGMENTS = 50000;
export const MAX_HATCH_LINES_PER_PATTERN = 1000;

export const DEGREES_TO_RADIANS_DIVISOR = 180;
