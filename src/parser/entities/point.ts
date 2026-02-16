import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IPoint, IEntityBase } from "../parseHelpers";

export interface IPointEntity extends IEntityBase {
  type: "POINT";
  position: IPoint;
  thickness?: number;
  extrusionDirection?: IPoint;
}

export function parsePoint(scanner: DxfScanner, curr: IGroup): IPointEntity {
  const entity = { type: curr.value } as IPointEntity;
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code === 0) break;
    switch (curr.code) {
      case 10:
        entity.position = helpers.parsePoint(scanner);
        break;
      case 39:
        entity.thickness = curr.value as number;
        break;
      case 210:
        entity.extrusionDirection = helpers.parsePoint(scanner);
        break;
      case 100:
        break;
      default:
        helpers.checkCommonEntityProperties(entity, curr, scanner);
        break;
    }
    curr = scanner.next();
  }
  return entity;
}
