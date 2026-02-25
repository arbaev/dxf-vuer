import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IPoint, IEntityBase } from "../parseHelpers";

export interface ISplineEntity extends IEntityBase {
  type: "SPLINE";
  controlPoints?: IPoint[];
  fitPoints?: IPoint[];
  startTangent?: IPoint;
  endTangent?: IPoint;
  knotValues?: number[];
  weights?: number[];
  closed?: boolean;
  periodic?: boolean;
  rational?: boolean;
  planar?: boolean;
  linear?: boolean;
  degreeOfSplineCurve?: number;
  numberOfKnots?: number;
  numberOfControlPoints?: number;
  numberOfFitPoints?: number;
  normalVector?: IPoint;
}

export function parseSpline(scanner: DxfScanner, curr: IGroup): ISplineEntity {
  const entity = { type: curr.value } as ISplineEntity;
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code === 0) break;
    switch (curr.code) {
      case 10:
        if (!entity.controlPoints) entity.controlPoints = [];
        entity.controlPoints.push(helpers.parsePoint(scanner));
        break;
      case 11:
        if (!entity.fitPoints) entity.fitPoints = [];
        entity.fitPoints.push(helpers.parsePoint(scanner));
        break;
      case 12:
        entity.startTangent = helpers.parsePoint(scanner);
        break;
      case 13:
        entity.endTangent = helpers.parsePoint(scanner);
        break;
      case 40:
        if (!entity.knotValues) entity.knotValues = [];
        entity.knotValues.push(curr.value as number);
        break;
      case 41:
        if (!entity.weights) entity.weights = [];
        entity.weights.push(curr.value as number);
        break;
      case 70:
        if (((curr.value as number) & 1) !== 0) entity.closed = true;
        if (((curr.value as number) & 2) !== 0) entity.periodic = true;
        if (((curr.value as number) & 4) !== 0) entity.rational = true;
        if (((curr.value as number) & 8) !== 0) entity.planar = true;
        if (((curr.value as number) & 16) !== 0) {
          entity.planar = true;
          entity.linear = true;
        }
        break;
      case 71:
        entity.degreeOfSplineCurve = curr.value as number;
        break;
      case 72:
        entity.numberOfKnots = curr.value as number;
        break;
      case 73:
        entity.numberOfControlPoints = curr.value as number;
        break;
      case 74:
        entity.numberOfFitPoints = curr.value as number;
        break;
      case 210:
        entity.normalVector = helpers.parsePoint(scanner);
        break;
      default:
        helpers.checkCommonEntityProperties(entity, curr, scanner);
        break;
    }
    curr = scanner.next();
  }
  return entity;
}
