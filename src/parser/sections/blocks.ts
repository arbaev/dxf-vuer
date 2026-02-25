// Парсер секции BLOCKS

import type DxfScanner from "../scanner";
import type { IPoint } from "../parseHelpers";
import { parsePointInline } from "../parseHelpers";
import { parseEntities } from "./entities";

export interface IBlock {
  entities: unknown[];
  type?: number;
  ownerHandle?: string;
  xrefPath?: string;
  name?: string;
  name2?: string;
  handle?: string | number;
  layer?: string;
  position?: IPoint;
  paperSpace?: boolean;
}

/**
 * Парсит секцию BLOCKS
 */
export function parseBlocks(scanner: DxfScanner): Record<string, IBlock> {
  const blocks: Record<string, IBlock> = {};
  let lastHandle = 0;
  let curr = scanner.next();

  while (curr.value !== "EOF") {
    if (curr.code === 0 && curr.value === "ENDSEC") break;

    if (curr.code === 0 && curr.value === "BLOCK") {
      const block = parseBlock(scanner);
      curr = scanner.lastReadGroup;
      if (!block.handle) block.handle = lastHandle++;
      if (block.name) {
        blocks[block.name] = block;
      }
    } else {
      curr = scanner.next();
    }
  }

  return blocks;
}

function parseBlock(scanner: DxfScanner): IBlock {
  const block = {} as IBlock;
  let curr = scanner.next();

  while (curr.value !== "EOF") {
    switch (curr.code) {
      case 1:
        block.xrefPath = curr.value as string;
        curr = scanner.next();
        break;
      case 2:
        block.name = curr.value as string;
        curr = scanner.next();
        break;
      case 3:
        block.name2 = curr.value as string;
        curr = scanner.next();
        break;
      case 5:
        block.handle = curr.value as string;
        curr = scanner.next();
        break;
      case 8:
        block.layer = curr.value as string;
        curr = scanner.next();
        break;
      case 10:
        block.position = parsePointInline(scanner, curr);
        curr = scanner.next();
        break;
      case 67:
        block.paperSpace = curr.value === 1;
        curr = scanner.next();
        break;
      case 70:
        if (curr.value !== 0) {
          block.type = curr.value as number;
        }
        curr = scanner.next();
        break;
      case 100:
        curr = scanner.next();
        break;
      case 330:
        block.ownerHandle = curr.value as string;
        curr = scanner.next();
        break;
      case 0:
        if (curr.value === "ENDBLK") break;
        block.entities = parseEntities(scanner, true);
        curr = scanner.lastReadGroup;
        break;
      default:
        curr = scanner.next();
    }

    if (curr.code === 0 && curr.value === "ENDBLK") {
      curr = scanner.next();
      break;
    }
  }

  return block;
}
