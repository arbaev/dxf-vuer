import type DxfScanner from "../scanner";
import type { IPoint } from "../parseHelpers";

export function parseHeader(scanner: DxfScanner): Record<string, unknown> {
  let currVarName: string | null = null;
  let currVarValue: unknown = null;
  const header: Record<string, unknown> = {};

  let curr = scanner.next();

  while (true) {
    if (curr.code === 0 && curr.value === "ENDSEC") {
      if (currVarName) header[currVarName] = currVarValue;
      break;
    } else if (curr.code === 9) {
      if (currVarName) header[currVarName] = currVarValue;
      currVarName = curr.value as string;
    } else {
      if (curr.code === 10) {
        currVarValue = { x: curr.value as number } as IPoint;
      } else if (curr.code === 20) {
        (currVarValue as IPoint).y = curr.value as number;
      } else if (curr.code === 30) {
        (currVarValue as IPoint).z = curr.value as number;
      } else {
        currVarValue = curr.value;
      }
    }
    curr = scanner.next();
  }

  curr = scanner.next();
  return header;
}
