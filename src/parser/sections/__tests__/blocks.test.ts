import { describe, it, expect } from "vitest";
import { createScanner } from "../../__tests__/test-helpers";
import { parseBlocks } from "../blocks";
import type { IBlock } from "../blocks";

describe("parseBlocks", () => {
  // ── Single block with name and position ─────────────────────────────

  it("parses a single block with name and position", () => {
    // Scanner starts after "0 SECTION / 2 BLOCKS" has been consumed.
    // parseBlocks calls scanner.next() itself.
    const scanner = createScanner(
      "0", "BLOCK",
      "2", "TestBlock",
      "8", "0",             // layer
      "10", "1.0",          // position.x
      "20", "2.0",          // position.y
      "30", "0.0",          // position.z
      "0", "ENDBLK",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const blocks = parseBlocks(scanner);

    expect(blocks).toHaveProperty("TestBlock");
    const block = blocks.TestBlock;
    expect(block.name).toBe("TestBlock");
    expect(block.layer).toBe("0");

    const pos = block.position as { x: number; y: number; z: number };
    expect(pos.x).toBe(1.0);
    expect(pos.y).toBe(2.0);
    expect(pos.z).toBe(0.0);
  });

  // ── Block with entities inside ──────────────────────────────────────

  it("parses a block containing LINE entities", () => {
    const scanner = createScanner(
      "0", "BLOCK",
      "2", "BlockWithLine",
      "8", "0",
      "10", "0.0",
      "20", "0.0",
      "30", "0.0",
      "0", "LINE",          // entity inside the block
      "8", "0",
      "10", "0.0",
      "20", "0.0",
      "11", "10.0",
      "21", "5.0",
      "0", "ENDBLK",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const blocks = parseBlocks(scanner);

    const block = blocks.BlockWithLine;
    expect(block.entities).toBeDefined();
    expect(block.entities).toHaveLength(1);
    expect((block.entities[0] as { type: string }).type).toBe("LINE");
  });

  // ── Block without handle gets auto-incremented handle ───────────────

  it("assigns auto-incremented handle when block has no explicit handle", () => {
    const scanner = createScanner(
      "0", "BLOCK",
      "2", "NoHandleBlock",
      "8", "0",
      "10", "0.0",
      "20", "0.0",
      "30", "0.0",
      "0", "ENDBLK",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const blocks = parseBlocks(scanner);

    const block = blocks.NoHandleBlock;
    // Auto-increment starts at 0
    expect(block.handle).toBe(0);
  });

  // ── Block with paperSpace, xrefPath, and type ───────────────────────

  it("parses block metadata: paperSpace, xrefPath, type", () => {
    const scanner = createScanner(
      "0", "BLOCK",
      "5", "A1",             // explicit handle
      "1", "external.dxf",   // xrefPath
      "2", "XrefBlock",
      "3", "XrefBlock",      // name2
      "8", "0",
      "67", "1",             // paperSpace = true
      "70", "4",             // type (non-zero value)
      "10", "0.0",
      "20", "0.0",
      "30", "0.0",
      "0", "ENDBLK",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const blocks = parseBlocks(scanner);

    const block = blocks.XrefBlock;
    expect(block.handle).toBe("A1");
    expect(block.xrefPath).toBe("external.dxf");
    expect(block.name2).toBe("XrefBlock");
    expect(block.paperSpace).toBe(true);
    expect(block.type).toBe(4);
  });

  // ── Multiple blocks ─────────────────────────────────────────────────

  it("parses multiple blocks in sequence", () => {
    const scanner = createScanner(
      "0", "BLOCK",
      "5", "B1",
      "2", "Block1",
      "8", "0",
      "10", "0.0",
      "20", "0.0",
      "30", "0.0",
      "0", "ENDBLK",
      "0", "BLOCK",
      "5", "B2",
      "2", "Block2",
      "8", "Layer1",
      "10", "5.0",
      "20", "10.0",
      "30", "0.0",
      "0", "ENDBLK",
      "0", "ENDSEC",
      "0", "EOF",
    );

    const blocks = parseBlocks(scanner);

    expect(Object.keys(blocks)).toHaveLength(2);
    expect(blocks).toHaveProperty("Block1");
    expect(blocks).toHaveProperty("Block2");
    expect(blocks.Block1.handle).toBe("B1");
    expect(blocks.Block2.handle).toBe("B2");
    expect(blocks.Block2.layer).toBe("Layer1");
  });

  // ── Empty BLOCKS section ────────────────────────────────────────────

  it("returns an empty object for an empty BLOCKS section (immediate ENDSEC)", () => {
    const scanner = createScanner(
      "0", "ENDSEC",
      "0", "EOF",
    );

    const blocks = parseBlocks(scanner);

    expect(blocks).toEqual({});
  });
});
