import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IPoint, IEntityBase } from "../parseHelpers";

interface IHatchEdgeLine {
  type: "line";
  start: IPoint;
  end: IPoint;
}

interface IHatchEdgeArc {
  type: "arc";
  center: IPoint;
  radius: number;
  startAngle: number;
  endAngle: number;
  ccw: boolean;
}

interface IHatchEdgeEllipse {
  type: "ellipse";
  center: IPoint;
  majorAxisEndPoint: IPoint;
  axisRatio: number;
  startAngle: number;
  endAngle: number;
  ccw: boolean;
}

interface IHatchEdgeSpline {
  type: "spline";
  degree: number;
  knots: number[];
  controlPoints: IPoint[];
  weights?: number[];
  fitPoints?: IPoint[];
}

type IHatchEdge = IHatchEdgeLine | IHatchEdgeArc | IHatchEdgeEllipse | IHatchEdgeSpline;

interface IHatchBoundaryPath {
  edges?: IHatchEdge[];
  polylineVertices?: (IPoint & { bulge?: number })[];
}

interface IHatchPatternLine {
  angle: number;
  basePoint: IPoint;
  offset: IPoint;
  dashes: number[];
}

export interface IHatchEntity extends IEntityBase {
  type: "HATCH";
  patternName: string;
  solid: boolean;
  boundaryPaths: IHatchBoundaryPath[];
  patternLines?: IHatchPatternLine[];
}

/**
 * Parses edge-based boundary path.
 * Code 93 = number of edges, code 72 = edge type.
 */
