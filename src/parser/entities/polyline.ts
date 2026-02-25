import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IPoint, IEntityBase } from "../parseHelpers";

interface IVertexEntity extends IEntityBase, IPoint {
  bulge?: number;
}

export interface IPolylineEntity extends IEntityBase {
  type: "POLYLINE";
  vertices: IVertexEntity[];
  thickness?: number;
  shape?: boolean;
  includesCurveFitVertices?: boolean;
  includesSplineFitVertices?: boolean;
  is3dPolyline?: boolean;
  is3dPolygonMesh?: boolean;
  is3dPolygonMeshClosed?: boolean;
  isPolyfaceMesh?: boolean;
  hasContinuousLinetypePattern?: boolean;
  extrusionDirection?: IPoint;
}

export function parsePolyline(scanner: DxfScanner, curr: IGroup): IPolylineEntity {
  const entity = { type: curr.value, vertices: [] as IVertexEntity[] } as IPolylineEntity;
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code === 0) break;
    switch (curr.code) {
      case 10:
        break;
      case 20:
        break;
      case 30:
        break;
      case 39:
        entity.thickness = curr.value as number;
        break;
      case 40:
        break;
      case 41:
        break;
      case 70:
        entity.shape = ((curr.value as number) & 1) !== 0;
        entity.includesCurveFitVertices = ((curr.value as number) & 2) !== 0;
        entity.includesSplineFitVertices = ((curr.value as number) & 4) !== 0;
        entity.is3dPolyline = ((curr.value as number) & 8) !== 0;
        entity.is3dPolygonMesh = ((curr.value as number) & 16) !== 0;
        entity.is3dPolygonMeshClosed = ((curr.value as number) & 32) !== 0;
        entity.isPolyfaceMesh = ((curr.value as number) & 64) !== 0;
        entity.hasContinuousLinetypePattern = ((curr.value as number) & 128) !== 0;
        break;
      case 71:
      case 72:
      case 73:
      case 74:
      case 75:
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

  // Парсим VERTEX sub-entities до SEQEND
  entity.vertices = parsePolylineVertices(scanner, curr);

  return entity;
}

function parsePolylineVertices(scanner: DxfScanner, curr: IGroup): IVertexEntity[] {
  const vertices: IVertexEntity[] = [];
  while (!scanner.isEOF()) {
    if (curr.code === 0) {
      if (curr.value === "VERTEX") {
        vertices.push(parseVertex(scanner, curr));
        curr = scanner.lastReadGroup;
      } else if (curr.value === "SEQEND") {
        parseSeqEnd(scanner, curr);
        break;
      } else {
        // Неизвестная entity — выходим, чтобы не зациклиться
        break;
      }
    } else {
      curr = scanner.next();
    }
  }
  return vertices;
}

function parseVertex(scanner: DxfScanner, curr: IGroup): IVertexEntity {
  const entity = { type: curr.value } as IVertexEntity;
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code === 0) break;
    switch (curr.code) {
      case 10:
        entity.x = curr.value as number;
        break;
      case 20:
        entity.y = curr.value as number;
        break;
      case 30:
        entity.z = curr.value as number;
        break;
      case 40:
        break;
      case 41:
        break;
      case 42:
        if (curr.value !== 0) entity.bulge = curr.value as number;
        break;
      case 70:
        break;
      case 50:
        break;
      case 71:
        entity.faceA = curr.value as number;
        break;
      case 72:
        entity.faceB = curr.value as number;
        break;
      case 73:
        entity.faceC = curr.value as number;
        break;
      case 74:
        entity.faceD = curr.value as number;
        break;
      default:
        helpers.checkCommonEntityProperties(entity, curr, scanner);
        break;
    }
    curr = scanner.next();
  }
  return entity;
}

function parseSeqEnd(scanner: DxfScanner, curr: IGroup): void {
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code === 0) break;
    helpers.checkCommonEntityProperties({ type: "SEQEND" }, curr, scanner);
    curr = scanner.next();
  }
}
