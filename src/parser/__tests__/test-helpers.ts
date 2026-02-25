import DxfScanner, { type IGroup } from "../scanner";

/**
 * Create DxfScanner from DXF code/value pairs.
 * Input: flat array where even indices are codes, odd indices are values.
 * Example: createScanner("0", "LINE", "8", "Layer1", "0", "EOF")
 */
export function createScanner(...pairs: string[]): DxfScanner {
  return new DxfScanner(pairs);
}

/**
 * Create DxfScanner and advance to the first group (call next() once).
 * Returns { scanner, group } where group is the first read group.
 */
export function createScannerAt(
  ...pairs: string[]
): { scanner: DxfScanner; group: IGroup } {
  const scanner = new DxfScanner(pairs);
  const group = scanner.next();
  return { scanner, group };
}

/**
 * Minimal DXF with only ENTITIES section containing given entity lines.
 * Wraps entity data in proper SECTION/ENTITIES/ENDSEC/EOF structure.
 */
export function wrapInEntitiesSection(...entityLines: string[]): string[] {
  return [
    "0", "SECTION",
    "2", "ENTITIES",
    ...entityLines,
    "0", "ENDSEC",
    "0", "EOF",
  ];
}

/**
 * Minimal DXF with ENTITIES section for a single entity.
 * Prepends "0", entityType before the entity data lines.
 */
export function wrapEntity(
  entityType: string,
  ...dataLines: string[]
): string[] {
  return wrapInEntitiesSection("0", entityType, ...dataLines);
}
