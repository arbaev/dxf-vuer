import opentype from "opentype.js";
import defaultFontBuffer from "@/assets/fonts/LiberationSans-Regular.ttf?arraybuffer";

let defaultFont: opentype.Font | null = null;
let serifFont: opentype.Font | null = null;
let serifPromise: Promise<opentype.Font> | null = null;
const fontCache = new Map<string, opentype.Font>();

/**
 * Parse and return the built-in Liberation Sans font (Arial-metrically-compatible).
 * Synchronous — the font data is inlined in the bundle.
 *
 * sCapHeight is overridden to match Arial (1467) because:
 * - Liberation Sans advance widths match Arial at the em level (point-size compatible)
 * - But its sCapHeight (1409) differs from Arial's (1467), giving a 4% larger emScale
 * - DXF text height = cap height, so the wrong sCapHeight causes all text to be 4% wider
 * - This pushes tab-aligned table columns past tab stop boundaries (staircase effect)
 * - With Arial's sCapHeight, tab positions match AutoCAD exactly
 */
export function loadDefaultFont(): opentype.Font {
  if (!defaultFont) {
    defaultFont = opentype.parse(defaultFontBuffer);
    // Override sCapHeight to match Arial for correct DXF text scaling
    const os2 = (defaultFont as { tables?: { os2?: { sCapHeight?: number } } }).tables?.os2;
    if (os2) os2.sCapHeight = 1467;
  }
  return defaultFont;
}

/**
 * Fetch and parse a custom font from a URL.
 * Results are cached by URL — subsequent calls return the cached font.
 */
export async function loadFont(url: string): Promise<opentype.Font> {
  const cached = fontCache.get(url);
  if (cached) return cached;

  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const font = opentype.parse(buffer);
  fontCache.set(url, font);
  return font;
}

/**
 * Lazy-load and parse the built-in Liberation Serif font (Times New Roman-metrically-compatible).
 * The font data is in a separate chunk (dynamic import), loaded only when needed.
 * Cached after first load — concurrent calls share the same promise.
 */
export async function loadSerifFont(): Promise<opentype.Font> {
  if (serifFont) return serifFont;
  if (serifPromise) return serifPromise;

  serifPromise = (async () => {
    const { default: buf } = await import("@/assets/fonts/LiberationSerif-Regular.ttf?arraybuffer");
    serifFont = opentype.parse(buf);
    // Override sCapHeight to match Times New Roman (1356) — same reason as sans-serif
    const os2 = (serifFont as { tables?: { os2?: { sCapHeight?: number } } }).tables?.os2;
    if (os2) os2.sCapHeight = 1356;
    return serifFont;
  })();

  return serifPromise;
}

/**
 * Get the currently loaded serif font (null if not loaded yet).
 */
export function getSerifFont(): opentype.Font | null {
  return serifFont;
}

/**
 * Get the currently loaded default font (null if not loaded yet).
 */
export function getDefaultFont(): opentype.Font | null {
  return defaultFont;
}
