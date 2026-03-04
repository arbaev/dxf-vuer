import ACI_PALETTE from "@/parser/acadColorIndex";
import { rgbNumberToHex } from "@/utils/colorResolver";

/** MTEXT line with optional color, height, and style overrides */
export interface MTextLine {
  text: string;
  color?: string;
  height?: number;
  bold?: boolean;
  italic?: boolean;
  fontFamily?: string;
  stackedTop?: string; // \Stop^bottom; -> superscript
  stackedBottom?: string; // \Stop^bottom; -> subscript
  leftMargin?: number; // \p...l<value>... left margin (drawing units)
  firstIndent?: number; // \p...i<value>... first-line indent (drawing units)
}

/**
 * Replace DXF special characters:
 * %%d -> deg, %%p -> +/-, %%c -> diameter, %%nnn -> char by code, %%u/%%o -> remove
 */
export const replaceSpecialChars = (text: string): string =>
  text
    .replace(/%%[dD]/g, "\u00B0")
    .replace(/%%[pP]/g, "\u00B1")
    .replace(/%%[cC]/g, "\u2300")
    .replace(/%%[uUoO]/g, "") // toggle underline/overline — remove
    .replace(/%%(\d{3})/g, (_, code) => String.fromCharCode(parseInt(code)));

/**
 * Parse MTEXT formatting into an array of lines with color and height.
 * Handles: \P (line break), \C<n>; (ACI color), \H<n>; (height),
 * \f...; (font), %%d/%%p/%%c (special chars), {}, \L/\O/\K, etc.
 */
export const parseMTextContent = (rawText: string, defaultHeight?: number): MTextLine[] => {
  // Protect literal escape sequences with placeholders
  // so they are not consumed by the formatting parser (\\ -> \, \{ -> {, \} -> })
  let text = rawText.replace(/\\\\/g, "\x01").replace(/\\\{/g, "\x02").replace(/\\\}/g, "\x03");

  // Unicode characters by code: \U+XXXX -> character
  text = text.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) =>
    String.fromCodePoint(parseInt(hex, 16)),
  );

  text = replaceSpecialChars(text);

  // Split by \P (MTEXT line break)
  const rawLines = text.split(/\\P/);

  const lines: MTextLine[] = [];
  let currentColor: string | undefined;
  let currentHeight: number | undefined;
  let currentBold = false;
  let currentItalic = false;
  let currentFont: string | undefined;

  for (const rawLine of rawLines) {
    let clean = rawLine;

    let lineFont = currentFont;
    let lineBold = currentBold;
    let lineItalic = currentItalic;
    let firstFontInLine = true;

    // Brace scoping: strip formatting codes (\H, \f, \C) inside balanced
    // brace groups {…} so they don't modify persistent state.
    // Keeps text content and \S fractions intact.
    clean = clean.replace(/\{([^{}]*)\}/g, (_, inner: string) =>
      inner
        .replace(/\\H[\d.]+x?;/gi, "")
        .replace(/\\f[^|;]*\|?[^;]*;/g, "")
        .replace(/\\[cC]\d+;/g, ""),
    );

    // Font: \fFontName|b1|i0|c0|p0; — extract font name, bold, italic
    // First \f in line determines the visible text style for this line,
    // last \f updates carry-over state for subsequent lines
    clean = clean.replace(/\\f([^|;]*)\|?[^;]*;/g, (fullMatch, fontName) => {
      if (fontName) currentFont = fontName;
      const boldMatch = fullMatch.match(/\|b(\d)/);
      const italicMatch = fullMatch.match(/\|i(\d)/);
      if (boldMatch) currentBold = boldMatch[1] === "1";
      if (italicMatch) currentItalic = italicMatch[1] === "1";
      if (firstFontInLine) {
        lineFont = currentFont;
        lineBold = currentBold;
        lineItalic = currentItalic;
        firstFontInLine = false;
      }
      return "";
    });

    // ACI color: \C<index>; or \c<index>;
    clean = clean.replace(/\\[cC](\d+);/g, (_, indexStr) => {
      const idx = parseInt(indexStr);
      if (idx === 0 || idx === 256) {
        currentColor = undefined; // ByBlock/ByLayer — use entity color
      } else if (idx >= 1 && idx <= 255) {
        currentColor = rgbNumberToHex(ACI_PALETTE[idx]);
      }
      return "";
    });

    // Height: \H<value>; (absolute) or \H<value>x; (relative multiplier)
    clean = clean.replace(/\\H([\d.]+)(x?);/gi, (_, val, suffix) => {
      const v = parseFloat(val);
      if (suffix === "x" || suffix === "X") {
        currentHeight = (currentHeight ?? defaultHeight ?? 1) * v;
      } else {
        currentHeight = v;
      }
      return "";
    });

    // Paragraph formatting: \p[i<indent>][,l<left>][,r<right>][,t<tabs>]; or \pxq[lcr];
    let lineLeftMargin: number | undefined;
    let lineFirstIndent: number | undefined;
    clean = clean.replace(/\\p([^;]*);/g, (_, params: string) => {
      const iMatch = params.match(/i([+-]?[\d.]+)/);
      if (iMatch) lineFirstIndent = parseFloat(iMatch[1]);
      const lMatch = params.match(/l([\d.]+)/);
      if (lMatch) lineLeftMargin = parseFloat(lMatch[1]);
      return "";
    });
    // Width, tracking, oblique, alignment: \W, \T, \Q, \A
    clean = clean.replace(/\\[WTQA][\d.+-]+;/gi, "");
    // Underline, overline, strikethrough: \L/\l, \O/\o, \K/\k
    clean = clean.replace(/\\[LOKlok]/g, "");
    // Fractions: \Stop^bottom; or \Stop/bottom; -> stacked fields
    // \Stop#bottom; -> inline flat text "top/bottom" (horizontal bar fraction)
    let lineStackedTop: string | undefined;
    let lineStackedBottom: string | undefined;
    clean = clean.replace(/\\S([^^/#;]*)([\^/#])([^;]*);/g, (_, top, sep, bottom) => {
      if (sep === "#") {
        return `${top.trim()}/${bottom.trim()}`; // inline fraction
      }
      lineStackedTop = top.trim();
      lineStackedBottom = bottom.trim();
      return "";
    });
    // Non-breaking space
    clean = clean.replace(/\\~/g, " ");
    // Column break \N -> space
    clean = clean.replace(/\\N/g, " ");
    // Grouping braces (literal ones are already protected by placeholders)
    clean = clean.replace(/[{}]/g, "");
    // Remaining unknown escape sequences \X...;
    clean = clean.replace(/\\[a-zA-Z][^;]*;/g, "");

    // Restore literal characters from placeholders
    clean = clean.replace(/\x01/g, "\\").replace(/\x02/g, "{").replace(/\x03/g, "}");

    // Always push lines — empty lines (\P\P) serve as paragraph spacing
    lines.push({
      text: clean,
      color: currentColor,
      height: currentHeight,
      bold: lineBold,
      italic: lineItalic,
      fontFamily: lineFont,
      stackedTop: lineStackedTop,
      stackedBottom: lineStackedBottom,
      leftMargin: lineLeftMargin,
      firstIndent: lineFirstIndent,
    });
  }

  return lines;
};

