import opentype from "opentype.js";
import defaultFontBuffer from "@/assets/fonts/NotoSans-Light.ttf?arraybuffer";

let defaultFont: opentype.Font | null = null;
let serifFont: opentype.Font | null = null;
let serifPromise: Promise<opentype.Font> | null = null;
const fontCache = new Map<string, opentype.Font>();

/**
 * Parse and return the built-in Noto Sans Light font.
 * Synchronous — the font data is inlined in the bundle.
 */
export function loadDefaultFont(): opentype.Font {
  if (!defaultFont) {
    defaultFont = opentype.parse(defaultFontBuffer);
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
 * Lazy-load and parse the built-in Noto Serif Light font.
 * The font data is in a separate chunk (dynamic import), loaded only when needed.
 * Cached after first load — concurrent calls share the same promise.
 */
export async function loadSerifFont(): Promise<opentype.Font> {
  if (serifFont) return serifFont;
  if (serifPromise) return serifPromise;

  serifPromise = (async () => {
    const { default: buf } = await import("@/assets/fonts/NotoSerif-Light.ttf?arraybuffer");
    serifFont = opentype.parse(buf);
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
