import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IPoint, IEntityBase } from "../parseHelpers";

export interface IMTextEntity extends IEntityBase {
  type: "MTEXT";
  text: string;
  position?: IPoint;
  directionVector?: IPoint;
  height?: number;
  width?: number;
  rotation?: number;
  attachmentPoint?: number;
  drawingDirection?: number;
}

export function parseMText(scanner: DxfScanner, curr: IGroup): IMTextEntity {
  const entity = { type: curr.value } as IMTextEntity;
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code === 0) break;
    switch (curr.code) {
      case 3:
        entity.text ? (entity.text += curr.value) : (entity.text = curr.value as string);
        break;
      case 1:
        entity.text ? (entity.text += curr.value) : (entity.text = curr.value as string);
        break;
      case 10:
        entity.position = helpers.parsePoint(scanner);
        break;
      case 11:
        entity.directionVector = helpers.parsePoint(scanner);
        break;
      case 40:
        entity.height = curr.value as number;
        break;
      case 41:
        entity.width = curr.value as number;
        break;
      case 50:
        entity.rotation = curr.value as number;
        break;
      case 71:
        entity.attachmentPoint = curr.value as number;
        break;
      case 72:
        entity.drawingDirection = curr.value as number;
        break;
      default:
        helpers.checkCommonEntityProperties(entity, curr, scanner);
        break;
    }
    curr = scanner.next();
  }
  return entity;
}
