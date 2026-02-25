import AUTO_CAD_COLOR_INDEX from "./acadColorIndex";
import type DxfScanner from "./scanner";
import type { IGroup } from "./scanner";
import type { DxfVertex, DxfEntityBase } from "@/types/dxf";

export type IPoint = DxfVertex;

export interface IEntityBase extends DxfEntityBase {
  type: string;
  [key: string]: unknown;
}

export function getAcadColor(index: number): number {
  return AUTO_CAD_COLOR_INDEX[index];
}

/**
 * Parses a 2D/3D coordinate. Scanner must be on the group with the X coordinate.
 * Uses rewind to re-read the current group.
 */
export function parsePoint(scanner: DxfScanner): IPoint {
  const point = {} as IPoint;

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
    scanner.rewind();
    return point;
  }
  point.z = curr.value as number;

  return point;
}

/**
 * Parses a point inline -- without rewind, used in sections (BLOCKS, TABLES).
 * Reads Y and Z coordinates from the next groups.
 */
export function parsePointInline(scanner: DxfScanner, curr: IGroup): IPoint {
  const point = {} as IPoint;
  const code = curr.code;
  point.x = curr.value as number;

  const nextY = scanner.next();
  if (nextY.code === code + 10) {
    point.y = nextY.value as number;
    const nextZ = scanner.next();
    if (nextZ.code === code + 20) {
      point.z = nextZ.value as number;
    } else {
      scanner.rewind();
    }
  } else {
    scanner.rewind();
  }
  return point;
}

/**
 * Processes common entity properties (layer, color, handle, etc.).
 * Returns true if the group was handled.
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
      break;
    case 67:
      entity.inPaperSpace = curr.value !== 0;
      break;
    case 100:
      break;
    case 101:
      // Embedded Object (ACAD 2018+) -- skip until code=0
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
