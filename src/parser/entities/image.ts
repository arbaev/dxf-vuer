import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IEntityBase } from "../parseHelpers";

export interface IImageEntity extends IEntityBase {
  type: "IMAGE";
}

export function parseImage(scanner: DxfScanner, curr: IGroup): IImageEntity {
  const entity = { type: curr.value } as IImageEntity;
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code === 0) break;
    helpers.checkCommonEntityProperties(entity, curr, scanner);
    curr = scanner.next();
  }
  return entity;
}
