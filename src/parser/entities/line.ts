import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IPoint, IEntityBase } from "../parseHelpers";

export interface ILineEntity extends IEntityBase {
  type: "LINE";
  vertices: IPoint[];
  extrusionDirection?: IPoint;
}

export function parseLine(scanner: DxfScanner, curr: IGroup): ILineEntity {
  const entity = { type: curr.value, vertices: [] as IPoint[] } as ILineEntity;
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code === 0) break;
    switch (curr.code) {
      case 10:
        entity.vertices.unshift(helpers.parsePoint(scanner));
        break;
      case 11:
        entity.vertices.push(helpers.parsePoint(scanner));
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
