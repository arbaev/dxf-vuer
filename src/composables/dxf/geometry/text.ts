import * as THREE from "three";
import { TEXT_HEIGHT, MAX_TEXT_FONT_SIZE } from "@/constants";
import ACI_PALETTE from "@/parser/acadColorIndex";
import { rgbNumberToHex } from "@/utils/colorResolver";

/** Строка MTEXT с опциональным переопределением цвета, высоты и стиля */
export interface MTextLine {
  text: string;
  color?: string;
  height?: number;
  bold?: boolean;
  italic?: boolean;
  fontFamily?: string;
  stackedTop?: string; // \Sверх^низ; → superscript
  stackedBottom?: string; // \Sверх^низ; → subscript
}

/**
 * Замена DXF спецсимволов:
 * %%d → °, %%p → ±, %%c → Ø, %%nnn → символ по коду, %%u/%%o → убираем
 */
export const replaceSpecialChars = (text: string): string =>
  text
    .replace(/%%[dD]/g, "°")
    .replace(/%%[pP]/g, "±")
    .replace(/%%[cC]/g, "Ø")
    .replace(/%%[uUoO]/g, "") // toggle underline/overline — убираем
    .replace(/%%(\d{3})/g, (_, code) => String.fromCharCode(parseInt(code)));

/**
 * Парсинг MTEXT форматирования в массив строк с цветом и высотой.
 * Обрабатывает: \P (перенос), \C<n>; (цвет ACI), \H<n>; (высота),
 * \f...; (шрифт), %%d/%%p/%%c (спецсимволы), {}, \L/\O/\K и др.
 */
export const parseMTextContent = (rawText: string): MTextLine[] => {
  // 1. Защищаем литеральные escape-последовательности placeholder'ами,
  //    чтобы они не были съедены парсером форматирования (\\ → \, \{ → {, \} → })
  let text = rawText.replace(/\\\\/g, "\x01").replace(/\\\{/g, "\x02").replace(/\\\}/g, "\x03");

  // 2. Unicode символы по коду: \U+XXXX → символ
  text = text.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) =>
    String.fromCodePoint(parseInt(hex, 16)),
  );

  // 3. Спецсимволы %%d, %%p, %%c, %%nnn
  text = replaceSpecialChars(text);

  // 4. Разбиваем по \P (перенос строки в MTEXT)
  const rawLines = text.split(/\\P/);

  const lines: MTextLine[] = [];
  let currentColor: string | undefined;
  let currentHeight: number | undefined;
  let currentBold = false;
  let currentItalic = false;
  let currentFont: string | undefined;

  for (const rawLine of rawLines) {
    let clean = rawLine;

    // Сохраняем стиль на начало строки (carry-over от предыдущей строки)
    let lineFont = currentFont;
    let lineBold = currentBold;
    let lineItalic = currentItalic;
    let firstFontInLine = true;

    // Шрифт: \fFontName|b1|i0|c0|p0; — извлекаем имя шрифта, bold, italic
    // Первый \f в строке определяет стиль видимого текста этой строки,
    // последний \f обновляет carry-over состояние для следующих строк
    clean = clean.replace(/\\f([^|;]*)\|?[^;]*;/g, (fullMatch, fontName) => {
      if (fontName) currentFont = fontName;
      const boldMatch = fullMatch.match(/\|b(\d)/);
      const italicMatch = fullMatch.match(/\|i(\d)/);
      if (boldMatch) currentBold = boldMatch[1] === "1";
      if (italicMatch) currentItalic = italicMatch[1] === "1";
      // Первый \f определяет стиль для текста этой строки
      if (firstFontInLine) {
        lineFont = currentFont;
        lineBold = currentBold;
        lineItalic = currentItalic;
        firstFontInLine = false;
      }
      return "";
    });

    // Цвет ACI: \C<index>; или \c<index>;
    clean = clean.replace(/\\[cC](\d+);/g, (_, indexStr) => {
      const idx = parseInt(indexStr);
      if (idx === 0 || idx === 256) {
        currentColor = undefined; // ByBlock/ByLayer — используем цвет entity
      } else if (idx >= 1 && idx <= 255) {
        currentColor = rgbNumberToHex(ACI_PALETTE[idx]);
      }
      return "";
    });

    // Высота: \H<value>;
    clean = clean.replace(/\\H([\d.]+);/gi, (_, val) => {
      currentHeight = parseFloat(val);
      return "";
    });

    // Отступы абзаца: \pi<indent>,l<left>,r<right>,t<tabs>;
    clean = clean.replace(/\\p[^;]*;/g, "");
    // Ширина, трекинг, наклон, выравнивание: \W, \T, \Q, \A
    clean = clean.replace(/\\[WTQA][\d.+-]+;/gi, "");
    // Подчёркивание, надчёркивание, зачёркивание: \L/\l, \O/\o, \K/\k
    clean = clean.replace(/\\[LOKlok]/g, "");
    // Дроби: \Sверх^низ; или \Sверх/низ; → извлекаем в stacked поля
    let lineStackedTop: string | undefined;
    let lineStackedBottom: string | undefined;
    clean = clean.replace(/\\S([^^/;]*)[\^/]([^;]*);/g, (_, top, bottom) => {
      lineStackedTop = top.trim();
      lineStackedBottom = bottom.trim();
      return "";
    });
    // Неразрывный пробел
    clean = clean.replace(/\\~/g, " ");
    // Разрыв колонки \N → пробел
    clean = clean.replace(/\\N/g, " ");
    // Фигурные скобки группировки (литеральные уже защищены placeholder'ами)
    clean = clean.replace(/[{}]/g, "");
    // Оставшиеся неизвестные escape-последовательности \X...;
    clean = clean.replace(/\\[a-zA-Z][^;]*;/g, "");

    // Восстанавливаем литеральные символы из placeholder'ов
    clean = clean.replace(/\x01/g, "\\").replace(/\x02/g, "{").replace(/\x03/g, "}");

    if (clean.length > 0 || lineStackedTop || lineStackedBottom) {
      lines.push({
        text: clean,
        color: currentColor,
        height: currentHeight,
        bold: lineBold,
        italic: lineItalic,
        fontFamily: lineFont,
        stackedTop: lineStackedTop,
        stackedBottom: lineStackedBottom,
      });
    }
  }

  return lines;
};

