// Парсер секции TABLES (LAYER, LTYPE и другие таблицы)

import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import { getAcadColor, type IPoint } from "../parseHelpers";

export interface ILayer {
  name: string;
  visible: boolean;
  colorIndex: number;
  color: number;
  frozen: boolean;
}

export interface ILineType {
  name: string;
  description: string;
  pattern: string[];
  patternLength: number;
}

interface IBaseTable {
  handle?: string;
  ownerHandle?: string;
  [key: string]: unknown;
}

interface ITableDefinition {
  tableRecordsProperty: string;
  tableName: string;
  dxfSymbolName: string;
  parseTableRecords: () => unknown;
}

/**
 * Парсит секцию TABLES
 */
export function parseTables(scanner: DxfScanner): Record<string, IBaseTable> {
  const tables: Record<string, IBaseTable> = {};
  let curr = scanner.next();

  const tableDefinitions: Record<string, ITableDefinition> = {
    VPORT: {
      tableRecordsProperty: "viewPorts",
      tableName: "viewPort",
      dxfSymbolName: "VPORT",
      parseTableRecords: () => parseViewPortRecords(scanner),
    },
    LTYPE: {
      tableRecordsProperty: "lineTypes",
      tableName: "lineType",
      dxfSymbolName: "LTYPE",
      parseTableRecords: () => parseLineTypes(scanner),
    },
    LAYER: {
      tableRecordsProperty: "layers",
      tableName: "layer",
      dxfSymbolName: "LAYER",
      parseTableRecords: () => parseLayers(scanner),
    },
  };

  while (curr.value !== "EOF") {
    if (curr.code === 0 && curr.value === "ENDSEC") break;

    if (curr.code === 0 && curr.value === "TABLE") {
      curr = scanner.next();
      const tableDef = tableDefinitions[curr.value as string];
      if (tableDef) {
        tables[tableDef.tableName] = parseTable(scanner, curr, tableDef);
        curr = scanner.lastReadGroup;
      }
      // Пропускаем неизвестные таблицы
    } else {
      curr = scanner.next();
    }
  }

  curr = scanner.next(); // Проглатываем ENDSEC
  return tables;
}

function parseTable(
  scanner: DxfScanner,
  _group: IGroup,
  tableDefinition: ITableDefinition,
): IBaseTable {
  const table: IBaseTable = {};
  let curr = scanner.next();

  while (!(curr.code === 0 && curr.value === "ENDTAB")) {
    switch (curr.code) {
      case 5:
        table.handle = curr.value as string;
        curr = scanner.next();
        break;
      case 330:
        table.ownerHandle = curr.value as string;
        curr = scanner.next();
        break;
      case 100:
        curr = scanner.next();
        break;
      case 70:
        curr = scanner.next();
        break;
      case 0:
        if (curr.value === tableDefinition.dxfSymbolName) {
          table[tableDefinition.tableRecordsProperty] = tableDefinition.parseTableRecords();
          curr = scanner.lastReadGroup;
        } else {
          curr = scanner.next();
        }
        break;
      default:
        curr = scanner.next();
    }
  }
  curr = scanner.next(); // Проглатываем ENDTAB
  return table;
}

function parseLayers(scanner: DxfScanner): Record<string, ILayer> {
  const layers: Record<string, ILayer> = {};
  let layer = {} as ILayer;
  let layerName: string | undefined;

  let curr = scanner.next();
  while (!(curr.code === 0 && curr.value === "ENDTAB")) {
    switch (curr.code) {
      case 2:
        layer.name = curr.value as string;
        layerName = curr.value as string;
        curr = scanner.next();
        break;
      case 62:
        layer.visible = (curr.value as number) >= 0;
        layer.colorIndex = Math.abs(curr.value as number);
        layer.color = getAcadColor(layer.colorIndex);
        curr = scanner.next();
        break;
      case 70:
        layer.frozen =
          ((curr.value as number) & 1) !== 0 || ((curr.value as number) & 2) !== 0;
        curr = scanner.next();
        break;
      case 0:
        // Новый слой или неизвестное значение — сохраняем слой и продвигаем сканер
        if (curr.value === "LAYER") {
          layers[layerName!] = layer;
          layer = {} as ILayer;
          layerName = undefined;
        }
        curr = scanner.next();
        break;
      default:
        curr = scanner.next();
        break;
    }
  }
  // Не вызываем scanner.next() — parseTable() сам обработает ENDTAB
  if (layerName) layers[layerName] = layer;
  return layers;
}

function parseLineTypes(scanner: DxfScanner): Record<string, ILineType> {
  const ltypes: Record<string, ILineType> = {};
  let ltype = {} as ILineType;
  let length = 0;
  let ltypeName = "";

  let curr = scanner.next();
  while (!(curr.code === 0 && curr.value === "ENDTAB")) {
    switch (curr.code) {
      case 2:
        ltype.name = curr.value as string;
        ltypeName = curr.value as string;
        curr = scanner.next();
        break;
      case 3:
        ltype.description = curr.value as string;
        curr = scanner.next();
        break;
      case 73:
        length = curr.value as number;
        if (length > 0) ltype.pattern = [];
        curr = scanner.next();
        break;
      case 40:
        ltype.patternLength = curr.value as number;
        curr = scanner.next();
        break;
      case 49:
        ltype.pattern.push(curr.value as string);
        curr = scanner.next();
        break;
      case 0:
        ltypes[ltypeName] = ltype;
        ltype = {} as ILineType;
        curr = scanner.next();
        break;
      default:
        curr = scanner.next();
    }
  }
  ltypes[ltypeName] = ltype;
  return ltypes;
}

function parseViewPortRecords(scanner: DxfScanner): Record<string, unknown>[] {
  const viewPorts: Record<string, unknown>[] = [];
  let viewPort: Record<string, unknown> = {};

  let curr = scanner.next();
  while (!(curr.code === 0 && curr.value === "ENDTAB")) {
    switch (curr.code) {
      case 2:
        viewPort.name = curr.value;
        curr = scanner.next();
        break;
      case 10:
        viewPort.lowerLeftCorner = parsePointInline(scanner, curr);
        curr = scanner.next();
        break;
      case 11:
        viewPort.upperRightCorner = parsePointInline(scanner, curr);
        curr = scanner.next();
        break;
      case 12:
        viewPort.center = parsePointInline(scanner, curr);
        curr = scanner.next();
        break;
      case 45:
        viewPort.viewHeight = curr.value;
        curr = scanner.next();
        break;
      case 330:
        viewPort.ownerHandle = curr.value;
        curr = scanner.next();
        break;
      case 0:
        // Новый VPORT или неизвестное значение — сохраняем и продвигаем сканер
        if (curr.value === "VPORT") {
          viewPorts.push(viewPort);
          viewPort = {};
        }
        curr = scanner.next();
        break;
      default:
        curr = scanner.next();
        break;
    }
  }
  viewPorts.push(viewPort);
  return viewPorts;
}

/** Простой парсинг точки для использования внутри секций (без вызова parsePoint из helpers) */
function parsePointInline(scanner: DxfScanner, curr: IGroup): IPoint {
  const point = {} as IPoint;
  const code = curr.code;
  point.x = curr.value as number;

  const nextY = scanner.next();
  if (nextY.code === code + 10) {
    point.y = nextY.value as number;
    const nextZ = scanner.next();
    if (nextZ.code === code + 20) {
      point.z = nextZ.value as number;
    } else {
      scanner.rewind();
    }
  } else {
    scanner.rewind();
  }
  return point;
}
