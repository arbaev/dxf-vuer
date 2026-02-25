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
 * Sections are marked by group codes 300-305:
 *   300 = "CONTEXT_DATA{"
 *   301 = "LEADER{" (leader start)
 *   302 = "LEADER_LINE{" (leader line start)
 *   303 = "START_CONTEXT_DATA" / "END_CONTEXT_DATA"
 *   304 = text content
 *   305 = "}" (section end)
 * Inside LEADER_LINE: code 10/20/30 = vertices
 * Inside LEADER: code 10/20/30 = lastLeaderPoint, code 11/21/31 = doglegVector
 * At top level: code 40 = textHeight, code 41 = arrowSize, code 12/22/32 = textPosition
 */
export function parseMultiLeader(scanner: DxfScanner, curr: IGroup): IMLeaderEntity {
  const entity: IMLeaderEntity = {
    type: "MULTILEADER",
    leaders: [],
    hasArrowHead: true,
  };

  curr = scanner.next();

  let inLeader = false;
  let inLeaderLine = false;
  let currentLeader: IMLeaderBranch | null = null;
  let currentLine: IMLeaderLine | null = null;

  while (!scanner.isEOF()) {
    if (curr.code === 0) break;

    switch (curr.code) {
      case 300:
        break;
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
        break;
      case 304:
        entity.text = curr.value as string;
        break;
      case 305: {
        // "}" -- close the innermost open section
        if (inLeaderLine && currentLine) {
          if (currentLeader && currentLine.vertices.length > 0) {
            currentLeader.lines.push(currentLine);
          }
          currentLine = null;
          inLeaderLine = false;
        } else if (inLeader && currentLeader) {
          if (currentLeader.lines.length > 0) {
            entity.leaders.push(currentLeader);
          }
          currentLeader = null;
          inLeader = false;
        }
        break;
      }

      case 10:
        if (inLeaderLine && currentLine) {
          currentLine.vertices.push(helpers.parsePoint(scanner));
        } else if (inLeader && currentLeader) {
          currentLeader.lastLeaderPoint = helpers.parsePoint(scanner);
        }
        break;
      case 11:
        if (inLeader && currentLeader && !inLeaderLine) {
          currentLeader.doglegVector = helpers.parsePoint(scanner);
        }
        break;
      case 12:
        if (!inLeader) {
          entity.textPosition = helpers.parsePoint(scanner);
        }
        break;

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

      case 100:
        break;
      case 171:
        // 0 = no arrow
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
