import { describe, it, expect } from "vitest";
import { collectDXFStatistics } from "../dxfStatistics";
import type { DxfData, DxfEntity } from "@/types/dxf";

describe("collectDXFStatistics", () => {
  // ── 1. Empty entities ──────────────────────────────────────────────────

  it("returns totalEntities=0 and empty entitiesByType when entities array is empty", () => {
    const dxfData: DxfData = { entities: [] };

    const result = collectDXFStatistics(dxfData, "empty.dxf", 1024);

    expect(result.fileName).toBe("empty.dxf");
    expect(result.fileSize).toBe(1024);
    expect(result.totalEntities).toBe(0);
    expect(result.entitiesByType).toEqual({});
  });

  // ── 2. Multiple entities of different types ────────────────────────────

  it("counts entities correctly by type when there are multiple entity types", () => {
    const dxfData: DxfData = {
      entities: [
        { type: "LINE" } as DxfEntity,
        { type: "LINE" } as DxfEntity,
        { type: "CIRCLE" } as DxfEntity,
        { type: "ARC" } as DxfEntity,
        { type: "LINE" } as DxfEntity,
        { type: "ARC" } as DxfEntity,
      ],
    };

    const result = collectDXFStatistics(dxfData, "drawing.dxf", 5000);

    expect(result.totalEntities).toBe(6);
    expect(result.entitiesByType).toEqual({
      LINE: 3,
      CIRCLE: 1,
      ARC: 2,
    });
  });

  // ── 3. With tables containing layers ───────────────────────────────────

  it("returns correct layersCount when tables contain layers", () => {
    const dxfData: DxfData = {
      entities: [],
      tables: {
        layer: {
          layers: {
            "0": { name: "0", visible: true, colorIndex: 7, color: 0xffffff, frozen: false },
            "Walls": { name: "Walls", visible: true, colorIndex: 1, color: 0xff0000, frozen: false },
          },
        },
      },
    };

    const result = collectDXFStatistics(dxfData, "layers.dxf", 2048);

    expect(result.layersCount).toBe(2);
  });

  // ── 4. With blocks ─────────────────────────────────────────────────────

  it("returns correct blocksCount when blocks are present", () => {
    const dxfData: DxfData = {
      entities: [],
      blocks: {
        "*Model_Space": { entities: [] },
        "*Paper_Space": { entities: [] },
        "MyBlock": { entities: [] },
      },
    };

    const result = collectDXFStatistics(dxfData, "blocks.dxf", 3000);

    expect(result.blocksCount).toBe(3);
  });

  // ── 5. With header $ACADVER ────────────────────────────────────────────

  it("extracts autocadVersion from header $ACADVER", () => {
    const dxfData: DxfData = {
      entities: [],
      header: {
        $ACADVER: "AC1027",
      },
    };

    const result = collectDXFStatistics(dxfData, "versioned.dxf", 4096);

    expect(result.autocadVersion).toBe("AC1027");
  });

  // ── 6. Without header, tables, or blocks ───────────────────────────────

  it("returns defaults when header, tables, and blocks are absent", () => {
    const dxfData: DxfData = {
      entities: [{ type: "POINT" } as DxfEntity],
    };

    const result = collectDXFStatistics(dxfData, "minimal.dxf", 512);

    expect(result.layersCount).toBe(0);
    expect(result.blocksCount).toBe(0);
    expect(result.autocadVersion).toBeUndefined();
  });
});
