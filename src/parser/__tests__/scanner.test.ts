import { describe, it, expect } from "vitest";
import { createScanner, createScannerAt } from "./test-helpers";

describe("DxfScanner", () => {
  // ── next() ──────────────────────────────────────────────────────────

  describe("next()", () => {
    it("reads a code/value pair and advances the pointer", () => {
      const scanner = createScanner("0", "SECTION", "0", "EOF");
      const group = scanner.next();
      expect(group.code).toBe(0);
      expect(group.value).toBe("SECTION");
    });

    it("reads multiple groups sequentially", () => {
      const scanner = createScanner("0", "LINE", "8", "Layer1", "10", "1.5", "0", "EOF");
      const g1 = scanner.next();
      const g2 = scanner.next();
      const g3 = scanner.next();
      expect(g1).toEqual({ code: 0, value: "LINE" });
      expect(g2).toEqual({ code: 8, value: "Layer1" });
      expect(g3).toEqual({ code: 10, value: 1.5 });
    });

    it("recognizes EOF group (code 0, value 'EOF')", () => {
      const scanner = createScanner("0", "EOF");
      const group = scanner.next();
      expect(group.code).toBe(0);
      expect(group.value).toBe("EOF");
      expect(scanner.isEOF()).toBe(true);
      expect(scanner.hasNext()).toBe(false);
    });

    it("throws when called after EOF has been read", () => {
      const scanner = createScanner("0", "EOF");
      scanner.next();
      expect(() => scanner.next()).toThrow(
        "Cannot call 'next' after EOF group has been read",
      );
    });

    it("throws on unexpected end of data (no EOF group)", () => {
      const scanner = createScanner("0", "LINE");
      scanner.next(); // consume the only group
      expect(() => scanner.next()).toThrow("Unexpected end of input");
    });
  });

  // ── peek() ──────────────────────────────────────────────────────────

  describe("peek()", () => {
    it("reads the next group without advancing the pointer", () => {
      const scanner = createScanner("0", "LINE", "8", "Layer1", "0", "EOF");
      const peeked = scanner.peek();
      expect(peeked).toEqual({ code: 0, value: "LINE" });

      // pointer did not advance — next() returns the same group
      const group = scanner.next();
      expect(group).toEqual({ code: 0, value: "LINE" });
    });

    it("can be called multiple times returning the same result", () => {
      const scanner = createScanner("0", "LINE", "0", "EOF");
      const p1 = scanner.peek();
      const p2 = scanner.peek();
      expect(p1).toEqual(p2);
    });

    it("throws after EOF has been read", () => {
      const scanner = createScanner("0", "EOF");
      scanner.next();
      expect(() => scanner.peek()).toThrow(
        "Cannot call 'peek' after EOF group has been read",
      );
    });

    it("throws on unexpected end of data", () => {
      const scanner = createScanner("0", "LINE");
      scanner.next();
      expect(() => scanner.peek()).toThrow("Unexpected end of input");
    });
  });

  // ── rewind() ────────────────────────────────────────────────────────

  describe("rewind()", () => {
    it("rewinds one group by default", () => {
      const scanner = createScanner("0", "LINE", "8", "Layer1", "0", "EOF");
      scanner.next(); // LINE
      scanner.next(); // Layer1
      scanner.rewind();
      const group = scanner.next();
      expect(group).toEqual({ code: 8, value: "Layer1" });
    });

    it("rewinds N groups when argument is provided", () => {
      const scanner = createScanner("0", "LINE", "8", "Layer1", "10", "5.0", "0", "EOF");
      scanner.next(); // LINE
      scanner.next(); // Layer1
      scanner.next(); // 5.0
      scanner.rewind(3);
      const group = scanner.next();
      expect(group).toEqual({ code: 0, value: "LINE" });
    });

    it("resets _eof flag so next() works after rewinding past EOF", () => {
      const scanner = createScanner("0", "LINE", "0", "EOF");
      scanner.next(); // LINE
      scanner.next(); // EOF
      expect(scanner.isEOF()).toBe(true);
      expect(scanner.hasNext()).toBe(false);

      scanner.rewind(1);
      expect(scanner.hasNext()).toBe(true);
      const group = scanner.next();
      expect(group).toEqual({ code: 0, value: "EOF" });
    });
  });

  // ── hasNext() ───────────────────────────────────────────────────────

  describe("hasNext()", () => {
    it("returns true when data remains", () => {
      const scanner = createScanner("0", "LINE", "0", "EOF");
      expect(scanner.hasNext()).toBe(true);
    });

    it("returns false after EOF group is read", () => {
      const scanner = createScanner("0", "EOF");
      scanner.next();
      expect(scanner.hasNext()).toBe(false);
    });

    it("returns false when pointer is past end of data (no EOF)", () => {
      const scanner = createScanner("0", "LINE");
      scanner.next();
      expect(scanner.hasNext()).toBe(false);
    });
  });

  // ── isEOF() ─────────────────────────────────────────────────────────

  describe("isEOF()", () => {
    it("returns false before any reading", () => {
      const scanner = createScanner("0", "LINE", "0", "EOF");
      expect(scanner.isEOF()).toBe(false);
    });

    it("returns false after reading a non-EOF group", () => {
      const scanner = createScanner("0", "LINE", "0", "EOF");
      scanner.next();
      expect(scanner.isEOF()).toBe(false);
    });

    it("returns true after reading the EOF group", () => {
      const scanner = createScanner("0", "LINE", "0", "EOF");
      scanner.next();
      scanner.next();
      expect(scanner.isEOF()).toBe(true);
    });
  });

  // ── lastReadGroup ───────────────────────────────────────────────────

  describe("lastReadGroup", () => {
    it("stores the most recently read group from next()", () => {
      const scanner = createScanner("0", "LINE", "8", "Layer1", "0", "EOF");
      scanner.next();
      expect(scanner.lastReadGroup).toEqual({ code: 0, value: "LINE" });
      scanner.next();
      expect(scanner.lastReadGroup).toEqual({ code: 8, value: "Layer1" });
    });

    it("is not updated by peek()", () => {
      const scanner = createScanner("0", "LINE", "8", "Layer1", "0", "EOF");
      scanner.next(); // reads LINE
      scanner.peek(); // peeks Layer1
      expect(scanner.lastReadGroup).toEqual({ code: 0, value: "LINE" });
    });
  });

  // ── parseGroupValue type casting ────────────────────────────────────

  describe("parseGroupValue (type casting via next())", () => {
    // Helper: create a scanner with one data pair followed by EOF, read it.
    function readSingleGroup(code: string, value: string) {
      const { group } = createScannerAt(code, value, "0", "EOF");
      return group;
    }

    it("codes 0-9 return string", () => {
      expect(readSingleGroup("0", "LINE").value).toBe("LINE");
      expect(readSingleGroup("5", "ABC123").value).toBe("ABC123");
      expect(readSingleGroup("9", "$EXTMIN").value).toBe("$EXTMIN");
    });

    it("codes 10-59 return float", () => {
      expect(readSingleGroup("10", "1.5").value).toBe(1.5);
      expect(readSingleGroup("20", "3.14").value).toBe(3.14);
      expect(readSingleGroup("59", "0.0").value).toBe(0);
    });

    it("codes 60-99 return int", () => {
      expect(readSingleGroup("62", "5").value).toBe(5);
      expect(readSingleGroup("70", "128").value).toBe(128);
      expect(readSingleGroup("99", "1").value).toBe(1);
    });

    it("codes 100-109 return string", () => {
      expect(readSingleGroup("100", "AcDbEntity").value).toBe("AcDbEntity");
    });

    it("codes 110-149 return float", () => {
      expect(readSingleGroup("110", "10.5").value).toBe(10.5);
      expect(readSingleGroup("140", "2.0").value).toBe(2.0);
    });

    it("codes 160-179 return int", () => {
      expect(readSingleGroup("160", "500").value).toBe(500);
      expect(readSingleGroup("175", "3").value).toBe(3);
    });

    it("codes 210-239 return float", () => {
      expect(readSingleGroup("210", "0.0").value).toBe(0);
      expect(readSingleGroup("230", "1.0").value).toBe(1.0);
    });

    it("codes 260-289 return int", () => {
      expect(readSingleGroup("260", "1").value).toBe(1);
      expect(readSingleGroup("280", "2").value).toBe(2);
    });

    it("codes 290-299 return boolean (true when value is '1')", () => {
      expect(readSingleGroup("290", "1").value).toBe(true);
      expect(readSingleGroup("290", "0").value).toBe(false);
      expect(readSingleGroup("299", "1").value).toBe(true);
    });

    it("codes 300-369 return string", () => {
      expect(readSingleGroup("300", "SomeStr").value).toBe("SomeStr");
      expect(readSingleGroup("330", "ABCDEF").value).toBe("ABCDEF");
    });

    it("codes 370-389 return int", () => {
      expect(readSingleGroup("370", "25").value).toBe(25);
    });

    it("codes 420-429 return int (trueColor)", () => {
      expect(readSingleGroup("420", "16711680").value).toBe(16711680);
    });

    it("codes 460-469 return float", () => {
      expect(readSingleGroup("460", "0.785").value).toBeCloseTo(0.785);
    });

    it("code 999 returns string (comment)", () => {
      expect(readSingleGroup("999", "comment text").value).toBe("comment text");
    });

    it("codes 1000-1009 return string (extended data string)", () => {
      expect(readSingleGroup("1000", "xdata").value).toBe("xdata");
    });

    it("codes 1010-1059 return float (extended data float)", () => {
      expect(readSingleGroup("1010", "7.7").value).toBe(7.7);
      expect(readSingleGroup("1040", "2.5").value).toBe(2.5);
    });

    it("codes 1060-1071 return int (extended data int)", () => {
      expect(readSingleGroup("1060", "42").value).toBe(42);
      expect(readSingleGroup("1071", "99").value).toBe(99);
    });

    it("unknown code range falls back to string", () => {
      // Code 500 is in a gap not covered by any explicit range
      expect(readSingleGroup("500", "something").value).toBe("something");
    });
  });

  // ── Trimming ────────────────────────────────────────────────────────

  describe("value trimming", () => {
    it("trims leading and trailing whitespace from values", () => {
      const { group } = createScannerAt("0", "  LINE  ", "0", "EOF");
      expect(group.value).toBe("LINE");
    });

    it("trims whitespace before parsing numeric values", () => {
      const scanner = createScanner("10", "  3.14  ", "0", "EOF");
      const group = scanner.next();
      expect(group.value).toBe(3.14);
    });
  });
});
