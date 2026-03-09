import * as THREE from "three";
import type { DxfTextEntity, DxfAttdefEntity } from "@/types/dxf";
import { resolveEntityColor } from "@/utils/colorResolver";
import { buildOcsMatrix, transformOcsPoint } from "@/utils/ocsTransform";
import { type RenderContext, degreesToRadians } from "../primitives";
import type { GeometryCollector } from "../mergeCollectors";
import { resolveEntityFont } from "../fontClassifier";
import { replaceSpecialChars, parseTextWithUnderline, parseMTextContent } from "../text";
import {
  addTextToCollector,
  addMTextToCollector,
  HAlign,
  VAlign,
} from "../vectorTextBuilder";

/**
 * Collect TEXT or MTEXT entity as vector glyphs into GeometryCollector.
 * Handles OCS transform and optional world matrix (for block inserts).
 */
export function collectTextOrMText(
  entity: DxfTextEntity,
  colorCtx: RenderContext,
  collector: GeometryCollector,
  layer: string,
  worldMatrix?: THREE.Matrix4,
): void {
  const font = resolveEntityFont(entity.textStyle, colorCtx.styles, colorCtx.serifFont, colorCtx.font!);
  const entityColor = resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);
  const textContent = entity.text;
  if (!textContent) return;

  if (entity.type === "TEXT") {
    const textHeight = entity.height || entity.textHeight || colorCtx.defaultTextHeight;
    const ocsMatrix = buildOcsMatrix(entity.extrusionDirection);

    // Use endPoint for justified text, startPoint for LEFT/BASELINE
    const hasJustification =
      (entity.halign && entity.halign > 0) || (entity.valign && entity.valign > 0);
    const posCoord = hasJustification && entity.endPoint
      ? entity.endPoint
      : entity.position || entity.startPoint;
    if (!posCoord) return;

    let pos = transformOcsPoint(
      new THREE.Vector3(posCoord.x, posCoord.y, posCoord.z || 0),
      ocsMatrix,
    );
    let rotation = entity.rotation ? degreesToRadians(entity.rotation) : 0;
    let height = textHeight;

    // endPoint for FIT/ALIGNED modes
    let endX: number | undefined;
    let endY: number | undefined;
    if (entity.endPoint && entity.startPoint) {
      const ep = transformOcsPoint(
        new THREE.Vector3(entity.endPoint.x, entity.endPoint.y, entity.endPoint.z || 0),
        ocsMatrix,
      );
      const sp = transformOcsPoint(
        new THREE.Vector3(entity.startPoint.x, entity.startPoint.y, entity.startPoint.z || 0),
        ocsMatrix,
      );
      // For FIT/ALIGNED, addTextToCollector uses startPoint as posX/posY
      if (entity.halign === HAlign.FIT || entity.halign === HAlign.ALIGNED) {
        pos = sp;
        endX = ep.x;
        endY = ep.y;
      }
    }

    let mirrorWidthFactor = 1;
    if (worldMatrix) {
      pos.applyMatrix4(worldMatrix);
      if (endX !== undefined && endY !== undefined) {
        const ep = new THREE.Vector3(endX, endY, 0).applyMatrix4(worldMatrix);
        endX = ep.x;
        endY = ep.y;
      }
      const m = worldMatrix.elements;
      const det2x2 = m[0] * m[5] - m[1] * m[4];
      const isMirrored = det2x2 < 0;
      // When mirrored, negate direction to extract correct rotation without flip
      rotation += isMirrored
        ? Math.atan2(-m[1], -m[0])
        : Math.atan2(m[1], m[0]);
      height *= Math.sqrt(m[4] * m[4] + m[5] * m[5]);
      // $MIRRTEXT=1: mirror text with geometry; default (0): keep text readable
      if (isMirrored && colorCtx.mirrText) {
        mirrorWidthFactor = -1;
      }
    }

    const parsed = parseTextWithUnderline(textContent);
    addTextToCollector({
      collector, layer, color: entityColor, font,
      text: parsed.text, height,
      posX: pos.x, posY: pos.y, posZ: pos.z, rotation,
      hAlign: entity.halign ?? HAlign.LEFT,
      vAlign: entity.valign ?? VAlign.BASELINE,
      widthFactor: (entity.xScale ?? 1) * mirrorWidthFactor,
      endPosX: endX, endPosY: endY,
      underline: parsed.underline,
    });

  } else {
    // MTEXT
    const defaultHeight = entity.height || entity.textHeight || colorCtx.defaultTextHeight;
    const ocsMatrix = buildOcsMatrix(entity.extrusionDirection);
    const textPosition = entity.position || entity.startPoint;
    if (!textPosition) return;

    let pos = transformOcsPoint(
      new THREE.Vector3(textPosition.x, textPosition.y, textPosition.z || 0),
      ocsMatrix,
    );
    let rotation = entity.rotation ? degreesToRadians(entity.rotation) : 0;
    if (!entity.rotation && entity.directionVector) {
      rotation = Math.atan2(entity.directionVector.y, entity.directionVector.x);
    }
    let height = defaultHeight;

    if (worldMatrix) {
      pos.applyMatrix4(worldMatrix);
      const m = worldMatrix.elements;
      const det2x2 = m[0] * m[5] - m[1] * m[4];
      const isMirrored = det2x2 < 0;
      rotation += isMirrored
        ? Math.atan2(-m[1], -m[0])
        : Math.atan2(m[1], m[0]);
      height *= Math.sqrt(m[4] * m[4] + m[5] * m[5]);
    }

    const lines = parseMTextContent(textContent, height);
    addMTextToCollector({
      collector, layer, color: entityColor, font, lines, defaultHeight: height,
      posX: pos.x, posY: pos.y, posZ: pos.z, rotation,
      attachmentPoint: entity.attachmentPoint,
      // Skip word wrapping when width (code 41) is narrower than one character
      // (width < text height) — wrapping would put every character on its own line
      width: entity.width && entity.width >= height ? entity.width : undefined,
      serifFont: colorCtx.serifFont,
      lineSpacingFactor: entity.lineSpacingFactor,
    });

  }
}

