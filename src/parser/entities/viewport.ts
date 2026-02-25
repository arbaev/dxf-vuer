import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IEntityBase } from "../parseHelpers";

export interface IViewportEntity extends IEntityBase {
  type: "VIEWPORT";
}

export function parseViewport(scanner: DxfScanner, curr: IGroup): IViewportEntity {
  const entity = { type: curr.value } as IViewportEntity;
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code === 0) break;
    helpers.checkCommonEntityProperties(entity, curr, scanner);
    curr = scanner.next();
  }
  return entity;
}
