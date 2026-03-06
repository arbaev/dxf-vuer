import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IPoint, IEntityBase } from "../parseHelpers";

export interface IXlineEntity extends IEntityBase {
  type: "XLINE" | "RAY";
  basePoint: IPoint;
  direction: IPoint;
}

export function parseXline(scanner: DxfScanner, curr: IGroup): IXlineEntity {
  const entity = { type: curr.value } as IXlineEntity;
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code === 0) break;
    switch (curr.code) {
      case 10:
        entity.basePoint = helpers.parsePoint(scanner);
        break;
      case 11:
        entity.direction = helpers.parsePoint(scanner);
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