function parseEdgeBoundary(scanner: DxfScanner, curr: IGroup): { path: IHatchBoundaryPath; curr: IGroup } {
  const edges: IHatchEdge[] = [];

  if (curr.code !== 93) {
    return { path: { edges }, curr };
  }
  const numEdges = curr.value as number;
  curr = scanner.next();

  for (let i = 0; i < numEdges; i++) {
    if (curr.code !== 72) break;
    const edgeType = curr.value as number;
    curr = scanner.next();

    if (edgeType === 1) {
      // Line edge: start (10/20), end (11/21)
      let startX = 0, startY = 0, endX = 0, endY = 0;
      while (curr.code !== 0 && curr.code !== 72 && curr.code !== 92 && curr.code !== 93 && curr.code !== 97) {
        switch (curr.code) {
          case 10: startX = curr.value as number; break;
          case 20: startY = curr.value as number; break;
          case 11: endX = curr.value as number; break;
          case 21: endY = curr.value as number; break;
        }
        // All 4 line coordinates read -- exit
        if (curr.code === 21) { curr = scanner.next(); break; }
        curr = scanner.next();
      }
      edges.push({
        type: "line",
        start: { x: startX, y: startY },
        end: { x: endX, y: endY },
      });
    } else if (edgeType === 2) {
      // Arc edge: center (10/20), radius (40), startAngle (50), endAngle (51), CCW (73)
      let cx = 0, cy = 0, radius = 0, startAngle = 0, endAngle = 0, ccw = false;
      while (curr.code !== 0 && curr.code !== 72 && curr.code !== 92 && curr.code !== 93 && curr.code !== 97) {
        switch (curr.code) {
          case 10: cx = curr.value as number; break;
          case 20: cy = curr.value as number; break;
          case 40: radius = curr.value as number; break;
          case 50: startAngle = curr.value as number; break;
          case 51: endAngle = curr.value as number; break;
          case 73: ccw = (curr.value as number) !== 0; break;
        }
        if (curr.code === 73) { curr = scanner.next(); break; }
        curr = scanner.next();
      }
      edges.push({
        type: "arc",
        center: { x: cx, y: cy },
        radius,
        startAngle,
        endAngle,
        ccw,
      });
    } else if (edgeType === 3) {
      // Ellipse edge: center (10/20), majorAxisEndPoint (11/21), axisRatio (40),
      // startAngle (50), endAngle (51), ccw (73)
      let cx = 0, cy = 0, mx = 0, my = 0, ratio = 1, startAngle = 0, endAngle = 0, ccw = false;
      while (curr.code !== 0 && curr.code !== 72 && curr.code !== 92 && curr.code !== 93 && curr.code !== 97) {
        switch (curr.code) {
          case 10: cx = curr.value as number; break;
          case 20: cy = curr.value as number; break;
          case 11: mx = curr.value as number; break;
          case 21: my = curr.value as number; break;
          case 40: ratio = curr.value as number; break;
          case 50: startAngle = curr.value as number; break;
          case 51: endAngle = curr.value as number; break;
          case 73: ccw = (curr.value as number) !== 0; break;
        }
        if (curr.code === 73) { curr = scanner.next(); break; }
        curr = scanner.next();
      }
      edges.push({
        type: "ellipse",
        center: { x: cx, y: cy },
        majorAxisEndPoint: { x: mx, y: my },
        axisRatio: ratio,
        startAngle,
        endAngle,
        ccw,
      });
    } else if (edgeType === 4) {
      // Spline edge: degree (94), rational (73), periodic (74),
      // numKnots (95), numControlPoints (96), knots (40xN), controlPoints (10/20xN),
      // weights (42xN), numFitPoints (97), fitPoints (11/21xN)
      let degree = 3;
      const knots: number[] = [];
      const controlPoints: IPoint[] = [];
      const weights: number[] = [];
      const fitPoints: IPoint[] = [];

      while (curr.code !== 0 && curr.code !== 72 && curr.code !== 92 && curr.code !== 93) {
        switch (curr.code) {
          case 94: degree = curr.value as number; break;
          case 73: break; // rational flag
          case 74: break; // periodic flag
          case 95: break; // numKnots -- informational, actual count derived from code 40 occurrences
          case 96: break; // numControlPoints -- informational
          case 40: knots.push(curr.value as number); break;
          case 10: {
            const px = curr.value as number;
            curr = scanner.next();
            const py = curr.code === 20 ? (curr.value as number) : 0;
            controlPoints.push({ x: px, y: py });
            break;
          }
          case 42: weights.push(curr.value as number); break;
          case 97: break; // numFitPoints -- informational
          case 11: {
            const fx = curr.value as number;
            curr = scanner.next();
            const fy = curr.code === 21 ? (curr.value as number) : 0;
            fitPoints.push({ x: fx, y: fy });
            break;
          }
          default: break;
        }
        curr = scanner.next();
      }
      const edge: IHatchEdgeSpline = {
        type: "spline",
        degree,
        knots,
        controlPoints,
      };
      if (weights.length > 0) edge.weights = weights;
      if (fitPoints.length > 0) edge.fitPoints = fitPoints;
      edges.push(edge);
    } else {
      while (curr.code !== 0 && curr.code !== 72 && curr.code !== 92 && curr.code !== 93 && curr.code !== 97) {
        curr = scanner.next();
      }
    }
  }

  return { path: { edges }, curr };
}

/**
 * Parses polyline boundary path.
 * Code 72 = has bulge, 73 = is closed, 93 = vertex count,
 * 10/20 = coordinates, 42 = bulge.
 */
function parsePolylineBoundary(scanner: DxfScanner, curr: IGroup): { path: IHatchBoundaryPath; curr: IGroup } {
  const vertices: (IPoint & { bulge?: number })[] = [];

  let hasBulge = false;
  if (curr.code === 72) {
    hasBulge = (curr.value as number) !== 0;
    curr = scanner.next();
  }
  let isClosed = false;
  if (curr.code === 73) {
    isClosed = (curr.value as number) !== 0;
    curr = scanner.next();
  }
  let numVertices = 0;
  if (curr.code === 93) {
    numVertices = curr.value as number;
    curr = scanner.next();
  }

  for (let i = 0; i < numVertices; i++) {
    let x = 0, y = 0, bulge = 0;
    if (curr.code === 10) {
      x = curr.value as number;
      curr = scanner.next();
    }
    if (curr.code === 20) {
      y = curr.value as number;
      curr = scanner.next();
    }
    if (hasBulge && curr.code === 42) {
      bulge = curr.value as number;
      curr = scanner.next();
    }
    const vertex: IPoint & { bulge?: number } = { x, y };
    if (bulge !== 0) vertex.bulge = bulge;
    vertices.push(vertex);
  }

  // Close polyline: duplicate first vertex at the end
  if (isClosed && vertices.length > 0) {
    const first = vertices[0];
    vertices.push({ x: first.x, y: first.y, bulge: first.bulge });
  }

  return { path: { polylineVertices: vertices }, curr };
}

