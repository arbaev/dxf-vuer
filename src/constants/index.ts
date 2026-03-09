export const CAMERA_NEAR_PLANE = -2000;
export const CAMERA_FAR_PLANE = 2000;
export const CAMERA_INITIAL_Z_POSITION = 100;
// Multiplier for fitCameraToObject viewport padding
export const CAMERA_PADDING = 1.25;

export const SCENE_BG_COLOR = "#fafafa";
export const SCENE_BG_COLOR_DARK = "#1a1a1a";

// ACI 7 maps to black on light background (AutoCAD behavior)
export const DEFAULT_ENTITY_COLOR = "#000000";
export const DEFAULT_ENTITY_COLOR_DARK = "#ffffff";

export const TEXT_HEIGHT = 16;
export const DIM_TEXT_HEIGHT = 5;
export const DIM_TEXT_GAP_MULTIPLIER = 1.5;
export const DIM_TEXT_GAP = DIM_TEXT_HEIGHT * DIM_TEXT_GAP_MULTIPLIER;
// Trailing zeros are removed after formatting
export const DIM_TEXT_DECIMAL_PLACES = 4;
export const ARROW_SIZE = 3;
export const ARROW_BASE_WIDTH_DIVISOR = 4;
export const CIRCLE_SEGMENTS = 64;
export const EXTENSION_LINE_DASH_SIZE = 2;
export const EXTENSION_LINE_GAP_SIZE = 1;
export const EXTENSION_LINE_EXTENSION = 1.25; // DIMEXE default: extension past dim line
// Threshold for near-zero checks (bulge, lengths, parallel lines)
export const EPSILON = 0.0001;
export const MIN_ARC_SEGMENTS = 8;
export const NURBS_SEGMENTS_MULTIPLIER = 3;
export const MIN_NURBS_SEGMENTS = 50;
export const CATMULL_ROM_SEGMENTS_MULTIPLIER = 2;
export const MIN_CATMULL_ROM_SEGMENTS = 50;
// sizeAttenuation: false -- constant screen-space size
export const POINT_MARKER_SIZE = 3;
// Smaller dot size for linetype patterns (DOT, DASHDOT, etc.)
export const LINETYPE_DOT_SIZE = 1.5;

export const MAX_HATCH_SEGMENTS = 50000;
export const MAX_HATCH_LINES_PER_PATTERN = 1000;

export const DEGREES_TO_RADIANS_DIVISOR = 180;

// Number of line segments used to approximate circles in PDMODE point symbols
export const POINT_SYMBOL_SEGMENTS = 32;
// Default PDSIZE fallback when extents are unavailable (drawing units)
export const POINT_SYMBOL_DEFAULT_SIZE = 1;

// Reference divisor for auto-computing LTSCALE from drawing extents.
// Target: ~25 repetitions of DASHED pattern (cycle 19.05) across longest dimension.
export const AUTO_LTSCALE_DIVISOR = 500;
// Drawing extents below this threshold don't need auto-scaling
export const AUTO_LTSCALE_MIN_EXTENT = 100;
// Max pattern repetitions per entity before falling back to continuous line.
// Beyond ~2000 repetitions, dashes are sub-pixel and visually indistinguishable
// from solid lines. Without this cap, long curves with fine patterns can produce
// millions of dash vertices (e.g. a large circle with a short pattern cycle).
export const MAX_LINETYPE_REPETITIONS = 2000;
