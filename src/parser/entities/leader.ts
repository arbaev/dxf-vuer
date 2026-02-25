import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IPoint, IEntityBase } from "../parseHelpers";

export interface ILeaderEntity extends IEntityBase {
  type: "LEADER";
  vertices: IPoint[];
  styleName?: string;
  arrowHeadFlag?: number; // 71: 0 = без стрелки, 1 = со стрелкой
  numVertices?: number; // 76: количество вершин
}

export function parseLeader(scanner: DxfScanner, curr: IGroup): ILeaderEntity {
  const entity = { type: curr.value, vertices: [] as IPoint[] } as ILeaderEntity;
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code === 0) break;
    switch (curr.code) {
      case 3:
        entity.styleName = curr.value as string;
        break;
      case 10:
        entity.vertices.push(helpers.parsePoint(scanner));
        break;
      case 71:
        entity.arrowHeadFlag = curr.value as number;
        break;
      case 76:
        entity.numVertices = curr.value as number;
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
