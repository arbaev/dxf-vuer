// Парсер MULTILEADER (MLEADER) entity — мультилидер с текстом или блоком

import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import * as helpers from "../parseHelpers";
import type { IPoint, IEntityBase } from "../parseHelpers";

interface IMLeaderLine {
  vertices: IPoint[];
}

interface IMLeaderBranch {
  lines: IMLeaderLine[];
  lastLeaderPoint?: IPoint;
  doglegVector?: IPoint;
  doglegLength?: number;
}

export interface IMLeaderEntity extends IEntityBase {
  type: "MULTILEADER";
  leaders: IMLeaderBranch[];
  text?: string;
  textPosition?: IPoint;
  textHeight?: number;
  arrowSize?: number;
  hasArrowHead?: boolean;
}

/**
 * Парсит MULTILEADER entity.
 * Структура: секции маркируются group codes 300-305:
 *   300 = "CONTEXT_DATA{"
 *   301 = "LEADER{" (начало лидера)
 *   302 = "LEADER_LINE{" (начало линии лидера)
 *   303 = "START_CONTEXT_DATA" / "END_CONTEXT_DATA"
 *   304 = текстовое содержимое
 *   305 = "}" (конец секции)
 * Внутри LEADER_LINE: code 10/20/30 = вершины
 * Внутри LEADER: code 10/20/30 = lastLeaderPoint, code 11/21/31 = doglegVector
 * На верхнем уровне: code 40 = textHeight, code 41 = arrowSize, code 12/22/32 = textPosition
 */
export function parseMultiLeader(scanner: DxfScanner, curr: IGroup): IMLeaderEntity {
  const entity: IMLeaderEntity = {
    type: "MULTILEADER",
    leaders: [],
    hasArrowHead: true,
  };

  curr = scanner.next();

  // Состояние вложенности секций
  let inLeader = false;
  let inLeaderLine = false;
  let currentLeader: IMLeaderBranch | null = null;
  let currentLine: IMLeaderLine | null = null;

  while (!scanner.isEOF()) {
    if (curr.code === 0) break;

    switch (curr.code) {
      // Маркеры секций
      case 300: {
        const val = curr.value as string;
        if (val === "CONTEXT_DATA{") {
          // Начало контекстных данных — ничего специального
        }
        break;
      }
      case 301: {
        const val = curr.value as string;
        if (val === "LEADER{") {
          inLeader = true;
          currentLeader = { lines: [] };
        }
        break;
      }
      case 302: {
        const val = curr.value as string;
        if (val === "LEADER_LINE{") {
          inLeaderLine = true;
          currentLine = { vertices: [] };
        }
        break;
      }
      case 303:
        // START_CONTEXT_DATA / END_CONTEXT_DATA — информационное
        break;
      case 304:
        // Текстовое содержимое
        entity.text = curr.value as string;
        break;
      case 305: {
        // "}" — конец текущей секции
        if (inLeaderLine && currentLine) {
          // Закрываем LEADER_LINE
          if (currentLeader && currentLine.vertices.length > 0) {
            currentLeader.lines.push(currentLine);
          }
          currentLine = null;
          inLeaderLine = false;
        } else if (inLeader && currentLeader) {
          // Закрываем LEADER
          if (currentLeader.lines.length > 0) {
            entity.leaders.push(currentLeader);
          }
          currentLeader = null;
          inLeader = false;
        }
        // Закрытие CONTEXT_DATA — ничего
        break;
      }

      // Координаты
      case 10:
        if (inLeaderLine && currentLine) {
          // Вершина линии лидера
          currentLine.vertices.push(helpers.parsePoint(scanner));
        } else if (inLeader && currentLeader) {
          // Last leader point (точка приземления)
          currentLeader.lastLeaderPoint = helpers.parsePoint(scanner);
        }
        break;
      case 11:
        if (inLeader && currentLeader && !inLeaderLine) {
          // Dogleg vector
          currentLeader.doglegVector = helpers.parsePoint(scanner);
        }
        break;
      case 12:
        if (!inLeader) {
          // Позиция текста (на уровне CONTEXT_DATA)
          entity.textPosition = helpers.parsePoint(scanner);
        }
        break;

      // Размеры
      case 40:
        if (!inLeader) {
          entity.textHeight = curr.value as number;
        } else if (inLeader && currentLeader && !inLeaderLine) {
          currentLeader.doglegLength = curr.value as number;
        }
        break;
      case 41:
        if (!inLeader) {
          entity.arrowSize = curr.value as number;
        }
        break;

      // Флаги
      case 100:
        // Subclass markers — пропускаем
        break;
      case 171:
        // Arrow head flag: 0 = нет стрелки
        entity.hasArrowHead = (curr.value as number) !== 0;
        break;

      default:
        helpers.checkCommonEntityProperties(entity, curr, scanner);
        break;
    }
    curr = scanner.next();
  }

  return entity;
}
