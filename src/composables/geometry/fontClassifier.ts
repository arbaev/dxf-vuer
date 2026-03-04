import type { Font } from "opentype.js";
import type { DxfStyle } from "@/types/dxf";

/** Serif font name patterns (case-insensitive match) */
const SERIF_PATTERNS = [
  "times", "roman", "georgia", "garamond", "palatino",
  "cambria", "bodoni", "century", "bookman", "serif",
];

/** SHX serif font names (case-insensitive exact match without extension) */
const SHX_SERIF = [
  "romans", "romanc", "romand", "romant", "scripts", "scriptc",
];

/**
 * Classify a font name as "sans" or "serif".
 * Matches known serif patterns in TrueType font names and SHX font names.
 */
export function classifyFont(fontName?: string): "sans" | "serif" {
  if (!fontName) return "sans";
  const lower = fontName.toLowerCase().replace(/\.shx$|\.ttf$|\.otf$/i, "");

  // SHX exact match
  if (SHX_SERIF.includes(lower)) return "serif";

  // Substring match for TrueType font names
  for (const pattern of SERIF_PATTERNS) {
    if (lower.includes(pattern)) return "serif";
  }

  return "sans";
}

/**
 * Resolve which font to use for a text entity.
 *
 * Priority:
 * 1. MTEXT inline \f fontFamily → classify → pick font
 * 2. Entity textStyle → STYLE table → fontFile → classify → pick font
 * 3. Default → sansFont
 *
 * Fast path: if no serifFont loaded → always return sansFont.
 */
export function resolveEntityFont(
  textStyle: string | undefined,
  styles: Record<string, DxfStyle> | undefined,
  serifFont: Font | undefined,
  sansFont: Font,
  inlineFontFamily?: string,
): Font {
  // Fast path: no serif font loaded
  if (!serifFont) return sansFont;

  // 1. Inline font family from MTEXT \f formatting
  if (inlineFontFamily) {
    return classifyFont(inlineFontFamily) === "serif" ? serifFont : sansFont;
  }

  // 2. Entity textStyle → STYLE table lookup
  if (textStyle && styles) {
    const style = styles[textStyle];
    if (style?.fontFile) {
      return classifyFont(style.fontFile) === "serif" ? serifFont : sansFont;
    }
  }

  // 3. Default
  return sansFont;
}
