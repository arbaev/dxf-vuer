// Вспомогательные функции для парсинга DXF

import AUTO_CAD_COLOR_INDEX from "./acadColorIndex";
import type DxfScanner from "./scanner";
import type { IGroup } from "./scanner";

export interface IPoint {
  x: number;
  y: number;
  z?: number;
}

export interface IEntityBase {
  type: string;
  handle?: string | number;
  ownerHandle?: string;
  layer?: string;
  colorIndex?: number;
  color?: number;
  lineType?: string;
  lineweight?: number;
  visible?: boolean;
  [key: string]: unknown;
}

/** Получить RGB truecolor из ACI-индекса */
export function getAcadColor(index: number): number {
  return AUTO_CAD_COLOR_INDEX[index];
}

/**
 * Парсит 2D/3D координату. Сканер должен быть на группе с X-координатой.
 * Использует rewind для повторного чтения текущей группы.
 */
export function parsePoint(scanner: DxfScanner): IPoint {
  const point = {} as IPoint;

  // Перечитываем текущую группу для получения X
  scanner.rewind();
  let curr = scanner.next();

  let code = curr.code;
  point.x = curr.value as number;

  code += 10;
  curr = scanner.next();
  if (curr.code !== code)
    throw new Error("Expected code for point value to be " + code + " but got " + curr.code + ".");
  point.y = curr.value as number;

  code += 10;
  curr = scanner.next();
  if (curr.code !== code) {
    // Только X и Y, Z нет — откатываем
    scanner.rewind();
    return point;
  }
  point.z = curr.value as number;

  return point;
}

/**
 * Обрабатывает общие свойства entity (layer, color, handle и т.д.).
 * Возвращает true если группа обработана.
 */
export function checkCommonEntityProperties(
  entity: IEntityBase,
  curr: IGroup,
  scanner: DxfScanner,
): boolean {
  switch (curr.code) {
    case 0:
      entity.type = curr.value as string;
      break;
    case 5:
      entity.handle = curr.value as number;
      break;
    case 6:
      entity.lineType = curr.value as string;
      break;
    case 8:
      entity.layer = curr.value as string;
      break;
    case 48:
      entity.lineTypeScale = curr.value as number;
      break;
    case 60:
      entity.visible = curr.value === 0;
      break;
    case 62:
      entity.colorIndex = curr.value as number;
      entity.color = getAcadColor(Math.abs(curr.value as number));
      break;
    case 67:
      entity.inPaperSpace = curr.value !== 0;
      break;
    case 100:
      // Игнорируем маркеры подклассов
      break;
    case 101:
      // Embedded Object (ACAD 2018+) — пропускаем до code=0
      while (curr.code !== 0) {
        curr = scanner.next();
      }
      scanner.rewind();
      break;
    case 330:
      entity.ownerHandle = curr.value as string;
      break;
    case 347:
      entity.materialObjectHandle = curr.value as number;
      break;
    case 370:
      entity.lineweight = curr.value as number;
      break;
    case 420:
      entity.color = curr.value as number;
      break;
    case 1000:
      if (!entity.extendedData) entity.extendedData = {};
      if (!(entity.extendedData as Record<string, unknown>).customStrings)
        (entity.extendedData as Record<string, unknown>).customStrings = [];
      (
        (entity.extendedData as Record<string, unknown>).customStrings as string[]
      ).push(curr.value as string);
      break;
    case 1001:
      if (!entity.extendedData) entity.extendedData = {};
      (entity.extendedData as Record<string, unknown>).applicationName = curr.value as string;
      break;
    default:
      return false;
  }
  return true;
}