/**
 * Определение горизонтального выравнивания из MTEXT attachmentPoint (code 71)
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
 * Определение горизонтального выравнивания из TEXT halign (code 72)
 * 0 = Left, 1 = Center, 2 = Right, 3 = Aligned, 4 = Middle, 5 = Fit
 */
export const getTextHAlign = (halign?: number): "left" | "center" | "right" => {
  if (halign === 1 || halign === 4) return "center";
  if (halign === 2) return "right";
  return "left";
};

/**
 * Определение вертикального выравнивания из MTEXT attachmentPoint (code 71)
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
 * Определение вертикального выравнивания из TEXT valign (code 73)
 * 0 = Baseline, 1 = Bottom, 2 = Middle, 3 = Top
 */
export const getTextVAlign = (valign?: number): "top" | "middle" | "bottom" => {
  if (valign === 3) return "top";
  if (valign === 2) return "middle";
  return "bottom"; // 0=Baseline ≈ bottom, 1=Bottom
};

/**
 * Создание текстового меша со stacked text (superscript/subscript).
 * Формат: mainText + верхний/нижний текст (из \Sверх^низ;)
 */
export const createStackedTextMesh = (
  mainText: string,
  stackedTop: string,
  stackedBottom: string,
  height: number,
  color: string,
  bold = false,
  italic = false,
  hAlign: "left" | "center" | "right" = "center",
  fontFamily = "Arial",
  vAlign: "top" | "middle" | "bottom" = "middle",
): THREE.Mesh => {
  const CANVAS_SCALE = 10;
  const PADDING = 4;
  const STACKED_RATIO = 0.6;
  const STACKED_GAP = 2;
  const STACKED_V_GAP = 4;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;

  const fontSize = Math.min(Math.max(height * CANVAS_SCALE, TEXT_HEIGHT), MAX_TEXT_FONT_SIZE);
  const fontStyle = `${italic ? "italic " : ""}${bold ? "bold " : ""}${fontSize}px '${fontFamily}', Arial, sans-serif`;
  const stackedFontSize = fontSize * STACKED_RATIO;
  const stackedFontStyle = `${italic ? "italic " : ""}${bold ? "bold " : ""}${stackedFontSize}px '${fontFamily}', Arial, sans-serif`;

  // Измеряем основной текст
  context.font = fontStyle;
  const mainMetrics = mainText ? context.measureText(mainText) : null;
  const mainWidth = mainMetrics ? mainMetrics.width : 0;
  const mainAscent = mainMetrics?.actualBoundingBoxAscent ?? fontSize * 0.8;
  const mainDescent = mainMetrics?.actualBoundingBoxDescent ?? fontSize * 0.05;

  // Измеряем stacked текст
  context.font = stackedFontStyle;
  const topWidth = stackedTop ? context.measureText(stackedTop).width : 0;
  const bottomWidth = stackedBottom ? context.measureText(stackedBottom).width : 0;
  const stackedMaxWidth = Math.max(topWidth, bottomWidth);
  const topMetrics = stackedTop ? context.measureText(stackedTop) : null;
  const topAscent = topMetrics?.actualBoundingBoxAscent ?? stackedFontSize * 0.8;
  const topDescent = topMetrics?.actualBoundingBoxDescent ?? stackedFontSize * 0.05;
  const subMetrics = stackedBottom ? context.measureText(stackedBottom) : null;
  const subAscent = subMetrics?.actualBoundingBoxAscent ?? stackedFontSize * 0.8;
  const subDescent = subMetrics?.actualBoundingBoxDescent ?? stackedFontSize * 0.05;

  // Stacked текст центрируется по визуальному центру основного текста
  const mainCenterAboveBaseline = mainAscent / 2;
  const halfVGap = STACKED_V_GAP / 2;

  const topExtent = Math.max(
    mainAscent,
    mainCenterAboveBaseline + halfVGap + topAscent + topDescent,
  );
  const bottomExtent = Math.max(
    mainDescent,
    subAscent + subDescent + halfVGap - mainCenterAboveBaseline,
  );

  const gap = mainText ? STACKED_GAP : 0;
  const totalWidth = mainWidth + gap + stackedMaxWidth;
  const canvasWidth = Math.ceil(totalWidth) + PADDING * 2;
  const canvasHeight = Math.ceil(topExtent + bottomExtent) + PADDING * 2;

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  context.fillStyle = color;

  const baselineY = PADDING + Math.ceil(topExtent);
  const stackedCenterY = baselineY - mainCenterAboveBaseline;

  // Основной текст
  if (mainText) {
    context.font = fontStyle;
    context.textBaseline = "alphabetic";
    context.fillText(mainText, PADDING, baselineY);
  }

  // Superscript / subscript
  const stackedX = PADDING + mainWidth + gap;
  context.font = stackedFontStyle;
  if (stackedTop) {
    context.textBaseline = "alphabetic";
    context.fillText(stackedTop, stackedX, stackedCenterY - halfVGap - topDescent);
  }
  if (stackedBottom) {
    context.textBaseline = "alphabetic";
    context.fillText(stackedBottom, stackedX, stackedCenterY + halfVGap + subAscent);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });

  const aspectRatio = canvasWidth / canvasHeight;
  const meshHeight = height * (canvasHeight / (Math.ceil(fontSize * 1.2) + PADDING * 2));
  const meshWidth = meshHeight * aspectRatio;
  const geometry = new THREE.PlaneGeometry(meshWidth, meshHeight);

  const tx = hAlign === "left" ? meshWidth / 2 : hAlign === "right" ? -meshWidth / 2 : 0;
  const ty = vAlign === "top" ? -meshHeight / 2 : vAlign === "bottom" ? meshHeight / 2 : 0;
  if (tx !== 0 || ty !== 0) {
    geometry.translate(tx, ty, 0);
  }

  return new THREE.Mesh(geometry, material);
};

