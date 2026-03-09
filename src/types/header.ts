import type { DxfVertex } from "./dxf";

/**
 * Typed DXF header interface for known `$`-prefixed header variables.
 *
 * The parser stores header variables as `$NAME → value` pairs, where values
 * are either scalars (string / number) or 2D/3D points ({@link DxfVertex}).
 *
 * All properties are optional because any given DXF file may omit them.
 * The index signature allows access to unknown/uncommon variables while
 * keeping strong types for the ones actually consumed by the library.
 */
export interface DxfHeader {
  // ── Drawing extents ────────────────────────────────────────────────
  /** Model-space minimum extent (code 10/20/30). */
  $EXTMIN?: DxfVertex;
  /** Model-space maximum extent (code 10/20/30). */
  $EXTMAX?: DxfVertex;

  // ── Drawing limits ─────────────────────────────────────────────────
  /** Lower-left corner of drawing limits (code 10/20). */
  $LIMMIN?: DxfVertex;
  /** Upper-right corner of drawing limits (code 10/20). */
  $LIMMAX?: DxfVertex;

  // ── Insertion base point ───────────────────────────────────────────
  /** Base insertion point for the drawing (code 10/20/30). */
  $INSBASE?: DxfVertex;

  // ── Linetype scale ─────────────────────────────────────────────────
  /** Global linetype scale factor (default 1). */
  $LTSCALE?: number;

  // ── Dimension variables ────────────────────────────────────────────
  /** Overall dimension scale factor (default 1). */
  $DIMSCALE?: number;
  /** Dimension arrow size. */
  $DIMASZ?: number;
  /** Dimension text height. */
  $DIMTXT?: number;
  /** Dimension line gap (distance from dimension line to text). */
  $DIMGAP?: number;
  /** Extension line extension past dimension line. */
  $DIMEXE?: number;
  /** Dimension tick size (>0 replaces arrows with architectural ticks). */
  $DIMTSZ?: number;
  /** Dimension arrow block name. */
  $DIMBLK?: string;
  /** Dimension linear unit format (2 = Decimal, 4 = Architectural, ...). */
  $DIMLUNIT?: number;

  // ── Point display ──────────────────────────────────────────────────
  /** Point display mode (0 = dot, 1 = none, 2 = plus, 3 = cross, ...). */
  $PDMODE?: number;
  /** Point display size. 0 = 5% of viewport, >0 = absolute, <0 = % of viewport. */
  $PDSIZE?: number;

  // ── Text ───────────────────────────────────────────────────────────
  /** Default text height. */
  $TEXTSIZE?: number;
  /** Mirror text flag: 0 = not mirrored, 1 = mirrored. */
  $MIRRTEXT?: number;

  // ── Units ──────────────────────────────────────────────────────────
  /** Drawing insertion units (0 = Unitless, 1 = Inches, 4 = mm, 6 = Meters, ...). */
  $INSUNITS?: number;
  /** Measurement system: 0 = English (imperial), 1 = Metric. */
  $MEASUREMENT?: number;

  // ── Version ────────────────────────────────────────────────────────
  /** AutoCAD version string (e.g. "AC1027" for AutoCAD 2013). */
  $ACADVER?: string;

  // ── Catch-all for unknown/uncommon header variables ────────────────
  [key: `$${string}`]: unknown;
}
