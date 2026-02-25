import type { DxfData, DxfStatistics } from "@/types/dxf";

export function collectDXFStatistics(
  dxfData: DxfData,
  fileName: string,
  fileSize: number
): DxfStatistics {
  const entitiesByType: Record<string, number> = {};

  dxfData.entities.forEach((entity) => {
    const type = entity.type;
    entitiesByType[type] = (entitiesByType[type] || 0) + 1;
  });

  let layersCount = 0;
  if (dxfData.tables?.layer?.layers) {
    layersCount = Object.keys(dxfData.tables.layer.layers).length;
  }

  const blocksCount = dxfData.blocks ? Object.keys(dxfData.blocks).length : 0;

  let autocadVersion: string | undefined;
  if (dxfData.header?.$ACADVER) {
    autocadVersion = String(dxfData.header.$ACADVER);
  }

  return {
    fileName,
    fileSize,
    totalEntities: dxfData.entities.length,
    entitiesByType,
    layersCount,
    blocksCount,
    autocadVersion,
  };
}
