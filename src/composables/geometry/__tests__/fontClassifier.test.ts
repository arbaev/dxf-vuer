import { describe, it, expect } from "vitest";
import { classifyFont, resolveEntityFont } from "../fontClassifier";
import type { DxfStyle } from "@/types/dxf";

describe("classifyFont", () => {
  it("returns 'sans' for undefined or empty font name", () => {
    expect(classifyFont(undefined)).toBe("sans");
    expect(classifyFont("")).toBe("sans");
  });

  it("returns 'serif' for Times New Roman", () => {
    expect(classifyFont("Times New Roman")).toBe("serif");
  });

  it("returns 'serif' for times.ttf (case-insensitive)", () => {
    expect(classifyFont("times.ttf")).toBe("serif");
    expect(classifyFont("TIMES.TTF")).toBe("serif");
  });

  it("returns 'serif' for known serif font families", () => {
    expect(classifyFont("Georgia")).toBe("serif");
    expect(classifyFont("Garamond")).toBe("serif");
    expect(classifyFont("Palatino Linotype")).toBe("serif");
    expect(classifyFont("Cambria")).toBe("serif");
    expect(classifyFont("Bodoni MT")).toBe("serif");
    expect(classifyFont("Century Schoolbook")).toBe("serif");
    expect(classifyFont("Bookman Old Style")).toBe("serif");
  });

  it("returns 'serif' for SHX serif fonts", () => {
    expect(classifyFont("romans")).toBe("serif");
    expect(classifyFont("romans.shx")).toBe("serif");
    expect(classifyFont("ROMANC")).toBe("serif");
    expect(classifyFont("romand.SHX")).toBe("serif");
    expect(classifyFont("romant")).toBe("serif");
    expect(classifyFont("scripts")).toBe("serif");
    expect(classifyFont("scriptc")).toBe("serif");
  });

  it("returns 'sans' for Arial and other sans-serif fonts", () => {
    expect(classifyFont("Arial")).toBe("sans");
    expect(classifyFont("arial.ttf")).toBe("sans");
    expect(classifyFont("Helvetica")).toBe("sans");
    expect(classifyFont("Verdana")).toBe("sans");
    expect(classifyFont("Calibri")).toBe("sans");
    expect(classifyFont("simplex.shx")).toBe("sans");
    expect(classifyFont("txt.shx")).toBe("sans");
  });

  it("returns 'serif' for font names containing 'serif'", () => {
    expect(classifyFont("Noto Serif")).toBe("serif");
    expect(classifyFont("DejaVu Serif")).toBe("serif");
  });
});

describe("resolveEntityFont", () => {
  // Minimal mock fonts (just need to be distinct objects)
  const sansFont = { names: { fontFamily: { en: "Sans" } } } as unknown as import("opentype.js").Font;
  const serifFont = { names: { fontFamily: { en: "Serif" } } } as unknown as import("opentype.js").Font;

  const styles: Record<string, DxfStyle> = {
    Standard: { name: "Standard", fontFile: "arial.ttf" },
    Heading: { name: "Heading", fontFile: "times.ttf" },
    NoFont: { name: "NoFont" },
  };

  it("returns sansFont when serifFont is undefined (fast path)", () => {
    expect(resolveEntityFont("Heading", styles, undefined, sansFont)).toBe(sansFont);
  });

  it("returns sansFont for undefined textStyle and no inline font", () => {
    expect(resolveEntityFont(undefined, styles, serifFont, sansFont)).toBe(sansFont);
  });

  it("returns serifFont when STYLE table has serif fontFile", () => {
    expect(resolveEntityFont("Heading", styles, serifFont, sansFont)).toBe(serifFont);
  });

  it("returns sansFont when STYLE table has sans fontFile", () => {
    expect(resolveEntityFont("Standard", styles, serifFont, sansFont)).toBe(sansFont);
  });

  it("returns sansFont when STYLE has no fontFile", () => {
    expect(resolveEntityFont("NoFont", styles, serifFont, sansFont)).toBe(sansFont);
  });

  it("returns sansFont for unknown style name", () => {
    expect(resolveEntityFont("Unknown", styles, serifFont, sansFont)).toBe(sansFont);
  });

  it("prefers inline fontFamily over textStyle", () => {
    // textStyle points to sans (Standard/arial), but inline says Times
    expect(resolveEntityFont("Standard", styles, serifFont, sansFont, "Times New Roman")).toBe(serifFont);
  });

  it("returns sansFont for inline sans fontFamily", () => {
    expect(resolveEntityFont("Heading", styles, serifFont, sansFont, "Arial")).toBe(sansFont);
  });
});
