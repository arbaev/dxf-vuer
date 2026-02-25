import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IPoint, IEntityBase } from "../parseHelpers";

export interface IDimensionEntity extends IEntityBase {
  type: "DIMENSION";
  block?: string;
  styleName?: string;
  anchorPoint?: IPoint;
  middleOfText?: IPoint;
  insertionPoint?: IPoint;
  linearOrAngularPoint1?: IPoint;
  linearOrAngularPoint2?: IPoint;
  diameterOrRadiusPoint?: IPoint;
  arcPoint?: IPoint;
  dimensionType?: number;
  attachmentPoint?: number;
  actualMeasurement?: number;
  text?: string;
  textHeight?: number;
  angle?: number;
}

export function parseDimension(scanner: DxfScanner, curr: IGroup): IDimensionEntity {
  const entity = { type: curr.value } as IDimensionEntity;
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code === 0) break;
    switch (curr.code) {
      case 2:
        entity.block = curr.value as string;
        break;
      case 3:
        entity.styleName = curr.value as string;
        break;
      case 10:
        entity.anchorPoint = helpers.parsePoint(scanner);
        break;
      case 11:
        entity.middleOfText = helpers.parsePoint(scanner);
        break;
      case 12:
        entity.insertionPoint = helpers.parsePoint(scanner);
        break;
      case 13:
        entity.linearOrAngularPoint1 = helpers.parsePoint(scanner);
        break;
      case 14:
        entity.linearOrAngularPoint2 = helpers.parsePoint(scanner);
        break;
      case 15:
        entity.diameterOrRadiusPoint = helpers.parsePoint(scanner);
        break;
      case 16:
        entity.arcPoint = helpers.parsePoint(scanner);
        break;
      case 70:
        entity.dimensionType = curr.value as number;
        break;
      case 71:
        entity.attachmentPoint = curr.value as number;
        break;
      case 42:
        entity.actualMeasurement = curr.value as number;
        break;
      case 1:
        entity.text = curr.value as string;
        break;
      case 140:
        entity.textHeight = curr.value as number;
        break;
      case 50:
        entity.angle = curr.value as number;
        break;
      default:
        helpers.checkCommonEntityProperties(entity, curr, scanner);
        break;
    }
    curr = scanner.next();
  }
  return entity;
}
