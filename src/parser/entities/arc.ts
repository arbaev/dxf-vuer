import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IPoint, IEntityBase } from "../parseHelpers";

export interface IArcEntity extends IEntityBase {
  type: "ARC";
  center: IPoint;
  radius: number;
  startAngle: number;
  endAngle: number;
  angleLength?: number;
  extrusionDirection?: IPoint;
}

export function parseArc(scanner: DxfScanner, curr: IGroup): IArcEntity {
  const entity = { type: curr.value } as IArcEntity;
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
      case 50:
        entity.startAngle = (Math.PI / 180) * (curr.value as number);
        break;
      case 51:
        entity.endAngle = (Math.PI / 180) * (curr.value as number);
        entity.angleLength = entity.endAngle - entity.startAngle;
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
