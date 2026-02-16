import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IPoint, IEntityBase } from "../parseHelpers";

export interface ICircleEntity extends IEntityBase {
  type: "CIRCLE";
  center: IPoint;
  radius: number;
}

export function parseCircle(scanner: DxfScanner, curr: IGroup): ICircleEntity {
  const entity = { type: curr.value } as ICircleEntity;
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code === 0) break;
    switch (curr.code) {
      case 10:
        entity.center = helpers.parsePoint(scanner);
        break;
      case 40:
        entity.radius = curr.value as number;
        break;
      default:
        helpers.checkCommonEntityProperties(entity, curr, scanner);
        break;
    }
    curr = scanner.next();
  }
  return entity;
}
