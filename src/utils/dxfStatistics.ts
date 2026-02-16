import type { DxfData, DxfStatistics } from "@/types/dxf";

/**
 * Собирает статистику из DXF данных
 */
export function collectDXFStatistics(
  dxfData: DxfData,
  fileName: string,
  fileSize: number
): DxfStatistics {
  const entitiesByType: Record<string, number> = {};

  // Подсчитываем entities по типам
  dxfData.entities.forEach((entity) => {
    const type = entity.type;
    entitiesByType[type] = (entitiesByType[type] || 0) + 1;
  });

  // Подсчитываем слои (из tables.layer.layers)
  let layersCount = 0;
  if (dxfData.tables?.layer?.layers) {
    layersCount = Object.keys(dxfData.tables.layer.layers).length;
  }

  // Подсчитываем блоки
  const blocksCount = dxfData.blocks ? Object.keys(dxfData.blocks).length : 0;

  // Извлекаем версию AutoCAD из header.$ACADVER
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
