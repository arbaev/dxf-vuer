import { describe, it, expect } from "vitest";
import * as THREE from "three";
import type { DxfEntity } from "@/types/dxf";
import { GeometryCollector } from "../mergeCollectors";
import type { RenderContext } from "../primitives";
import { MaterialCacheStore } from "../materialCache";
import {
  type CollectEntityParams,
  transformFlatVertices,
  buildBlockTemplate,
  instantiateBlockTemplate,
  INHERIT_LAYER,
  BYBLOCK_COLOR,
} from "../blockTemplateCache";

// ─── transformFlatVertices ───────────────────────────────────────────

describe("transformFlatVertices", () => {
  it("identity matrix returns same coordinates", () => {
    const identity = new THREE.Matrix4().identity().elements;
    const src = [1, 2, 3, 4, 5, 6];
    const dst = transformFlatVertices(src, identity);
    expect(dst).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("applies translation", () => {
    const mat = new THREE.Matrix4().makeTranslation(10, 20, 30).elements;
    const src = [0, 0, 0, 1, 1, 1];
    const dst = transformFlatVertices(src, mat);
    expect(dst[0]).toBeCloseTo(10);
    expect(dst[1]).toBeCloseTo(20);
    expect(dst[2]).toBeCloseTo(30);
    expect(dst[3]).toBeCloseTo(11);
    expect(dst[4]).toBeCloseTo(21);
    expect(dst[5]).toBeCloseTo(31);
  });

  it("applies scale", () => {
    const mat = new THREE.Matrix4().makeScale(2, 3, 1).elements;
    const src = [5, 10, 0];
    const dst = transformFlatVertices(src, mat);
    expect(dst[0]).toBeCloseTo(10);
    expect(dst[1]).toBeCloseTo(30);
    expect(dst[2]).toBeCloseTo(0);
  });

  it("applies 90° rotation around Z", () => {
    const mat = new THREE.Matrix4().makeRotationZ(Math.PI / 2).elements;
    const src = [1, 0, 0];
    const dst = transformFlatVertices(src, mat);
    expect(dst[0]).toBeCloseTo(0);
    expect(dst[1]).toBeCloseTo(1);
    expect(dst[2]).toBeCloseTo(0);
  });

  it("handles empty array", () => {
    const mat = new THREE.Matrix4().identity().elements;
    expect(transformFlatVertices([], mat)).toEqual([]);
  });

  it("matches THREE.Vector3.applyMatrix4", () => {
    const mat = new THREE.Matrix4().compose(
      new THREE.Vector3(5, -3, 1),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.7),
      new THREE.Vector3(1.5, 2, 1),
    );
    const src = [3.5, -1.2, 0.8];
    const dst = transformFlatVertices(src, mat.elements);

    const v = new THREE.Vector3(3.5, -1.2, 0.8).applyMatrix4(mat);
    expect(dst[0]).toBeCloseTo(v.x, 10);
    expect(dst[1]).toBeCloseTo(v.y, 10);
    expect(dst[2]).toBeCloseTo(v.z, 10);
  });
});

// ─── buildBlockTemplate ─────────────────────────────────────────────

describe("buildBlockTemplate", () => {
  const makeColorCtx = (): RenderContext => ({
    layers: {},
    materials: new MaterialCacheStore(),
    lineTypes: {},
    globalLtScale: 1,
    headerLtScale: 1,
    defaultTextHeight: 16,
  });

  // Simple collectEntityFn stub: pushes a line segment from (0,0,0)→(1,0,0) for LINE
  const stubCollect = (p: CollectEntityParams): boolean => {
    if (p.entity.type === "LINE") {
      const color = p.overrideColor ?? "#ffffff";
      p.collector.addLineSegments(p.layer, color, [0, 0, 0, 1, 0, 0]);
      return true;
    }
    if (p.entity.type === "CIRCLE") {
      const color = p.overrideColor ?? "#ffffff";
      p.collector.addLineSegments(p.layer, color, [1, 0, 0, 0, 1, 0, 0, 1, 0, -1, 0, 0]);
      return true;
    }
    return false;
  };

  it("caches LINE entities into buckets", () => {
    const entities: DxfEntity[] = [
      { type: "LINE", layer: "WALLS", colorIndex: 1 } as DxfEntity,
      { type: "LINE", layer: "WALLS", colorIndex: 1 } as DxfEntity,
    ];

    const template = buildBlockTemplate("TEST", entities, makeColorCtx(), stubCollect);

    expect(template.name).toBe("TEST");
    expect(template.fallbackEntityIndices).toEqual([]);
    expect(template.buckets.size).toBe(1);
  });

  it("puts TEXT and DIMENSION entities into fallback", () => {
    const entities: DxfEntity[] = [
      { type: "LINE", layer: "0" } as DxfEntity,
      { type: "TEXT", layer: "0" } as DxfEntity,
      { type: "DIMENSION", layer: "0" } as DxfEntity,
      { type: "CIRCLE", layer: "0" } as DxfEntity,
    ];

    const template = buildBlockTemplate("TEST", entities, makeColorCtx(), stubCollect);

    // TEXT (index 1) and DIMENSION (index 2) → fallback
    expect(template.fallbackEntityIndices).toEqual([1, 2]);
    // LINE (index 0) and CIRCLE (index 3) → cached
    expect(template.buckets.size).toBe(1);
  });

  it("puts nested INSERT entities into fallback", () => {
    const entities: DxfEntity[] = [
      { type: "LINE", layer: "0" } as DxfEntity,
      { type: "INSERT", layer: "0", name: "NESTED" } as DxfEntity,
    ];

    const template = buildBlockTemplate("TEST", entities, makeColorCtx(), stubCollect);

    expect(template.fallbackEntityIndices).toEqual([1]);
  });

  it("uses INHERIT_LAYER sentinel for layer-0 entities", () => {
    const entities: DxfEntity[] = [
      { type: "LINE", layer: "0", colorIndex: 1 } as DxfEntity,
    ];

    const template = buildBlockTemplate("TEST", entities, makeColorCtx(), stubCollect);

    const keys = [...template.buckets.keys()];
    expect(keys.length).toBe(1);
    // Key should contain INHERIT_LAYER sentinel
    expect(keys[0].startsWith(INHERIT_LAYER)).toBe(true);
  });

  it("uses BYBLOCK_COLOR sentinel for ByBlock-colored entities", () => {
    const entities: DxfEntity[] = [
      { type: "LINE", layer: "WALLS", colorIndex: 0 } as DxfEntity,
    ];

    const template = buildBlockTemplate("TEST", entities, makeColorCtx(), stubCollect);

    const keys = [...template.buckets.keys()];
    expect(keys.length).toBe(1);
    // Key should contain BYBLOCK_COLOR sentinel
    expect(keys[0].includes(BYBLOCK_COLOR)).toBe(true);
  });

  it("puts ByBlock linetype entities into fallback", () => {
    const entities: DxfEntity[] = [
      { type: "LINE", layer: "0", lineType: "BYBLOCK" } as DxfEntity,
    ];

    const template = buildBlockTemplate("TEST", entities, makeColorCtx(), stubCollect);

    expect(template.fallbackEntityIndices).toEqual([0]);
  });

  it("handles entities that collectEntityFn cannot process", () => {
    const failCollect = () => false;
    const entities: DxfEntity[] = [
      { type: "HATCH", layer: "0" } as DxfEntity,
    ];

    const template = buildBlockTemplate("TEST", entities, makeColorCtx(), failCollect);

    expect(template.fallbackEntityIndices).toEqual([0]);
    expect(template.buckets.size).toBe(0);
  });
});

// ─── instantiateBlockTemplate ────────────────────────────────────────

describe("instantiateBlockTemplate", () => {
  it("transforms line segments by world matrix", () => {
    const template = {
      name: "TEST",
      buckets: new Map([
        ["WALLS::#ff0000", {
          lineSegments: [0, 0, 0, 1, 0, 0],
          points: [],
          linetypeDots: [],
          meshVertices: [],
          meshIndices: [],
        }],
      ]),
      fallbackEntityIndices: [],
    };

    const collector = new GeometryCollector();
    const worldMatrix = new THREE.Matrix4().makeTranslation(10, 20, 0);

    instantiateBlockTemplate(template, collector, "IGNORED", "#000000", worldMatrix);

    const raw = collector.lineSegments.get("WALLS::#ff0000");
    expect(raw).toBeDefined();
    const data = raw!.toArray();
    expect(data.length).toBe(6);
    expect(data[0]).toBeCloseTo(10);
    expect(data[1]).toBeCloseTo(20);
    expect(data[3]).toBeCloseTo(11);
    expect(data[4]).toBeCloseTo(20);
  });

  it("resolves INHERIT_LAYER sentinel to insertLayer", () => {
    const template = {
      name: "TEST",
      buckets: new Map([
        [`${INHERIT_LAYER}::#ff0000`, {
          lineSegments: [0, 0, 0, 1, 0, 0],
          points: [],
          linetypeDots: [],
          meshVertices: [],
          meshIndices: [],
        }],
      ]),
      fallbackEntityIndices: [],
    };

    const collector = new GeometryCollector();
    const worldMatrix = new THREE.Matrix4().identity();

    instantiateBlockTemplate(template, collector, "MY_LAYER", "#000000", worldMatrix);

    // Data should be stored under "MY_LAYER::#ff0000", not INHERIT_LAYER
    expect(collector.lineSegments.has("MY_LAYER::#ff0000")).toBe(true);
    expect(collector.lineSegments.has(`${INHERIT_LAYER}::#ff0000`)).toBe(false);
  });

  it("resolves BYBLOCK_COLOR sentinel to insertColor", () => {
    const template = {
      name: "TEST",
      buckets: new Map([
        [`WALLS::${BYBLOCK_COLOR}`, {
          lineSegments: [0, 0, 0, 1, 0, 0],
          points: [],
          linetypeDots: [],
          meshVertices: [],
          meshIndices: [],
        }],
      ]),
      fallbackEntityIndices: [],
    };

    const collector = new GeometryCollector();
    const worldMatrix = new THREE.Matrix4().identity();

    instantiateBlockTemplate(template, collector, "WALLS", "#00ff00", worldMatrix);

    // Data should use insertColor #00ff00 instead of BYBLOCK_COLOR
    expect(collector.lineSegments.has("WALLS::#00ff00")).toBe(true);
  });

  it("resolves both sentinels simultaneously", () => {
    const template = {
      name: "TEST",
      buckets: new Map([
        [`${INHERIT_LAYER}::${BYBLOCK_COLOR}`, {
          lineSegments: [0, 0, 0, 1, 0, 0],
          points: [],
          linetypeDots: [],
          meshVertices: [],
          meshIndices: [],
        }],
      ]),
      fallbackEntityIndices: [],
    };

    const collector = new GeometryCollector();
    const worldMatrix = new THREE.Matrix4().identity();

    instantiateBlockTemplate(template, collector, "DOORS", "#0000ff", worldMatrix);

    expect(collector.lineSegments.has("DOORS::#0000ff")).toBe(true);
  });

  it("transforms mesh vertices (indices unchanged)", () => {
    const template = {
      name: "TEST",
      buckets: new Map([
        ["WALLS::#ff0000", {
          lineSegments: [],
          points: [],
          linetypeDots: [],
          meshVertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          meshIndices: [0, 1, 2],
        }],
      ]),
      fallbackEntityIndices: [],
    };

    const collector = new GeometryCollector();
    const worldMatrix = new THREE.Matrix4().makeTranslation(5, 5, 0);

    instantiateBlockTemplate(template, collector, "WALLS", "#ff0000", worldMatrix);

    const rawV = collector.meshVertices.get("WALLS::#ff0000");
    const rawI = collector.meshIndices.get("WALLS::#ff0000");
    expect(rawV).toBeDefined();
    expect(rawI).toBeDefined();
    const vertices = rawV!.toArray();
    const indices = rawI!.toArray();
    expect(vertices[0]).toBeCloseTo(5);
    expect(vertices[1]).toBeCloseTo(5);
    expect(indices).toEqual([0, 1, 2]);
  });

  it("handles multiple buckets", () => {
    const template = {
      name: "TEST",
      buckets: new Map([
        ["LAYER_A::#ff0000", {
          lineSegments: [0, 0, 0, 1, 0, 0],
          points: [],
          linetypeDots: [],
          meshVertices: [],
          meshIndices: [],
        }],
        ["LAYER_B::#00ff00", {
          lineSegments: [2, 0, 0, 3, 0, 0],
          points: [0, 0, 0],
          linetypeDots: [],
          meshVertices: [],
          meshIndices: [],
        }],
      ]),
      fallbackEntityIndices: [],
    };

    const collector = new GeometryCollector();
    const worldMatrix = new THREE.Matrix4().identity();

    instantiateBlockTemplate(template, collector, "X", "#000", worldMatrix);

    expect(collector.lineSegments.has("LAYER_A::#ff0000")).toBe(true);
    expect(collector.lineSegments.has("LAYER_B::#00ff00")).toBe(true);
    expect(collector.points.has("LAYER_B::#00ff00")).toBe(true);
  });
});
