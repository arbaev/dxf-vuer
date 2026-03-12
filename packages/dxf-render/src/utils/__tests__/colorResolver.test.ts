import { describe, it, expect } from "vitest";
import { rgbNumberToHex, resolveEntityColor, ACI7_COLOR, resolveAci7Hex, isThemeAdaptiveColor, resolveThemeColor } from "@/utils/colorResolver";
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

// ── resolveAci7Hex ─────────────────────────────────────────────────────

describe("resolveAci7Hex", () => {
  it("returns black on light theme", () => {
    expect(resolveAci7Hex(false)).toBe("#000000");
  });

  it("returns white on dark theme", () => {
    expect(resolveAci7Hex(true)).toBe("#ffffff");
  });

  it("returns black when darkTheme is undefined", () => {
    expect(resolveAci7Hex(undefined)).toBe("#000000");
  });
});

// ── ACI7_COLOR sentinel ────────────────────────────────────────────────

describe("ACI7_COLOR sentinel", () => {
  it("is a non-empty string that is not a valid hex color", () => {
    expect(ACI7_COLOR).toBeTruthy();
    expect(ACI7_COLOR).not.toMatch(/^#[0-9a-f]{6}$/i);
  });
});

// ── isThemeAdaptiveColor ───────────────────────────────────────────────

describe("isThemeAdaptiveColor", () => {
  it("returns true for ACI7_COLOR sentinel", () => {
    expect(isThemeAdaptiveColor(ACI7_COLOR)).toBe(true);
  });

  it("returns true for ACI 250 sentinel", () => {
    const entity = makeEntity({ colorIndex: 250 });
    const color = resolveEntityColor(entity, {});
    expect(isThemeAdaptiveColor(color)).toBe(true);
  });

  it("returns false for regular hex color", () => {
    expect(isThemeAdaptiveColor("#ff0000")).toBe(false);
  });
});

// ── resolveThemeColor ─────────────────────────────────────────────────

describe("resolveThemeColor", () => {
  it("resolves ACI7 to black on light, white on dark", () => {
    expect(resolveThemeColor(ACI7_COLOR, false)).toBe("#000000");
    expect(resolveThemeColor(ACI7_COLOR, true)).toBe("#ffffff");
  });

  it("resolves ACI 250 to dark gray on light, light gray on dark", () => {
    const sentinel = "\0ACI250";
    expect(resolveThemeColor(sentinel, false)).toBe("#333333");
    expect(resolveThemeColor(sentinel, true)).toBe("#cccccc");
  });

  it("resolves ACI 251 to inverted gray in dark mode", () => {
    const sentinel = "\0ACI251";
    const light = resolveThemeColor(sentinel, false);
    const dark = resolveThemeColor(sentinel, true);
    expect(light).not.toBe(dark);
    // Dark mode should be lighter than light mode
    expect(parseInt(dark.slice(1, 3), 16)).toBeGreaterThan(parseInt(light.slice(1, 3), 16));
  });
});

// ── resolveEntityColor — ACI 250-252 sentinels ────────────────────────

describe("resolveEntityColor — dark gray sentinels", () => {
  it("returns sentinel for ACI 250", () => {
    const color = resolveEntityColor(makeEntity({ colorIndex: 250 }), {});
    expect(isThemeAdaptiveColor(color)).toBe(true);
    expect(color).not.toBe(ACI7_COLOR);
  });

  it("returns sentinel for ACI 251", () => {
    const color = resolveEntityColor(makeEntity({ colorIndex: 251 }), {});
    expect(isThemeAdaptiveColor(color)).toBe(true);
  });

  it("returns regular hex for ACI 252 (not adaptive)", () => {
    const color = resolveEntityColor(makeEntity({ colorIndex: 252 }), {});
    expect(isThemeAdaptiveColor(color)).toBe(false);
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("trueColor overrides ACI 250 sentinel", () => {
    const entity = makeEntity({ colorIndex: 250, color: 0xFF0000 });
    const color = resolveEntityColor(entity, {});
    expect(color).toBe("#ff0000");
  });

  it("returns sentinel for ByLayer with layer colorIndex 250", () => {
    const layers = { "L1": { colorIndex: 250, color: 0x333333 } as unknown as DxfLayer };
    const entity = makeEntity({ layer: "L1" });
    const color = resolveEntityColor(entity, layers);
    expect(isThemeAdaptiveColor(color)).toBe(true);
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

  it("returns ACI7_COLOR when colorIndex is 0 (ByBlock) and no blockColor", () => {
    const entity = makeEntity({ colorIndex: 0 });
    const result = resolveEntityColor(entity, {});
    expect(result).toBe(ACI7_COLOR);
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

  it("returns ACI7_COLOR for colorIndex=7 (theme-dependent sentinel)", () => {
    const entity = makeEntity({ colorIndex: 7 });
    const result = resolveEntityColor(entity, {});
    expect(result).toBe(ACI7_COLOR);
  });

  it("returns ACI7_COLOR for colorIndex=255 (same rule as ACI 7)", () => {
    const entity = makeEntity({ colorIndex: 255 });
    const result = resolveEntityColor(entity, {});
    expect(result).toBe(ACI7_COLOR);
  });

  // -- ByLayer (colorIndex=256, undefined, or out of range) --

  it("resolves color from layer when colorIndex=256 (ByLayer) and layer has color", () => {
    const layers = makeLayer("Walls", { colorIndex: 1, color: 0xFF0000 });
    const entity = makeEntity({ colorIndex: 256, layer: "Walls" });
    const result = resolveEntityColor(entity, layers);
    expect(result).toBe("#ff0000");
  });

  it("returns ACI7_COLOR when ByLayer and layer colorIndex is 7", () => {
    const layers = makeLayer("Default", { colorIndex: 7, color: 0xFFFFFF });
    const entity = makeEntity({ colorIndex: 256, layer: "Default" });
    const result = resolveEntityColor(entity, layers);
    expect(result).toBe(ACI7_COLOR);
  });

  it("resolves ACI color from layer when colorIndex is undefined and layer has colorIndex", () => {
    // layer.color is 0, so the fallback path using layer.colorIndex is used
    const layers = makeLayer("Red", { colorIndex: 1, color: 0 });
    const entity = makeEntity({ layer: "Red" });
    const result = resolveEntityColor(entity, layers);
    expect(result).toBe("#ff0000");
  });

  it("returns ACI7_COLOR when no colorIndex and no matching layer", () => {
    const entity = makeEntity({ layer: "NonExistent" });
    const result = resolveEntityColor(entity, {});
    expect(result).toBe(ACI7_COLOR);
  });

  it("returns ACI7_COLOR when entity has no colorIndex and no layer", () => {
    const entity = makeEntity({});
    const result = resolveEntityColor(entity, {});
    expect(result).toBe(ACI7_COLOR);
  });

  // -- ACI7_COLOR sentinel for ByLayer --

  it("returns ACI7_COLOR for ByLayer with layer colorIndex=7", () => {
    const layers = makeLayer("Default", { colorIndex: 7, color: 0xFFFFFF });
    const entity = makeEntity({ colorIndex: 256, layer: "Default" });
    const result = resolveEntityColor(entity, layers);
    expect(result).toBe(ACI7_COLOR);
  });

  it("returns ACI7_COLOR for ByLayer with ACI-only layer colorIndex=7", () => {
    const layers = makeLayer("Default", { colorIndex: 7, color: 0 });
    const entity = makeEntity({ layer: "Default" });
    const result = resolveEntityColor(entity, layers);
    expect(result).toBe(ACI7_COLOR);
  });

  it("returns ACI7_COLOR for ByBlock without blockColor", () => {
    const entity = makeEntity({ colorIndex: 0 });
    const result = resolveEntityColor(entity, {});
    expect(result).toBe(ACI7_COLOR);
  });
});
