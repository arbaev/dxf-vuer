import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IPoint, IEntityBase } from "../parseHelpers";

interface ILWVertex {
  x: number;
  y: number;
  z?: number;
  startWidth?: number;
  endWidth?: number;
  bulge?: number;
}

export interface ILWPolylineEntity extends IEntityBase {
  type: "LWPOLYLINE";
  vertices: ILWVertex[];
  elevation?: number;
  depth?: number;
  shape?: boolean;
  hasContinuousLinetypePattern?: boolean;
  width?: number;
  extrusionDirection?: IPoint;
}

export function parseLWPolyline(scanner: DxfScanner, curr: IGroup): ILWPolylineEntity {
  const entity = { type: curr.value, vertices: [] as ILWVertex[] } as ILWPolylineEntity;
  let numberOfVertices = 0;
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code === 0) break;
    switch (curr.code) {
      case 38:
        entity.elevation = curr.value as number;
        break;
      case 39:
        entity.depth = curr.value as number;
        break;
      case 70:
        entity.shape = ((curr.value as number) & 1) === 1;
        entity.hasContinuousLinetypePattern = ((curr.value as number) & 128) === 128;
        break;
      case 90:
        numberOfVertices = curr.value as number;
        break;
      case 10:
        entity.vertices = parseLWPolylineVertices(numberOfVertices, scanner);
        break;
      case 43:
        if (curr.value !== 0) entity.width = curr.value as number;
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

function parseLWPolylineVertices(n: number, scanner: DxfScanner): ILWVertex[] {
  if (!n || n <= 0) throw Error("n must be greater than 0 vertices");
  const vertices: ILWVertex[] = [];
  let vertexIsStarted = false;
  let vertexIsFinished = false;
  let curr = scanner.lastReadGroup;

  for (let i = 0; i < n; i++) {
    const vertex = {} as ILWVertex;
    while (!scanner.isEOF()) {
      if (curr.code === 0 || vertexIsFinished) break;
      switch (curr.code) {
        case 10:
          if (vertexIsStarted) {
            vertexIsFinished = true;
            continue;
          }
          vertex.x = curr.value as number;
          vertexIsStarted = true;
          break;
        case 20:
          vertex.y = curr.value as number;
          break;
        case 30:
          vertex.z = curr.value as number;
          break;
        case 40:
          vertex.startWidth = curr.value as number;
          break;
        case 41:
          vertex.endWidth = curr.value as number;
          break;
        case 42:
          if (curr.value !== 0) vertex.bulge = curr.value as number;
          break;
        default:
          // Неизвестный код — возвращаем вершины, код может принадлежать entity
          scanner.rewind();
          if (vertexIsStarted) {
            vertices.push(vertex);
          }
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
