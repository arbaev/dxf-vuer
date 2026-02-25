import { describe, it, expect } from "vitest";
import {
  isLineEntity,
  isCircleEntity,
  isArcEntity,
  isPolylineEntity,
  isSplineEntity,
  isTextEntity,
  isDimensionEntity,
  isInsertEntity,
  isSolidEntity,
  isEllipseEntity,
  isPointEntity,
  is3DFaceEntity,
  isHatchEntity,
  isLeaderEntity,
  isMLeaderEntity,
  isAttdefEntity,
  type DxfEntity,
} from "../dxf";

// Minimal entity factories using type assertions.
// Only the `type` field is needed for the type guard logic.
function entity(type: string): DxfEntity {
  return { type } as DxfEntity;
}

// ── Single-type guards ─────────────────────────────────────────────────

describe("isLineEntity", () => {
  it("returns true for LINE", () => {
    expect(isLineEntity(entity("LINE"))).toBe(true);
  });

  it("returns false for CIRCLE", () => {
    expect(isLineEntity(entity("CIRCLE"))).toBe(false);
  });
});

describe("isCircleEntity", () => {
  it("returns true for CIRCLE", () => {
    expect(isCircleEntity(entity("CIRCLE"))).toBe(true);
  });

  it("returns false for ARC", () => {
    expect(isCircleEntity(entity("ARC"))).toBe(false);
  });
});

describe("isArcEntity", () => {
  it("returns true for ARC", () => {
    expect(isArcEntity(entity("ARC"))).toBe(true);
  });

  it("returns false for CIRCLE", () => {
    expect(isArcEntity(entity("CIRCLE"))).toBe(false);
  });
});

describe("isSplineEntity", () => {
  it("returns true for SPLINE", () => {
    expect(isSplineEntity(entity("SPLINE"))).toBe(true);
  });

  it("returns false for LINE", () => {
    expect(isSplineEntity(entity("LINE"))).toBe(false);
  });
});

describe("isDimensionEntity", () => {
  it("returns true for DIMENSION", () => {
    expect(isDimensionEntity(entity("DIMENSION"))).toBe(true);
  });

  it("returns false for LINE", () => {
    expect(isDimensionEntity(entity("LINE"))).toBe(false);
  });
});

describe("isInsertEntity", () => {
  it("returns true for INSERT", () => {
    expect(isInsertEntity(entity("INSERT"))).toBe(true);
  });

  it("returns false for LINE", () => {
    expect(isInsertEntity(entity("LINE"))).toBe(false);
  });
});

describe("isSolidEntity", () => {
  it("returns true for SOLID", () => {
    expect(isSolidEntity(entity("SOLID"))).toBe(true);
  });

  it("returns false for LINE", () => {
    expect(isSolidEntity(entity("LINE"))).toBe(false);
  });
});

describe("isEllipseEntity", () => {
  it("returns true for ELLIPSE", () => {
    expect(isEllipseEntity(entity("ELLIPSE"))).toBe(true);
  });

  it("returns false for CIRCLE", () => {
    expect(isEllipseEntity(entity("CIRCLE"))).toBe(false);
  });
});

describe("isPointEntity", () => {
  it("returns true for POINT", () => {
    expect(isPointEntity(entity("POINT"))).toBe(true);
  });

  it("returns false for LINE", () => {
    expect(isPointEntity(entity("LINE"))).toBe(false);
  });
});

describe("is3DFaceEntity", () => {
  it("returns true for 3DFACE", () => {
    expect(is3DFaceEntity(entity("3DFACE"))).toBe(true);
  });

  it("returns false for SOLID", () => {
    expect(is3DFaceEntity(entity("SOLID"))).toBe(false);
  });
});

describe("isHatchEntity", () => {
  it("returns true for HATCH", () => {
    expect(isHatchEntity(entity("HATCH"))).toBe(true);
  });

  it("returns false for LINE", () => {
    expect(isHatchEntity(entity("LINE"))).toBe(false);
  });
});

