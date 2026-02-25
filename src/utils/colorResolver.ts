// Утилита определения цвета entity по логике AutoCAD
import type { DxfEntity, DxfLayer } from "@/types/dxf";
import { DEFAULT_ENTITY_COLOR } from "@/constants";
import ACI_PALETTE from "@/parser/acadColorIndex";

/** Конвертировать число RGB в hex строку "#RRGGBB" */
export function rgbNumberToHex(rgbNumber: number): string {
  return "#" + (rgbNumber & 0xFFFFFF).toString(16).padStart(6, "0");
}

/**
 * Определить цвет entity с учётом colorIndex, truecolor, слоя и блока.
 * Приоритет: trueColor (code 420) > colorIndex (code 62) > layerColor
 *
 * @param entity - Entity для определения цвета
 * @param layers - Словарь слоёв
 * @param blockColor - Цвет, унаследованный от INSERT (ByBlock), hex строка
 * @returns hex строка цвета, например "#FF0000"
 */
export function resolveEntityColor(
  entity: DxfEntity,
  layers: Record<string, DxfLayer>,
  blockColor?: string,
): string {
  const colorIndex = entity.colorIndex;
  const trueColor = entity.color;

  // 1. ByBlock (colorIndex === 0): наследуем цвет от INSERT
  if (colorIndex === 0) {
    return blockColor ?? DEFAULT_ENTITY_COLOR;
  }

  // 2. Конкретный цвет entity (colorIndex 1-255)
  if (colorIndex !== undefined && colorIndex >= 1 && colorIndex <= 255) {
    // trueColor (code 420) приоритетнее ACI
    if (trueColor !== undefined) {
      return rgbNumberToHex(trueColor);
    }
    // ACI 7 и 255 — белый цвет (0xFFFFFF), на светлом фоне показываем чёрным
    if (colorIndex === 7 || colorIndex === 255) {
      return "#000000";
    }
    return rgbNumberToHex(ACI_PALETTE[colorIndex]);
  }

  // 3. ByLayer (colorIndex === 256, не задан, или другое): берём цвет слоя
  const layerName = entity.layer;
  if (layerName && layers[layerName]) {
    const layer = layers[layerName];
    // layer.color — ACI-палитра (из getAcadColor), не trueColor
    if (layer.color !== undefined && layer.color !== 0) {
      const layerColorIndex = layer.colorIndex;
      // ACI 7 и 255 для слоя — белый цвет, на светлом фоне показываем чёрным
      if (layerColorIndex === 7 || layerColorIndex === 255) {
        return "#000000";
      }
      return rgbNumberToHex(layer.color);
    }
    if (layer.colorIndex >= 1 && layer.colorIndex <= 255) {
      if (layer.colorIndex === 7 || layer.colorIndex === 255) {
        return "#000000";
      }
      return rgbNumberToHex(ACI_PALETTE[layer.colorIndex]);
    }
  }

  return DEFAULT_ENTITY_COLOR;
}
