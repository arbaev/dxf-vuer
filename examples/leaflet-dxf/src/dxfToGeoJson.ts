import {
  isLineEntity,
  isCircleEntity,
  isArcEntity,
  isPolylineEntity,
  isEllipseEntity,
  isPointEntity,
  isTextEntity,
  isInsertEntity,
  isSolidEntity,
  is3DFaceEntity,
} from "dxf-render/parser";
import type {
  DxfData,
  DxfEntity,
  DxfLayer,
  DxfVertex,
  DxfBlock,
} from "dxf-render/parser";

// Simplified ACI palette (first 10 standard colors)
const ACI_COLORS: Record<number, string> = {
  1: "#ff0000", 2: "#ffff00", 3: "#00ff00", 4: "#00ffff",
  5: "#0000ff", 6: "#ff00ff", 7: "#000000", 8: "#808080",
  9: "#c0c0c0",
};

type GeoJsonGeometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "Polygon"; coordinates: [number, number][][] };

interface GeoJsonFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: GeoJsonGeometry;
}

interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

function coord(v: DxfVertex): [number, number] {
  return [v.x, v.y];
}

function resolveColor(
  entity: DxfEntity,
  layers: Record<string, DxfLayer>,
): string {
  const ci = entity.colorIndex;

  // trueColor (code 420)
  if (entity.color !== undefined) {
    return "#" + (entity.color & 0xffffff).toString(16).padStart(6, "0");
  }

  // ACI color
  if (ci !== undefined && ci >= 1 && ci <= 255) {
    return ACI_COLORS[ci] ?? "#000000";
  }

  // ByLayer
  const layerName = entity.layer;
  if (layerName && layers[layerName]) {
    const layer = layers[layerName];
    if (layer.color !== undefined && layer.color !== 0) {
      return "#" + (layer.color & 0xffffff).toString(16).padStart(6, "0");
    }
    if (layer.colorIndex >= 1 && layer.colorIndex <= 255) {
      return ACI_COLORS[layer.colorIndex] ?? "#000000";
    }
  }

  return "#000000";
}

/**
 * Interpolate bulge arc between two points.
 * bulge = tan(included_angle / 4); positive = CCW arc.
 */
function interpolateBulge(
  p1: DxfVertex,
  p2: DxfVertex,
  bulge: number,
  segments = 16,
): [number, number][] {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const chord = Math.sqrt(dx * dx + dy * dy);
  if (chord < 1e-10) return [coord(p1)];

  const theta = 4 * Math.atan(Math.abs(bulge));
  const radius = chord / (2 * Math.sin(theta / 2));

  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const d = radius * Math.cos(theta / 2);

  const nx = -dy / chord;
  const ny = dx / chord;

  const sign = bulge > 0 ? 1 : -1;
  const cx = mx + sign * d * nx;
  const cy = my + sign * d * ny;

  const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
  let endAngle = Math.atan2(p2.y - cy, p2.x - cx);

  if (bulge > 0) {
    while (endAngle <= startAngle) endAngle += 2 * Math.PI;
  } else {
    while (endAngle >= startAngle) endAngle -= 2 * Math.PI;
  }

  const points: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = startAngle + t * (endAngle - startAngle);
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
}

function generateArcPoints(
  cx: number,
  cy: number,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
  segments = 32,
): [number, number][] {
  const startRad = (startAngleDeg * Math.PI) / 180;
  let endRad = (endAngleDeg * Math.PI) / 180;
  if (endRad <= startRad) endRad += 2 * Math.PI;

  const points: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = startRad + t * (endRad - startRad);
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
}

function generateCirclePoints(
  cx: number,
  cy: number,
  radius: number,
  segments = 64,
): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
}

function generateEllipsePoints(
  cx: number,
  cy: number,
  majorX: number,
  majorY: number,
  axisRatio: number,
  startAngle: number,
  endAngle: number,
  segments = 64,
): [number, number][] {
  const majorLen = Math.sqrt(majorX * majorX + majorY * majorY);
  const minorLen = majorLen * axisRatio;
  const rotation = Math.atan2(majorY, majorX);

  let sweep = endAngle - startAngle;
  if (sweep <= 0) sweep += 2 * Math.PI;

  const points: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = startAngle + (i / segments) * sweep;
    const ex = majorLen * Math.cos(t);
    const ey = minorLen * Math.sin(t);
    const rx = ex * Math.cos(rotation) - ey * Math.sin(rotation);
    const ry = ex * Math.sin(rotation) + ey * Math.cos(rotation);
    points.push([cx + rx, cy + ry]);
  }
  return points;
}

type Transform = { dx: number; dy: number; rotation: number; sx: number; sy: number };

function applyTf(pt: [number, number], tf?: Transform): [number, number] {
  if (!tf) return pt;
  const [x, y] = pt;
  const cos = Math.cos(tf.rotation);
  const sin = Math.sin(tf.rotation);
  return [
    tf.dx + (x * cos - y * sin) * tf.sx,
    tf.dy + (x * sin + y * cos) * tf.sy,
  ];
}

