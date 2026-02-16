// Парсер HATCH entity — штриховка / сплошная заливка

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

type IHatchEdge = IHatchEdgeLine | IHatchEdgeArc;

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
 * Парсит boundary path на основе рёбер (edges).
 * code 93 — количество рёбер, code 72 — тип ребра.
 */
function parseEdgeBoundary(scanner: DxfScanner, curr: IGroup): { path: IHatchBoundaryPath; curr: IGroup } {
  const edges: IHatchEdge[] = [];

  // code 93 — количество рёбер
  if (curr.code !== 93) {
    return { path: { edges }, curr };
  }
  const numEdges = curr.value as number;
  curr = scanner.next();

  for (let i = 0; i < numEdges; i++) {
    // code 72 — тип ребра
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
        // Если прочитали все 4 координаты линии — выходим
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
    } else {
      // Ellipse edge (3), spline edge (4) и другие — пропускаем
      while (curr.code !== 0 && curr.code !== 72 && curr.code !== 92 && curr.code !== 93 && curr.code !== 97) {
        curr = scanner.next();
      }
    }
  }

  return { path: { edges }, curr };
}

/**
 * Парсит polyline boundary path.
 * code 72 — has bulge flag, code 73 — is closed, code 93 — кол-во вершин,
 * 10/20 — координаты, 42 — bulge.
 */
function parsePolylineBoundary(scanner: DxfScanner, curr: IGroup): { path: IHatchBoundaryPath; curr: IGroup } {
  const vertices: (IPoint & { bulge?: number })[] = [];

  // code 72 — has bulge
  let hasBulge = false;
  if (curr.code === 72) {
    hasBulge = (curr.value as number) !== 0;
    curr = scanner.next();
  }
  // code 73 — is closed
  let isClosed = false;
  if (curr.code === 73) {
    isClosed = (curr.value as number) !== 0;
    curr = scanner.next();
  }
  // code 93 — количество вершин
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

  // Замыкаем полилайн: дублируем первую вершину в конец
  if (isClosed && vertices.length > 0) {
    const first = vertices[0];
    vertices.push({ x: first.x, y: first.y, bulge: first.bulge });
  }

  return { path: { polylineVertices: vertices }, curr };
}

/**
 * Парсит секцию определения паттерна (pattern definition lines).
 * code 78 — количество линий, для каждой: 53, 43, 44, 45, 46, 79, 49×N
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

    // code 53 — угол линии
    if (curr.code === 53) {
      pl.angle = curr.value as number;
      curr = scanner.next();
    }
    // code 43 — base point X
    if (curr.code === 43) {
      pl.basePoint.x = curr.value as number;
      curr = scanner.next();
    }
    // code 44 — base point Y
    if (curr.code === 44) {
      pl.basePoint.y = curr.value as number;
      curr = scanner.next();
    }
    // code 45 — offset X
    if (curr.code === 45) {
      pl.offset.x = curr.value as number;
      curr = scanner.next();
    }
    // code 46 — offset Y
    if (curr.code === 46) {
      pl.offset.y = curr.value as number;
      curr = scanner.next();
    }
    // code 79 — количество дэшей
    if (curr.code === 79) {
      numDashes = curr.value as number;
      curr = scanner.next();
    }
    // code 49 × numDashes — длины дэшей
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
        // Начало boundary path
        if (boundaryPathsParsed >= numBoundaryPaths) break;
        const pathTypeFlag = curr.value as number;
        curr = scanner.next();

        if (pathTypeFlag & 2) {
          // Polyline boundary (bit 1 set = polyline type)
          const result = parsePolylineBoundary(scanner, curr);
          entity.boundaryPaths.push(result.path);
          curr = result.curr;
        } else {
          // Edge-based boundary
          const result = parseEdgeBoundary(scanner, curr);
          entity.boundaryPaths.push(result.path);
          curr = result.curr;
        }
        boundaryPathsParsed++;
        continue; // curr уже обновлён внутри парсера
      }
      case 78: {
        // Секция определения паттерна
        const numPatternLines = curr.value as number;
        if (numPatternLines > 0) {
          curr = scanner.next();
          const result = parsePatternLines(scanner, curr, numPatternLines);
          entity.patternLines = result.lines;
          curr = result.curr;
          continue; // curr уже обновлён
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
