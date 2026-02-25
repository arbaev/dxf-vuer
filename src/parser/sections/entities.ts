import type DxfScanner from "../scanner";
import type { IGroup } from "../scanner";
import type { IEntityBase } from "../parseHelpers";

import { parseLine } from "../entities/line";
import { parseCircle } from "../entities/circle";
import { parseArc } from "../entities/arc";
import { parsePoint } from "../entities/point";
import { parseEllipse } from "../entities/ellipse";
import { parseSolid } from "../entities/solid";
import { parse3DFace } from "../entities/3dface";
import { parseText } from "../entities/text";
import { parseMText } from "../entities/mtext";
import { parseAttdef } from "../entities/attdef";
import { parseInsert } from "../entities/insert";
import { parseDimension } from "../entities/dimension";
import { parseSpline } from "../entities/spline";
import { parsePolyline } from "../entities/polyline";
import { parseLWPolyline } from "../entities/lwpolyline";
import { parseHatch } from "../entities/hatch";
import { parseLeader } from "../entities/leader";
import { parseMultiLeader } from "../entities/multileader";
import { parseViewport } from "../entities/viewport";
import { parseImage } from "../entities/image";
import { parseWipeout } from "../entities/wipeout";

type EntityHandler = (scanner: DxfScanner, curr: IGroup) => IEntityBase;

const entityHandlers: Record<string, EntityHandler> = {
  LINE: parseLine,
  CIRCLE: parseCircle,
  ARC: parseArc,
  POINT: parsePoint,
  ELLIPSE: parseEllipse,
  SOLID: parseSolid,
  "3DFACE": parse3DFace,
  TEXT: parseText,
  MTEXT: parseMText,
  ATTDEF: parseAttdef,
  INSERT: parseInsert,
  DIMENSION: parseDimension,
  SPLINE: parseSpline,
  POLYLINE: parsePolyline,
  LWPOLYLINE: parseLWPolyline,
  HATCH: parseHatch,
  LEADER: parseLeader,
  MULTILEADER: parseMultiLeader,
  MLEADER: parseMultiLeader,
  VIEWPORT: parseViewport,
  IMAGE: parseImage,
  WIPEOUT: parseWipeout,
};

/**
 * @param forBlock -- true when parsing block contents (stops at ENDBLK instead of ENDSEC)
 */
export function parseEntities(
  scanner: DxfScanner,
  forBlock: boolean,
): IEntityBase[] {
  const entities: IEntityBase[] = [];
  const endingOnValue = forBlock ? "ENDBLK" : "ENDSEC";
  let lastHandle = 0;

  let curr: IGroup;
  if (!forBlock) {
    curr = scanner.next();
  } else {
    curr = scanner.lastReadGroup;
  }

  while (!scanner.isEOF()) {
    if (curr.code === 0) {
      if (curr.value === endingOnValue) {
        break;
      }

      const handler = entityHandlers[curr.value as string];
      if (handler) {
        try {
          const entity = handler(scanner, curr);
          curr = scanner.lastReadGroup;
          if (!entity.handle) entity.handle = lastHandle++;
          entities.push(entity);
        } catch (error) {
          console.warn(
            `Failed to parse entity "${curr.value}":`,
            error instanceof Error ? error.message : error,
          );
          // Skip damaged entity -- advance to next code 0
          curr = scanner.lastReadGroup;
          while (!scanner.isEOF() && curr.code !== 0) {
            curr = scanner.next();
          }
        }
      } else {
        curr = scanner.next();
        continue;
      }
    } else {
      curr = scanner.next();
    }
  }

  if (endingOnValue === "ENDSEC") {
    curr = scanner.next();
  }

  return entities;
}
