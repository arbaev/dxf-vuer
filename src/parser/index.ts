// Главный парсер DXF файлов
// Замена для пакета dxf-parser

import DxfScanner from "./scanner";
import type { DxfData } from "@/types/dxf";
import { parseHeader } from "./sections/header";
import { parseTables } from "./sections/tables";
import { parseBlocks } from "./sections/blocks";
import { parseEntities } from "./sections/entities";

/**
 * Парсит текст DXF файла и возвращает структурированные данные.
 * Полная замена dxf-parser.parseSync()
 */
export function parseDxf(dxfText: string): DxfData {
  const dxf = {} as DxfData;
  const dxfLinesArray = dxfText.split(/\r\n|\r|\n/g);
  const scanner = new DxfScanner(dxfLinesArray);

  if (!scanner.hasNext()) throw new Error("Empty file");

  let curr = scanner.next();

  while (!scanner.isEOF()) {
    if (curr.code === 0 && curr.value === "SECTION") {
      curr = scanner.next();

      if (curr.code !== 2) {
        curr = scanner.next();
        continue;
      }

      if (curr.value === "HEADER") {
        dxf.header = parseHeader(scanner);
        curr = scanner.lastReadGroup;
      } else if (curr.value === "BLOCKS") {
        dxf.blocks = parseBlocks(scanner) as DxfData["blocks"];
        curr = scanner.lastReadGroup;
      } else if (curr.value === "ENTITIES") {
        dxf.entities = parseEntities(scanner, false) as DxfData["entities"];
        curr = scanner.lastReadGroup;
      } else if (curr.value === "TABLES") {
        dxf.tables = parseTables(scanner) as DxfData["tables"];
        curr = scanner.lastReadGroup;
      }
      // Остальные секции (CLASSES, OBJECTS и т.д.) пропускаем
    } else {
      curr = scanner.next();
    }
  }

  // Гарантируем наличие entities
  if (!dxf.entities) dxf.entities = [];

  return dxf;
}
