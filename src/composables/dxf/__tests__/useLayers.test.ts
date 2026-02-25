import { describe, it, expect } from "vitest";
import { useLayers } from "@/composables/dxf/useLayers";
import type { DxfLayer } from "@/types/dxf";

// Helper to create a minimal DxfLayer object with sensible defaults.
function makeLayer(overrides: Partial<DxfLayer> = {}): DxfLayer {
  return {
    name: "Layer1",
    colorIndex: 7,
    color: 0,
    visible: true,
    frozen: false,
    ...overrides,
  } as DxfLayer;
}

// ── initLayers ──────────────────────────────────────────────────────────

describe("initLayers", () => {
  it("creates LayerState entries with correct name, visible, frozen, color, and entityCount", () => {
    const { initLayers, layers } = useLayers();

    const dxfLayers: Record<string, DxfLayer> = {
      Walls: makeLayer({ name: "Walls", colorIndex: 1, visible: true, frozen: false }),
      Doors: makeLayer({ name: "Doors", colorIndex: 3, visible: true, frozen: false }),
    };

    const entityCounts: Record<string, number> = { Walls: 42, Doors: 7 };

    initLayers(dxfLayers, entityCounts);

    expect(layers.value.size).toBe(2);

    const walls = layers.value.get("Walls");
    expect(walls).toBeDefined();
    expect(walls!.name).toBe("Walls");
    expect(walls!.visible).toBe(true);
    expect(walls!.frozen).toBe(false);
    expect(walls!.color).toBe("#ff0000"); // ACI 1 = red
    expect(walls!.entityCount).toBe(42);

    const doors = layers.value.get("Doors");
    expect(doors).toBeDefined();
    expect(doors!.name).toBe("Doors");
    expect(doors!.entityCount).toBe(7);
  });

  it("sets visible=true when layer is visible and not frozen", () => {
    const { initLayers, layers } = useLayers();

    initLayers(
      { A: makeLayer({ name: "A", visible: true, frozen: false }) },
      {},
    );

    expect(layers.value.get("A")!.visible).toBe(true);
  });

  it("sets visible=false when layer is frozen, regardless of layer.visible", () => {
    const { initLayers, layers } = useLayers();

    initLayers(
      {
        FrozenVisible: makeLayer({ name: "FrozenVisible", visible: true, frozen: true }),
        FrozenHidden: makeLayer({ name: "FrozenHidden", visible: false, frozen: true }),
      },
      {},
    );

    expect(layers.value.get("FrozenVisible")!.visible).toBe(false);
    expect(layers.value.get("FrozenVisible")!.frozen).toBe(true);
    expect(layers.value.get("FrozenHidden")!.visible).toBe(false);
    expect(layers.value.get("FrozenHidden")!.frozen).toBe(true);
  });

  it("sets visible=false when layer.visible is false (not frozen)", () => {
    const { initLayers, layers } = useLayers();

    initLayers(
      { Hidden: makeLayer({ name: "Hidden", visible: false, frozen: false }) },
      {},
    );

    expect(layers.value.get("Hidden")!.visible).toBe(false);
    expect(layers.value.get("Hidden")!.frozen).toBe(false);
  });

  it("maps ACI colorIndex values to correct hex colors", () => {
    const { initLayers, layers } = useLayers();

    initLayers(
      {
        Red: makeLayer({ name: "Red", colorIndex: 1 }),
        White7: makeLayer({ name: "White7", colorIndex: 7 }),
        White255: makeLayer({ name: "White255", colorIndex: 255 }),
        ByBlock: makeLayer({ name: "ByBlock", colorIndex: 0 }),
        Blue: makeLayer({ name: "Blue", colorIndex: 5 }),
      },
      {},
    );

    // ACI 1 = red (0xFF0000)
    expect(layers.value.get("Red")!.color).toBe("#ff0000");
    // ACI 7 is white in palette but rendered as black on light background
    expect(layers.value.get("White7")!.color).toBe("#000000");
    // ACI 255 follows the same rule as ACI 7
    expect(layers.value.get("White255")!.color).toBe("#000000");
    // colorIndex 0 (ByBlock) is out of 1-255 range, so falls back to default #FFFFFF
    expect(layers.value.get("ByBlock")!.color).toBe("#FFFFFF");
    // ACI 5 = blue (0x0000FF)
    expect(layers.value.get("Blue")!.color).toBe("#0000ff");
  });

  it("uses entityLayerCounts for entityCount, defaulting to 0 when missing", () => {
    const { initLayers, layers } = useLayers();

    initLayers(
      {
        Present: makeLayer({ name: "Present" }),
        Missing: makeLayer({ name: "Missing" }),
      },
      { Present: 15 },
    );

    expect(layers.value.get("Present")!.entityCount).toBe(15);
    expect(layers.value.get("Missing")!.entityCount).toBe(0);
  });
});

// ── toggleLayerVisibility ───────────────────────────────────────────────