function convertEntity(
  entity: DxfEntity,
  layers: Record<string, DxfLayer>,
  blocks: Record<string, DxfBlock> | undefined,
  features: GeoJsonFeature[],
  tf?: Transform,
): void {
  const color = resolveColor(entity, layers);
  const props: Record<string, unknown> = {
    type: entity.type,
    layer: entity.layer ?? "0",
    color,
  };

  const push = (geometry: GeoJsonGeometry) => {
    features.push({ type: "Feature", properties: props, geometry });
  };

  if (isLineEntity(entity)) {
    const coords = entity.vertices.map((v) => applyTf(coord(v), tf));
    push({ type: "LineString", coordinates: coords });
    return;
  }

  if (isPolylineEntity(entity)) {
    const coords: [number, number][] = [];
    const verts = entity.vertices;
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i];
      const bulge = v.bulge;
      if (bulge && Math.abs(bulge) > 1e-6 && i < verts.length - 1) {
        const pts = interpolateBulge(v, verts[i + 1], bulge);
        for (let j = 0; j < pts.length - 1; j++) {
          coords.push(applyTf(pts[j], tf));
        }
      } else {
        coords.push(applyTf(coord(v), tf));
      }
    }
    if (entity.shape && coords.length > 1) {
      const last = verts[verts.length - 1];
      if (last.bulge && Math.abs(last.bulge) > 1e-6) {
        const pts = interpolateBulge(last, verts[0], last.bulge);
        for (let j = 0; j < pts.length - 1; j++) {
          coords.push(applyTf(pts[j], tf));
        }
      }
      coords.push(coords[0]);
    }
    if (coords.length >= 2) {
      push({ type: "LineString", coordinates: coords });
    }
    return;
  }

  if (isCircleEntity(entity)) {
    const pts = generateCirclePoints(
      entity.center.x, entity.center.y, entity.radius,
    ).map((p) => applyTf(p, tf));
    push({ type: "Polygon", coordinates: [pts] });
    return;
  }

  if (isArcEntity(entity)) {
    const pts = generateArcPoints(
      entity.center.x, entity.center.y, entity.radius,
      entity.startAngle, entity.endAngle,
    ).map((p) => applyTf(p, tf));
    push({ type: "LineString", coordinates: pts });
    return;
  }

  if (isEllipseEntity(entity)) {
    const pts = generateEllipsePoints(
      entity.center.x, entity.center.y,
      entity.majorAxisEndPoint.x, entity.majorAxisEndPoint.y,
      entity.axisRatio,
      entity.startAngle, entity.endAngle,
    ).map((p) => applyTf(p, tf));
    const isFullEllipse = Math.abs(entity.endAngle - entity.startAngle - 2 * Math.PI) < 0.01;
    if (isFullEllipse) {
      push({ type: "Polygon", coordinates: [pts] });
    } else {
      push({ type: "LineString", coordinates: pts });
    }
    return;
  }

  if (isPointEntity(entity)) {
    push({
      type: "Point",
      coordinates: applyTf(coord(entity.position), tf),
    });
    return;
  }

  if (isTextEntity(entity)) {
    const pos = entity.position ?? entity.startPoint;
    if (pos) {
      props.text = entity.text;
      props.height = entity.height ?? entity.textHeight;
      push({
        type: "Point",
        coordinates: applyTf(coord(pos), tf),
      });
    }
    return;
  }

  if (isSolidEntity(entity)) {
    const pts = entity.points.map((v) => applyTf(coord(v), tf));
    if (pts.length >= 3) {
      pts.push(pts[0]);
      push({ type: "Polygon", coordinates: [pts] });
    }
    return;
  }

  if (is3DFaceEntity(entity)) {
    const pts = entity.vertices.map((v) => applyTf(coord(v), tf));
    if (pts.length >= 3) {
      pts.push(pts[0]);
      push({ type: "Polygon", coordinates: [pts] });
    }
    return;
  }

  if (isInsertEntity(entity)) {
    const block = blocks?.[entity.name];
    if (!block) return;
    const rotRad = ((entity.rotation ?? 0) * Math.PI) / 180;
    const parentTf = tf ?? { dx: 0, dy: 0, rotation: 0, sx: 1, sy: 1 };
    const newTf: Transform = {
      dx: parentTf.dx + entity.position.x * parentTf.sx,
      dy: parentTf.dy + entity.position.y * parentTf.sy,
      rotation: parentTf.rotation + rotRad,
      sx: parentTf.sx * (entity.xScale ?? 1),
      sy: parentTf.sy * (entity.yScale ?? 1),
    };
    for (const blockEntity of block.entities) {
      convertEntity(blockEntity, layers, blocks, features, newTf);
    }
    return;
  }
}

/**
 * Convert parsed DXF data to GeoJSON FeatureCollection.
 * Uses CRS.Simple coordinates (DXF units as-is, Y is up).
 */
export function dxfToGeoJson(dxf: DxfData): GeoJsonFeatureCollection {
  const layers = dxf.tables?.layer?.layers ?? {};
  const features: GeoJsonFeature[] = [];

  for (const entity of dxf.entities) {
    if (entity.inPaperSpace) continue;
    if (entity.visible === false) continue;
    const layerName = entity.layer;
    if (layerName && layers[layerName]?.frozen) continue;

    convertEntity(entity, layers, dxf.blocks, features);
  }

  return { type: "FeatureCollection", features };
}
