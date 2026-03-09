import { describe, it, expect, vi } from "vitest";
import { MaterialCacheStore } from "../materialCache";

describe("MaterialCacheStore", () => {
  it("creates an empty store with three cache maps", () => {
    const store = new MaterialCacheStore();
    expect(store.line.size).toBe(0);
    expect(store.mesh.size).toBe(0);
    expect(store.points.size).toBe(0);
  });

  it("stores materials in each cache independently", () => {
    const store = new MaterialCacheStore();

    const lineMat = { dispose: vi.fn() } as any;
    const meshMat = { dispose: vi.fn() } as any;
    const pointsMat = { dispose: vi.fn() } as any;

    store.line.set("#ff0000", lineMat);
    store.mesh.set("#00ff00", meshMat);
    store.points.set("#0000ff", pointsMat);

    expect(store.line.size).toBe(1);
    expect(store.mesh.size).toBe(1);
    expect(store.points.size).toBe(1);
    expect(store.line.get("#ff0000")).toBe(lineMat);
    expect(store.mesh.get("#00ff00")).toBe(meshMat);
    expect(store.points.get("#0000ff")).toBe(pointsMat);
  });

  it("disposeAll() calls dispose on every cached material", () => {
    const store = new MaterialCacheStore();

    const lineMat1 = { dispose: vi.fn() } as any;
    const lineMat2 = { dispose: vi.fn() } as any;
    const meshMat = { dispose: vi.fn() } as any;
    const pointsMat = { dispose: vi.fn() } as any;

    store.line.set("#ff0000", lineMat1);
    store.line.set("#00ff00", lineMat2);
    store.mesh.set("#ff0000", meshMat);
    store.points.set("#ff0000", pointsMat);

    store.disposeAll();

    expect(lineMat1.dispose).toHaveBeenCalledOnce();
    expect(lineMat2.dispose).toHaveBeenCalledOnce();
    expect(meshMat.dispose).toHaveBeenCalledOnce();
    expect(pointsMat.dispose).toHaveBeenCalledOnce();
  });

  it("disposeAll() clears all cache maps", () => {
    const store = new MaterialCacheStore();

    store.line.set("#ff0000", { dispose: vi.fn() } as any);
    store.mesh.set("#ff0000", { dispose: vi.fn() } as any);
    store.points.set("#ff0000", { dispose: vi.fn() } as any);

    store.disposeAll();

    expect(store.line.size).toBe(0);
    expect(store.mesh.size).toBe(0);
    expect(store.points.size).toBe(0);
  });

  it("disposeAll() is safe to call on an empty store", () => {
    const store = new MaterialCacheStore();
    expect(() => store.disposeAll()).not.toThrow();
  });

  it("can be reused after disposeAll()", () => {
    const store = new MaterialCacheStore();

    store.line.set("#ff0000", { dispose: vi.fn() } as any);
    store.disposeAll();
    expect(store.line.size).toBe(0);

    const newMat = { dispose: vi.fn() } as any;
    store.line.set("#00ff00", newMat);
    expect(store.line.size).toBe(1);
    expect(store.line.get("#00ff00")).toBe(newMat);
  });
});
