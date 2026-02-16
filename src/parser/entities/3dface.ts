import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IPoint, IEntityBase } from "../parseHelpers";

export interface I3DFaceEntity extends IEntityBase {
  type: "3DFACE";
  shape?: boolean;
  hasContinuousLinetypePattern?: boolean;
  vertices: IPoint[];
}

export function parse3DFace(scanner: DxfScanner, curr: IGroup): I3DFaceEntity {
  const entity = { type: curr.value as string, vertices: [] as IPoint[] } as I3DFaceEntity;
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code === 0) break;
    switch (curr.code) {
      case 70:
        entity.shape = ((curr.value as number) & 1) === 1;
        entity.hasContinuousLinetypePattern = ((curr.value as number) & 128) === 128;
        break;
      case 10:
        entity.vertices = parse3DFaceVertices(scanner, curr);
        curr = scanner.lastReadGroup;
        break;
      default:
        helpers.checkCommonEntityProperties(entity, curr, scanner);
        break;
    }
    curr = scanner.next();
  }
  return entity;
}

function parse3DFaceVertices(scanner: DxfScanner, curr: IGroup): IPoint[] {
  const vertices: IPoint[] = [];
  let vertexIsStarted = false;
  let vertexIsFinished = false;
  const verticesPer3dFace = 4;

  for (let i = 0; i <= verticesPer3dFace; i++) {
    const vertex = {} as IPoint;
    while (!scanner.isEOF()) {
      if (curr.code === 0 || vertexIsFinished) break;

      switch (curr.code) {
        case 10:
        case 11:
        case 12:
        case 13:
          if (vertexIsStarted) {
            vertexIsFinished = true;
            continue;
          }
          vertex.x = curr.value as number;
          vertexIsStarted = true;
          break;
        case 20:
        case 21:
        case 22:
        case 23:
          vertex.y = curr.value as number;
          break;
        case 30:
        case 31:
        case 32:
        case 33:
          vertex.z = curr.value as number;
          break;
        default:
          return vertices;
      }
      curr = scanner.next();
    }
    vertices.push(vertex);
    vertexIsStarted = false;
    vertexIsFinished = false;
  }
  scanner.rewind();
  return vertices;
}