/**
 * Collect ATTDEF entity as visible text into GeometryCollector.
 * AutoCAD displays ATTDEF tag (code 2) in model space when default value (code 1) is empty.
 */
export function collectAttdefEntity(
  entity: DxfAttdefEntity,
  colorCtx: RenderContext,
  collector: GeometryCollector,
  layer: string,
): void {
  if (entity.invisible) return;
  const text = entity.text || entity.tag;
  if (!text) return;
  const posCoord = entity.startPoint;
  if (!posCoord) return;

  const entityColor = resolveEntityColor(entity, colorCtx.layers, colorCtx.blockColor, colorCtx.darkTheme);
  const textHeight = entity.textHeight || colorCtx.defaultTextHeight;
  const ocsMatrix = buildOcsMatrix(entity.extrusionDirection);
  const pos = transformOcsPoint(
    new THREE.Vector3(posCoord.x, posCoord.y, posCoord.z || 0),
    ocsMatrix,
  );
  const rotation = entity.rotation ? degreesToRadians(entity.rotation) : 0;
  const font = resolveEntityFont(entity.textStyle, colorCtx.styles, colorCtx.serifFont, colorCtx.font!);

  addTextToCollector({
    collector, layer, color: entityColor, font,
    text: replaceSpecialChars(text), height: textHeight,
    posX: pos.x, posY: pos.y, posZ: pos.z, rotation,
    hAlign: entity.horizontalJustification ?? HAlign.LEFT,
    vAlign: entity.verticalJustification ?? VAlign.BASELINE,
    widthFactor: entity.scale,
    obliqueAngle: entity.obliqueAngle,
  });
}
