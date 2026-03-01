import { describe, it, expect } from "vitest";
import { degreesToRadians } from "../primitives";

describe("degreesToRadians", () => {
  it("converts 0 degrees to 0 radians", () => {
    expect(degreesToRadians(0)).toBeCloseTo(0);
  });

  it("converts 90 degrees to PI/2 radians", () => {
    expect(degreesToRadians(90)).toBeCloseTo(Math.PI / 2);
  });

  it("converts 180 degrees to PI radians", () => {
    expect(degreesToRadians(180)).toBeCloseTo(Math.PI);
  });

  it("converts 360 degrees to 2*PI radians", () => {
    expect(degreesToRadians(360)).toBeCloseTo(2 * Math.PI);
  });

  it("converts 45 degrees to PI/4 radians", () => {
    expect(degreesToRadians(45)).toBeCloseTo(Math.PI / 4);
  });

  it("converts -90 degrees to -PI/2 radians (negative input)", () => {
    expect(degreesToRadians(-90)).toBeCloseTo(-Math.PI / 2);
  });

  it("converts 270 degrees to 3*PI/2 radians", () => {
    expect(degreesToRadians(270)).toBeCloseTo((3 * Math.PI) / 2);
  });
});