/**
 * Determine horizontal alignment from MTEXT attachmentPoint (code 71)
 * 1,4,7 = Left; 2,5,8 = Center; 3,6,9 = Right
 */
export const getMTextHAlign = (attachmentPoint?: number): "left" | "center" | "right" => {
  if (!attachmentPoint) return "left";
  const col = (attachmentPoint - 1) % 3; // 0=left, 1=center, 2=right
  if (col === 1) return "center";
  if (col === 2) return "right";
  return "left";
};

/**
 * Determine horizontal alignment from TEXT halign (code 72)
 * 0 = Left, 1 = Center, 2 = Right, 3 = Aligned, 4 = Middle, 5 = Fit
 */
export const getTextHAlign = (halign?: number): "left" | "center" | "right" => {
  if (halign === 1 || halign === 4) return "center";
  if (halign === 2) return "right";
  return "left";
};

/**
 * Determine vertical alignment from MTEXT attachmentPoint (code 71)
 * 1-3 = Top; 4-6 = Middle; 7-9 = Bottom
 */
export const getMTextVAlign = (attachmentPoint?: number): "top" | "middle" | "bottom" => {
  if (!attachmentPoint) return "top";
  const row = Math.ceil(attachmentPoint / 3); // 1=top, 2=middle, 3=bottom
  if (row === 2) return "middle";
  if (row === 3) return "bottom";
  return "top";
};

/**
 * Determine vertical alignment from TEXT valign (code 73)
 * 0 = Baseline, 1 = Bottom, 2 = Middle, 3 = Top
 */
export const getTextVAlign = (valign?: number): "top" | "middle" | "bottom" => {
  if (valign === 3) return "top";
  if (valign === 2) return "middle";
  return "bottom"; // 0=Baseline ~ bottom, 1=Bottom
};
