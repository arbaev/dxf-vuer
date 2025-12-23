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

  // Подсчитываем слои (из tables.LAYER)
  let layersCount = 0;
  if (dxfData.tables?.LAYER) {
    const layers = dxfData.tables.LAYER;
    if (typeof layers === "object" && layers !== null) {
      // tables.LAYER может быть объектом с layers или массивом
      if (Array.isArray(layers)) {
        layersCount = layers.length;
      } else {
        // Если это объект, считаем ключи
        layersCount = Object.keys(layers).length;
      }
    }
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
