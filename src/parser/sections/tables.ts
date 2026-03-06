import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import { getAcadColor, parsePointInline } from "../parseHelpers";

export interface ILayer {
  name: string;
  visible: boolean;
  colorIndex: number;
  color: number;
  frozen: boolean;
  locked?: boolean;
  lineType?: string;
}

export interface ILineType {
  name: string;
  description: string;
  pattern: number[];
  patternLength: number;
}

export interface IStyle {
  name: string;
  fontFile?: string;
  bigFont?: string;
  fixedHeight?: number;
  widthFactor?: number;
}

export interface IBlockRecord {
  name: string;
  units: number; // INSUNITS code (0=Unitless, 1=Inches, 4=mm, 6=Meters, ...)
  handle?: string; // code 5: entity handle (used for DIMBLK resolution)
}

export interface IDimStyle {
  name: string;
  dimscale?: number; // code 40: overall dimension scale factor
  dimasz?: number;   // code 41: arrow size (unscaled)
  dimtxt?: number;   // code 140: text height (unscaled)
  dimtsz?: number;   // code 142: tick size (>0 = use ticks instead of arrows)
  dimclrt?: number;  // code 178: dimension text color (ACI index)
  dimlunit?: number; // code 277: 2=Decimal, 4=Architectural
  dimzin?: number;   // code 78: zero suppression flags
  dimblkHandle?: string; // code 342: handle of dimension arrow block (→ BLOCK_RECORD name)
  dimldrblkHandle?: string; // code 341: handle of leader arrow block (→ BLOCK_RECORD name)
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
    STYLE: {
      tableRecordsProperty: "styles",
      tableName: "style",
      dxfSymbolName: "STYLE",
      parseTableRecords: () => parseStyles(scanner),
    },
    BLOCK_RECORD: {
      tableRecordsProperty: "blockRecords",
      tableName: "blockRecord",
      dxfSymbolName: "BLOCK_RECORD",
      parseTableRecords: () => parseBlockRecords(scanner),
    },
    DIMSTYLE: {
      tableRecordsProperty: "dimStyles",
      tableName: "dimStyle",
      dxfSymbolName: "DIMSTYLE",
      parseTableRecords: () => parseDimStyles(scanner),
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
      } else {
        // Skip unknown tables until ENDTAB
        while (!scanner.isEOF()) {
          curr = scanner.next();
          if (curr.code === 0 && curr.value === "ENDTAB") break;
        }
        curr = scanner.next();
      }
    } else {
      curr = scanner.next();
    }
  }

  curr = scanner.next();
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
  curr = scanner.next();
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
      case 6:
        layer.lineType = curr.value as string;
        curr = scanner.next();
        break;
      case 62:
        // Negative colorIndex means layer is off (invisible) in AutoCAD
        layer.visible = (curr.value as number) >= 0;
        layer.colorIndex = Math.abs(curr.value as number);
        layer.color = getAcadColor(layer.colorIndex);
        curr = scanner.next();
        break;
      case 70: {
        // Bits 1 and 2: frozen and frozen by default in new viewports
        const flags = curr.value as number;
        layer.frozen = (flags & 1) !== 0 || (flags & 2) !== 0;
        // Bit 4 (0x04): locked
        layer.locked = (flags & 4) !== 0;
        curr = scanner.next();
        break;
      }
      case 0:
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
  // Don't call scanner.next() -- parseTable() will handle ENDTAB itself
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
        ltype.pattern.push(curr.value as number);
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

function parseStyles(scanner: DxfScanner): Record<string, IStyle> {
  const styles: Record<string, IStyle> = {};
  let style = {} as IStyle;
  let styleName = "";

  let curr = scanner.next();
  while (!(curr.code === 0 && curr.value === "ENDTAB")) {
    switch (curr.code) {
      case 2:
        style.name = curr.value as string;
        styleName = curr.value as string;
        curr = scanner.next();
        break;
      case 3:
        style.fontFile = curr.value as string;
        curr = scanner.next();
        break;
      case 4:
        style.bigFont = curr.value as string;
        curr = scanner.next();
        break;
      case 40:
        style.fixedHeight = curr.value as number;
        curr = scanner.next();
        break;
      case 41:
        style.widthFactor = curr.value as number;
        curr = scanner.next();
        break;
      case 0:
        if (curr.value === "STYLE") {
          if (styleName) styles[styleName] = style;
          style = {} as IStyle;
          styleName = "";
        }
        curr = scanner.next();
        break;
      default:
        curr = scanner.next();
        break;
    }
  }
  if (styleName) styles[styleName] = style;
  return styles;
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

function parseBlockRecords(scanner: DxfScanner): Record<string, IBlockRecord> {
  const records: Record<string, IBlockRecord> = {};
  let rec = {} as IBlockRecord;
  let recName = "";

  let curr = scanner.next();
  while (!(curr.code === 0 && curr.value === "ENDTAB")) {
    switch (curr.code) {
      case 2:
        rec.name = curr.value as string;
        recName = curr.value as string;
        curr = scanner.next();
        break;
      case 5:
        rec.handle = curr.value as string;
        curr = scanner.next();
        break;
      case 70:
        rec.units = curr.value as number;
        curr = scanner.next();
        break;
      case 0:
        if (curr.value === "BLOCK_RECORD") {
          if (recName) records[recName] = rec;
          rec = {} as IBlockRecord;
          recName = "";
        }
        curr = scanner.next();
        break;
      default:
        curr = scanner.next();
        break;
    }
  }
  if (recName) records[recName] = rec;
  return records;
}

function parseDimStyles(scanner: DxfScanner): Record<string, IDimStyle> {
  const dimStyles: Record<string, IDimStyle> = {};
  let ds = {} as IDimStyle;
  let dsName = "";

  let curr = scanner.next();
  while (!(curr.code === 0 && curr.value === "ENDTAB")) {
    switch (curr.code) {
      case 2:
        ds.name = curr.value as string;
        dsName = curr.value as string;
        curr = scanner.next();
        break;
      case 40:
        ds.dimscale = curr.value as number;
        curr = scanner.next();
        break;
      case 41:
        ds.dimasz = curr.value as number;
        curr = scanner.next();
        break;
      case 78:
        ds.dimzin = curr.value as number;
        curr = scanner.next();
        break;
      case 140:
        ds.dimtxt = curr.value as number;
        curr = scanner.next();
        break;
      case 142:
        ds.dimtsz = curr.value as number;
        curr = scanner.next();
        break;
      case 178:
        ds.dimclrt = curr.value as number;
        curr = scanner.next();
        break;
      case 277:
        ds.dimlunit = curr.value as number;
        curr = scanner.next();
        break;
      case 341:
        ds.dimldrblkHandle = curr.value as string;
        curr = scanner.next();
        break;
      case 342:
        ds.dimblkHandle = curr.value as string;
        curr = scanner.next();
        break;
      case 0:
        if (curr.value === "DIMSTYLE") {
          if (dsName) dimStyles[dsName] = ds;
          ds = {} as IDimStyle;
          dsName = "";
        }
        curr = scanner.next();
        break;
      default:
        curr = scanner.next();
        break;
    }
  }
  if (dsName) dimStyles[dsName] = ds;
  return dimStyles;
}
