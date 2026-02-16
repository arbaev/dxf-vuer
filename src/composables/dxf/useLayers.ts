// Composable для управления слоями DXF
import { ref, computed } from "vue";
import type { DxfLayer } from "@/types/dxf";
import { rgbNumberToHex } from "@/utils/colorResolver";

export interface LayerState {
  name: string;
  visible: boolean; // Управляется пользователем
  frozen: boolean; // Из DXF (read-only)
  color: string; // Hex цвет слоя
  entityCount: number;
}

export function useLayers() {
  const layers = ref<Map<string, LayerState>>(new Map());

  /** Инициализация слоёв из DXF данных */
  const initLayers = (
    dxfLayers: Record<string, DxfLayer>,
    entityLayerCounts: Record<string, number>,
  ) => {
    const newLayers = new Map<string, LayerState>();
    for (const [name, layer] of Object.entries(dxfLayers)) {
      let color = "#FFFFFF";
      if (layer.color !== undefined && layer.color !== 0) {
        color = rgbNumberToHex(layer.color);
      } else if (layer.colorIndex >= 1 && layer.colorIndex <= 255) {
        // ACI 7 → чёрный на светлом фоне
        color = layer.colorIndex === 7 ? "#000000" : rgbNumberToHex(layer.color || 0xFFFFFF);
      }

      newLayers.set(name, {
        name,
        visible: layer.visible && !layer.frozen,
        frozen: layer.frozen,
        color,
        entityCount: entityLayerCounts[name] || 0,
      });
    }
    layers.value = newLayers;
  };

  /** Переключить видимость слоя */
  const toggleLayerVisibility = (layerName: string) => {
    const layer = layers.value.get(layerName);
    if (layer && !layer.frozen) {
      layer.visible = !layer.visible;
    }
  };

  /** Показать все слои */
  const showAllLayers = () => {
    layers.value.forEach((layer) => {
      if (!layer.frozen) layer.visible = true;
    });
  };

  /** Скрыть все слои */
  const hideAllLayers = () => {
    layers.value.forEach((layer) => {
      layer.visible = false;
    });
  };

  /** Множество видимых слоёв */
  const visibleLayerNames = computed(() => {
    const names = new Set<string>();
    layers.value.forEach((layer) => {
      if (layer.visible) names.add(layer.name);
    });
    return names;
  });

  /** Список слоёв для UI */
  const layerList = computed(() => Array.from(layers.value.values()));

  /** Сброс слоёв */
  const clearLayers = () => {
    layers.value = new Map();
  };

  return {
    layers,
    layerList,
    visibleLayerNames,
    initLayers,
    toggleLayerVisibility,
    showAllLayers,
    hideAllLayers,
    clearLayers,
  };
}
