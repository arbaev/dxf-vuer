import { describe, it, expect } from "vitest";
import { createScanner } from "./test-helpers";

describe("DxfScanner", () => {
  it("reads code/value pairs via next()", () => {
    const scanner = createScanner("0", "LINE", "0", "EOF");
    const group = scanner.next();
    expect(group.code).toBe(0);
    expect(group.value).toBe("LINE");
  });

  it("detects EOF", () => {
    const scanner = createScanner("0", "EOF");
    scanner.next();
    expect(scanner.isEOF()).toBe(true);
    expect(scanner.hasNext()).toBe(false);
  });
});
