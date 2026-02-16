import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IPoint, IEntityBase } from "../parseHelpers";

export interface IAttdefEntity extends IEntityBase {
  type: "ATTDEF";
  text?: string;
  tag?: string;
  prompt?: string;
  textStyle?: string;
  startPoint?: IPoint;
  endPoint?: IPoint;
  thickness?: number;
  textHeight?: number;
  rotation?: number;
  scale?: number;
  obliqueAngle?: number;
  invisible?: boolean;
  constant?: boolean;
  verificationRequired?: boolean;
  preset?: boolean;
  backwards?: boolean;
  mirrored?: boolean;
  horizontalJustification?: number;
  fieldLength?: number;
  verticalJustification?: number;
}

export function parseAttdef(scanner: DxfScanner, curr: IGroup): IAttdefEntity {
  const entity = {
    type: curr.value,
    scale: 1,
    textStyle: "STANDARD",
  } as IAttdefEntity;
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code === 0) break;
    switch (curr.code) {
      case 1:
        entity.text = curr.value as string;
        break;
      case 2:
        entity.tag = curr.value as string;
        break;
      case 3:
        entity.prompt = curr.value as string;
        break;
      case 7:
        entity.textStyle = curr.value as string;
        break;
      case 10:
        entity.startPoint = helpers.parsePoint(scanner);
        break;
      case 11:
        entity.endPoint = helpers.parsePoint(scanner);
        break;
      case 39:
        entity.thickness = curr.value as number;
        break;
      case 40:
        entity.textHeight = curr.value as number;
        break;
      case 41:
        entity.scale = curr.value as number;
        break;
      case 50:
        entity.rotation = curr.value as number;
        break;
      case 51:
        entity.obliqueAngle = curr.value as number;
        break;
      case 70:
        entity.invisible = !!((curr.value as number) & 0x01);
        entity.constant = !!((curr.value as number) & 0x02);
        entity.verificationRequired = !!((curr.value as number) & 0x04);
        entity.preset = !!((curr.value as number) & 0x08);
        break;
      case 71:
        entity.backwards = !!((curr.value as number) & 0x02);
        entity.mirrored = !!((curr.value as number) & 0x04);
        break;
      case 72:
        entity.horizontalJustification = curr.value as number;
        break;
      case 73:
        entity.fieldLength = curr.value as number;
        break;
      case 74:
        entity.verticalJustification = curr.value as number;
        break;
      case 100:
        break;
      case 210:
        entity.extrusionDirectionX = curr.value as number;
        break;
      case 220:
        entity.extrusionDirectionY = curr.value as number;
        break;
      case 230:
        entity.extrusionDirectionZ = curr.value as number;
        break;
      default:
        helpers.checkCommonEntityProperties(entity, curr, scanner);
        break;
    }
    curr = scanner.next();
  }
  return entity;
}