describe("isLeaderEntity", () => {
  it("returns true for LEADER", () => {
    expect(isLeaderEntity(entity("LEADER"))).toBe(true);
  });

  it("returns false for LINE", () => {
    expect(isLeaderEntity(entity("LINE"))).toBe(false);
  });
});

describe("isMLeaderEntity", () => {
  it("returns true for MULTILEADER", () => {
    expect(isMLeaderEntity(entity("MULTILEADER"))).toBe(true);
  });

  it("returns false for LEADER", () => {
    expect(isMLeaderEntity(entity("LEADER"))).toBe(false);
  });
});

describe("isAttdefEntity", () => {
  it("returns true for ATTDEF", () => {
    expect(isAttdefEntity(entity("ATTDEF"))).toBe(true);
  });

  it("returns false for LINE", () => {
    expect(isAttdefEntity(entity("LINE"))).toBe(false);
  });
});

// ── Multi-type guards ──────────────────────────────────────────────────

describe("isPolylineEntity", () => {
  it("returns true for POLYLINE", () => {
    expect(isPolylineEntity(entity("POLYLINE"))).toBe(true);
  });

  it("returns true for LWPOLYLINE", () => {
    expect(isPolylineEntity(entity("LWPOLYLINE"))).toBe(true);
  });

  it("returns false for LINE", () => {
    expect(isPolylineEntity(entity("LINE"))).toBe(false);
  });
});

describe("isTextEntity", () => {
  it("returns true for TEXT", () => {
    expect(isTextEntity(entity("TEXT"))).toBe(true);
  });

  it("returns true for MTEXT", () => {
    expect(isTextEntity(entity("MTEXT"))).toBe(true);
  });

  it("returns false for LINE", () => {
    expect(isTextEntity(entity("LINE"))).toBe(false);
  });
});

// ── Cross-guard exclusivity ────────────────────────────────────────────
// Verify that each guard rejects entity types belonging to other guards.

describe("cross-guard exclusivity", () => {
  const guards = [
    { name: "isLineEntity", fn: isLineEntity, matches: ["LINE"] },
    { name: "isCircleEntity", fn: isCircleEntity, matches: ["CIRCLE"] },
    { name: "isArcEntity", fn: isArcEntity, matches: ["ARC"] },
    { name: "isPolylineEntity", fn: isPolylineEntity, matches: ["POLYLINE", "LWPOLYLINE"] },
    { name: "isSplineEntity", fn: isSplineEntity, matches: ["SPLINE"] },
    { name: "isTextEntity", fn: isTextEntity, matches: ["TEXT", "MTEXT"] },
    { name: "isDimensionEntity", fn: isDimensionEntity, matches: ["DIMENSION"] },
    { name: "isInsertEntity", fn: isInsertEntity, matches: ["INSERT"] },
    { name: "isSolidEntity", fn: isSolidEntity, matches: ["SOLID"] },
    { name: "isEllipseEntity", fn: isEllipseEntity, matches: ["ELLIPSE"] },
    { name: "isPointEntity", fn: isPointEntity, matches: ["POINT"] },
    { name: "is3DFaceEntity", fn: is3DFaceEntity, matches: ["3DFACE"] },
    { name: "isHatchEntity", fn: isHatchEntity, matches: ["HATCH"] },
    { name: "isLeaderEntity", fn: isLeaderEntity, matches: ["LEADER"] },
    { name: "isMLeaderEntity", fn: isMLeaderEntity, matches: ["MULTILEADER"] },
    { name: "isAttdefEntity", fn: isAttdefEntity, matches: ["ATTDEF"] },
  ] as const;

  // Collect all unique entity type strings
  const allTypes = guards.flatMap((g) => g.matches);

  for (const guard of guards) {
    const nonMatchingTypes = allTypes.filter((t) => !guard.matches.includes(t));

    it(`${guard.name} returns false for all non-matching types`, () => {
      for (const type of nonMatchingTypes) {
        expect(guard.fn(entity(type))).toBe(false);
      }
    });
  }
});