describe("toggleLayerVisibility", () => {
  it("toggles a visible layer to hidden", () => {
    const { initLayers, toggleLayerVisibility, layers } = useLayers();

    initLayers(
      { A: makeLayer({ name: "A", visible: true, frozen: false }) },
      {},
    );

    expect(layers.value.get("A")!.visible).toBe(true);

    toggleLayerVisibility("A");

    expect(layers.value.get("A")!.visible).toBe(false);
  });

  it("toggles a hidden layer to visible", () => {
    const { initLayers, toggleLayerVisibility, layers } = useLayers();

    initLayers(
      { A: makeLayer({ name: "A", visible: false, frozen: false }) },
      {},
    );

    expect(layers.value.get("A")!.visible).toBe(false);

    toggleLayerVisibility("A");

    expect(layers.value.get("A")!.visible).toBe(true);
  });

  it("does not toggle a frozen layer", () => {
    const { initLayers, toggleLayerVisibility, layers } = useLayers();

    initLayers(
      { Frozen: makeLayer({ name: "Frozen", visible: false, frozen: true }) },
      {},
    );

    expect(layers.value.get("Frozen")!.visible).toBe(false);

    toggleLayerVisibility("Frozen");

    // Frozen layer should remain unchanged
    expect(layers.value.get("Frozen")!.visible).toBe(false);
  });
});

// ── showAllLayers ───────────────────────────────────────────────────────

describe("showAllLayers", () => {
  it("makes all non-frozen layers visible while frozen layers stay hidden", () => {
    const { initLayers, hideAllLayers, showAllLayers, layers } = useLayers();

    initLayers(
      {
        Normal: makeLayer({ name: "Normal", visible: true, frozen: false }),
        Hidden: makeLayer({ name: "Hidden", visible: false, frozen: false }),
        Frozen: makeLayer({ name: "Frozen", visible: false, frozen: true }),
      },
      {},
    );

    // First hide all layers to establish a known state
    hideAllLayers();
    expect(layers.value.get("Normal")!.visible).toBe(false);
    expect(layers.value.get("Hidden")!.visible).toBe(false);
    expect(layers.value.get("Frozen")!.visible).toBe(false);

    // Now show all layers
    showAllLayers();

    expect(layers.value.get("Normal")!.visible).toBe(true);
    expect(layers.value.get("Hidden")!.visible).toBe(true);
    // Frozen layer should remain hidden
    expect(layers.value.get("Frozen")!.visible).toBe(false);
  });
});

// ── hideAllLayers ───────────────────────────────────────────────────────

describe("hideAllLayers", () => {
  it("hides all layers including frozen ones", () => {
    const { initLayers, hideAllLayers, layers } = useLayers();

    initLayers(
      {
        Normal: makeLayer({ name: "Normal", visible: true, frozen: false }),
        Frozen: makeLayer({ name: "Frozen", visible: true, frozen: true }),
      },
      {},
    );

    // Note: frozen layer starts with visible=false from initLayers (visible && !frozen)
    // So let's verify initial state, then hideAllLayers should set all to false
    hideAllLayers();

    expect(layers.value.get("Normal")!.visible).toBe(false);
    expect(layers.value.get("Frozen")!.visible).toBe(false);
  });
});

// ── visibleLayerNames ───────────────────────────────────────────────────

describe("visibleLayerNames", () => {
  it("returns a Set containing only the names of visible layers", () => {
    const { initLayers, visibleLayerNames } = useLayers();

    initLayers(
      {
        Visible1: makeLayer({ name: "Visible1", visible: true, frozen: false }),
        Visible2: makeLayer({ name: "Visible2", visible: true, frozen: false }),
        Hidden: makeLayer({ name: "Hidden", visible: false, frozen: false }),
        Frozen: makeLayer({ name: "Frozen", visible: true, frozen: true }),
      },
      {},
    );

    const names = visibleLayerNames.value;

    expect(names).toBeInstanceOf(Set);
    expect(names.size).toBe(2);
    expect(names.has("Visible1")).toBe(true);
    expect(names.has("Visible2")).toBe(true);
    expect(names.has("Hidden")).toBe(false);
    // Frozen layer has visible=true in DxfLayer, but initLayers sets visible = visible && !frozen = false
    expect(names.has("Frozen")).toBe(false);
  });
});

// ── layerList ───────────────────────────────────────────────────────────

describe("layerList", () => {
  it("returns an array of all LayerState values", () => {
    const { initLayers, layerList } = useLayers();

    initLayers(
      {
        A: makeLayer({ name: "A", visible: true, frozen: false }),
        B: makeLayer({ name: "B", visible: false, frozen: true }),
      },
      { A: 10, B: 5 },
    );

    const list = layerList.value;

    expect(Array.isArray(list)).toBe(true);
    expect(list).toHaveLength(2);

    const names = list.map((l) => l.name).sort();
    expect(names).toEqual(["A", "B"]);

    const layerA = list.find((l) => l.name === "A");
    expect(layerA).toBeDefined();
    expect(layerA!.entityCount).toBe(10);
  });
});

// ── clearLayers ─────────────────────────────────────────────────────────

describe("clearLayers", () => {
  it("removes all layers, resulting in an empty map", () => {
    const { initLayers, clearLayers, layers, layerList } = useLayers();

    initLayers(
      {
        A: makeLayer({ name: "A" }),
        B: makeLayer({ name: "B" }),
      },
      {},
    );

    expect(layers.value.size).toBe(2);

    clearLayers();

    expect(layers.value.size).toBe(0);
    expect(layerList.value).toEqual([]);
  });
});
