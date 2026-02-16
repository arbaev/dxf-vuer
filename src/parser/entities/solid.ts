import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IPoint, IEntityBase } from "../parseHelpers";

export interface ISolidEntity extends IEntityBase {
  type: "SOLID";
  points: IPoint[];
  extrusionDirection?: IPoint;
}

export function parseSolid(scanner: DxfScanner, curr: IGroup): ISolidEntity {
  const entity = { type: curr.value, points: [] as IPoint[] } as ISolidEntity;
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code === 0) break;
    switch (curr.code) {
      case 10:
        entity.points[0] = helpers.parsePoint(scanner);
        break;
      case 11:
        entity.points[1] = helpers.parsePoint(scanner);
        break;
      case 12:
        entity.points[2] = helpers.parsePoint(scanner);
        break;
      case 13:
        entity.points[3] = helpers.parsePoint(scanner);
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