/**
 * Parses pattern definition lines.
 * For each line: 53=angle, 43/44=basePoint, 45/46=offset, 79=numDashes, 49xN=dashes
 */
function parsePatternLines(scanner: DxfScanner, curr: IGroup, numLines: number): { lines: IHatchPatternLine[]; curr: IGroup } {
  const lines: IHatchPatternLine[] = [];

  for (let i = 0; i < numLines; i++) {
    const pl: IHatchPatternLine = {
      angle: 0,
      basePoint: { x: 0, y: 0 },
      offset: { x: 0, y: 0 },
      dashes: [],
    };
    let numDashes = 0;

    if (curr.code === 53) {
      pl.angle = curr.value as number;
      curr = scanner.next();
    }
    if (curr.code === 43) {
      pl.basePoint.x = curr.value as number;
      curr = scanner.next();
    }
    if (curr.code === 44) {
      pl.basePoint.y = curr.value as number;
      curr = scanner.next();
    }
    if (curr.code === 45) {
      pl.offset.x = curr.value as number;
      curr = scanner.next();
    }
    if (curr.code === 46) {
      pl.offset.y = curr.value as number;
      curr = scanner.next();
    }
    if (curr.code === 79) {
      numDashes = curr.value as number;
      curr = scanner.next();
    }
    for (let d = 0; d < numDashes; d++) {
      if (curr.code === 49) {
        pl.dashes.push(curr.value as number);
        curr = scanner.next();
      }
    }

    lines.push(pl);
  }

  return { lines, curr };
}

export function parseHatch(scanner: DxfScanner, curr: IGroup): IHatchEntity {
  const entity: IHatchEntity = {
    type: "HATCH",
    patternName: "",
    solid: false,
    boundaryPaths: [],
  };

  curr = scanner.next();

  let numBoundaryPaths = 0;
  let boundaryPathsParsed = 0;

  while (!scanner.isEOF()) {
    if (curr.code === 0) break;

    switch (curr.code) {
      case 2:
        entity.patternName = curr.value as string;
        break;
      case 70:
        entity.solid = (curr.value as number) === 1;
        break;
      case 91:
        numBoundaryPaths = curr.value as number;
        break;
      case 92: {
        if (boundaryPathsParsed >= numBoundaryPaths) break;
        const pathTypeFlag = curr.value as number;
        curr = scanner.next();

        if (pathTypeFlag & 2) {
          // Bit 1 set = polyline boundary type
          const result = parsePolylineBoundary(scanner, curr);
          entity.boundaryPaths.push(result.path);
          curr = result.curr;
        } else {
          const result = parseEdgeBoundary(scanner, curr);
          entity.boundaryPaths.push(result.path);
          curr = result.curr;
        }
        boundaryPathsParsed++;
        continue;
      }
      case 78: {
        const numPatternLines = curr.value as number;
        if (numPatternLines > 0) {
          curr = scanner.next();
          const result = parsePatternLines(scanner, curr, numPatternLines);
          entity.patternLines = result.lines;
          curr = result.curr;
          continue;
        }
        break;
      }
      default:
        helpers.checkCommonEntityProperties(entity, curr, scanner);
        break;
    }
    curr = scanner.next();
  }

  return entity;
}
