import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IPoint, IEntityBase } from "../parseHelpers";

export interface IEllipseEntity extends IEntityBase {
  type: "ELLIPSE";
  center: IPoint;
  majorAxisEndPoint: IPoint;
  axisRatio: number;
  startAngle: number;
  endAngle: number;
}

export function parseEllipse(scanner: DxfScanner, curr: IGroup): IEllipseEntity {
  const entity = { type: curr.value } as IEllipseEntity;
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code === 0) break;
    switch (curr.code) {
      case 10:
        entity.center = helpers.parsePoint(scanner);
        break;
      case 11:
        entity.majorAxisEndPoint = helpers.parsePoint(scanner);
        break;
      case 40:
        entity.axisRatio = curr.value as number;
        break;
      case 41:
        entity.startAngle = curr.value as number;
        break;
      case 42:
        entity.endAngle = curr.value as number;
        break;
      default:
        helpers.checkCommonEntityProperties(entity, curr, scanner);
        break;
    }
    curr = scanner.next();
  }
  return entity;
}
