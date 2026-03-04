import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IPoint, IEntityBase } from "../parseHelpers";

export interface ITextEntity extends IEntityBase {
  type: "TEXT";
  startPoint?: IPoint;
  endPoint?: IPoint;
  textHeight?: number;
  xScale?: number;
  rotation?: number;
  text: string;
  textStyle?: string;
  halign?: number;
  valign?: number;
  extrusionDirection?: IPoint;
}

export function parseText(scanner: DxfScanner, curr: IGroup): ITextEntity {
  const entity = { type: curr.value } as ITextEntity;
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code === 0) break;
    switch (curr.code) {
      case 10:
        entity.startPoint = helpers.parsePoint(scanner);
        break;
      case 11:
        entity.endPoint = helpers.parsePoint(scanner);
        break;
      case 40:
        entity.textHeight = curr.value as number;
        break;
      case 41:
        entity.xScale = curr.value as number;
        break;
      case 50:
        entity.rotation = curr.value as number;
        break;
      case 1:
        entity.text = curr.value as string;
        break;
      case 7:
        entity.textStyle = curr.value as string;
        break;
      case 72:
        entity.halign = curr.value as number;
        break;
      case 73:
        entity.valign = curr.value as number;
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
