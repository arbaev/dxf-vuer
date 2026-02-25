import { describe, it, expect } from "vitest";
import { rgbNumberToHex, resolveEntityColor } from "@/utils/colorResolver";
import { DEFAULT_ENTITY_COLOR } from "@/constants";
import type { DxfEntity, DxfLayer } from "@/types/dxf";

// Helper to create a minimal DxfEntity for testing color resolution.
// Uses DxfUnknownEntity (type: string) since we only care about color-related fields.
function makeEntity(
  overrides: Partial<{ colorIndex: number; color: number; layer: string }> = {},
): DxfEntity {
  return { type: "LINE", vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }], ...overrides } as DxfEntity;
}

// Helper to create a DxfLayer record keyed by layer name.
function makeLayer(
  name: string,
  overrides: Partial<Omit<DxfLayer, "name">> = {},
): Record<string, DxfLayer> {
  return {
    [name]: {
      name,
      visible: true,
      colorIndex: 0,
      color: 0,
      frozen: false,
      ...overrides,
    },
  };
}

// ── rgbNumberToHex ─────────────────────────────────────────────────────

describe("rgbNumberToHex", () => {
  it("converts red (0xFF0000 / 16711680) to '#ff0000'", () => {
    expect(rgbNumberToHex(0xFF0000)).toBe("#ff0000");
  });

  it("converts zero to '#000000'", () => {
    expect(rgbNumberToHex(0)).toBe("#000000");
  });

  it("converts blue (0x0000FF / 255) to '#0000ff'", () => {
    expect(rgbNumberToHex(0x0000FF)).toBe("#0000ff");
  });

  it("masks high bits beyond 24-bit RGB", () => {
    // JavaScript bitwise AND coerces to 32-bit signed int first, then masks to 24 bits.
    // -1 as a 32-bit signed int is 0xFFFFFFFF; masked with 0xFFFFFF gives 0xFFFFFF.
    expect(rgbNumberToHex(-1)).toBe("#ffffff");
    // 0xFF123456: bits 31-24 are 0xFF, masked to lower 24 bits gives 0x123456.
    expect(rgbNumberToHex(0xFF123456)).toBe("#123456");
  });
});

// ── resolveEntityColor ─────────────────────────────────────────────────

describe("resolveEntityColor", () => {
  // -- ByBlock (colorIndex === 0) --

  it("returns blockColor when colorIndex is 0 (ByBlock) and blockColor is provided", () => {
    const entity = makeEntity({ colorIndex: 0 });
    const result = resolveEntityColor(entity, {}, "#abcdef");
    expect(result).toBe("#abcdef");
  });

  it("returns DEFAULT_ENTITY_COLOR when colorIndex is 0 (ByBlock) and no blockColor", () => {
    const entity = makeEntity({ colorIndex: 0 });
    const result = resolveEntityColor(entity, {});
    expect(result).toBe(DEFAULT_ENTITY_COLOR);
  });

  // -- ACI color (1-255) --

  it("returns ACI red for colorIndex=1 without trueColor", () => {
    const entity = makeEntity({ colorIndex: 1 });
    const result = resolveEntityColor(entity, {});
    expect(result).toBe("#ff0000");
  });

  it("returns ACI blue for colorIndex=5 without trueColor", () => {
    const entity = makeEntity({ colorIndex: 5 });
    const result = resolveEntityColor(entity, {});
    expect(result).toBe("#0000ff");
  });

  it("returns trueColor when both colorIndex and trueColor (code 420) are set", () => {
    const entity = makeEntity({ colorIndex: 1, color: 0x00FF00 });
    const result = resolveEntityColor(entity, {});
    expect(result).toBe("#00ff00");
  });

  it("returns black for colorIndex=7 (white in ACI, rendered as black on light background)", () => {
    const entity = makeEntity({ colorIndex: 7 });
    const result = resolveEntityColor(entity, {});
    expect(result).toBe("#000000");
  });

  it("returns black for colorIndex=255 (same rule as ACI 7)", () => {
    const entity = makeEntity({ colorIndex: 255 });
    const result = resolveEntityColor(entity, {});
    expect(result).toBe("#000000");
  });

  // -- ByLayer (colorIndex=256, undefined, or out of range) --

  it("resolves color from layer when colorIndex=256 (ByLayer) and layer has color", () => {
    const layers = makeLayer("Walls", { colorIndex: 1, color: 0xFF0000 });
    const entity = makeEntity({ colorIndex: 256, layer: "Walls" });
    const result = resolveEntityColor(entity, layers);
    expect(result).toBe("#ff0000");
  });

  it("returns black when ByLayer and layer colorIndex is 7", () => {
    const layers = makeLayer("Default", { colorIndex: 7, color: 0xFFFFFF });
    const entity = makeEntity({ colorIndex: 256, layer: "Default" });
    const result = resolveEntityColor(entity, layers);
    expect(result).toBe("#000000");
  });

  it("resolves ACI color from layer when colorIndex is undefined and layer has colorIndex", () => {
    // layer.color is 0, so the fallback path using layer.colorIndex is used
    const layers = makeLayer("Red", { colorIndex: 1, color: 0 });
    const entity = makeEntity({ layer: "Red" });
    const result = resolveEntityColor(entity, layers);
    expect(result).toBe("#ff0000");
  });

  it("returns DEFAULT_ENTITY_COLOR when no colorIndex and no matching layer", () => {
    const entity = makeEntity({ layer: "NonExistent" });
    const result = resolveEntityColor(entity, {});
    expect(result).toBe(DEFAULT_ENTITY_COLOR);
  });

  it("returns DEFAULT_ENTITY_COLOR when entity has no colorIndex and no layer", () => {
    const entity = makeEntity({});
    const result = resolveEntityColor(entity, {});
    expect(result).toBe(DEFAULT_ENTITY_COLOR);
  });
});
