import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IEntityBase } from "../parseHelpers";

export interface IWipeoutEntity extends IEntityBase {
  type: "WIPEOUT";
}

export function parseWipeout(scanner: DxfScanner, curr: IGroup): IWipeoutEntity {
  const entity = { type: curr.value } as IWipeoutEntity;
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code === 0) break;
    helpers.checkCommonEntityProperties(entity, curr, scanner);
    curr = scanner.next();
  }
  return entity;
}