/**
 * Создание текстового меша с использованием Canvas текстуры
 * @param color - Цвет текста (hex строка)
 * @param bold - Жирный шрифт
 * @param italic - Курсив
 * @param hAlign - Горизонтальное выравнивание: 'left' | 'center' | 'right'
 * @param fontFamily - Имя шрифта (по умолчанию Arial)
 * @param vAlign - Вертикальное выравнивание: 'top' | 'middle' | 'bottom'
 */
export const createTextMesh = (
  text: string,
  height: number,
  color: string,
  bold = false,
  italic = false,
  hAlign: "left" | "center" | "right" = "center",
  fontFamily = "Arial",
  vAlign: "top" | "middle" | "bottom" = "middle",
): THREE.Mesh => {
  const CANVAS_SCALE = 10;
  const TEXT_CANVAS_PADDING = 4;
  const TEXT_HEIGHT_MULTIPLIER = 1.2;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;

  const fontSize = Math.min(Math.max(height * CANVAS_SCALE, TEXT_HEIGHT), MAX_TEXT_FONT_SIZE);
  const fontStyle = `${italic ? "italic " : ""}${bold ? "bold " : ""}${fontSize}px '${fontFamily}', Arial, sans-serif`;
  context.font = fontStyle;
  const textMetrics = context.measureText(text);

  const canvasWidth = Math.ceil(textMetrics.width) + TEXT_CANVAS_PADDING * 2;
  const canvasHeight = Math.ceil(fontSize * TEXT_HEIGHT_MULTIPLIER) + TEXT_CANVAS_PADDING * 2;

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  context.font = fontStyle;
  context.fillStyle = color;
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(text, TEXT_CANVAS_PADDING, canvasHeight / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
  });

  const aspectRatio = canvasWidth / canvasHeight;
  const meshWidth = height * aspectRatio;
  const geometry = new THREE.PlaneGeometry(meshWidth, height);

  // Сдвигаем геометрию для выравнивания: origin = точка привязки текста
  const tx = hAlign === "left" ? meshWidth / 2 : hAlign === "right" ? -meshWidth / 2 : 0;
  const ty = vAlign === "top" ? -height / 2 : vAlign === "bottom" ? height / 2 : 0;
  if (tx !== 0 || ty !== 0) {
    geometry.translate(tx, ty, 0);
  }

  const mesh = new THREE.Mesh(geometry, material);

  mesh.userData = {
    type: "TEXT",
    text: text,
    height: height,
    originalWidth: canvasWidth,
    originalHeight: canvasHeight,
  };

  return mesh;
};
