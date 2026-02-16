import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IPoint, IEntityBase } from "../parseHelpers";

export interface IInsertEntity extends IEntityBase {
  type: "INSERT";
  name: string;
  position: IPoint;
  xScale?: number;
  yScale?: number;
  zScale?: number;
  rotation?: number;
  columnCount?: number;
  rowCount?: number;
  columnSpacing?: number;
  rowSpacing?: number;
  extrusionDirection?: IPoint;
}

export function parseInsert(scanner: DxfScanner, curr: IGroup): IInsertEntity {
  const entity = { type: curr.value } as IInsertEntity;
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code === 0) break;
    switch (curr.code) {
      case 2:
        entity.name = curr.value as string;
        break;
      case 41:
        entity.xScale = curr.value as number;
        break;
      case 42:
        entity.yScale = curr.value as number;
        break;
      case 43:
        entity.zScale = curr.value as number;
        break;
      case 10:
        entity.position = helpers.parsePoint(scanner);
        break;
      case 50:
        entity.rotation = curr.value as number;
        break;
      case 70:
        entity.columnCount = curr.value as number;
        break;
      case 71:
        entity.rowCount = curr.value as number;
        break;
      case 44:
        entity.columnSpacing = curr.value as number;
        break;
      case 45:
        entity.rowSpacing = curr.value as number;
        break;
      case 210:
        entity.extrusionDirection = helpers.parsePoint(scanner);
        break;
      default:
        helpers.checkCommonEntityProperties(entity, curr, scanner);
        break;
    }
    curr = scanner.next();
  }
  return entity;
}
