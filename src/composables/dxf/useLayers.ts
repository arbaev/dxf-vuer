import { ref, computed } from "vue";
import type { DxfLayer } from "@/types/dxf";
import { rgbNumberToHex } from "@/utils/colorResolver";
import ACI_PALETTE from "@/parser/acadColorIndex";

export interface LayerState {
  name: string;
  visible: boolean;
  frozen: boolean;
  color: string;
  entityCount: number;
}

export function useLayers() {
  const layers = ref<Map<string, LayerState>>(new Map());

  const initLayers = (
    dxfLayers: Record<string, DxfLayer>,
    entityLayerCounts: Record<string, number>,
  ) => {
    const newLayers = new Map<string, LayerState>();
    for (const [name, layer] of Object.entries(dxfLayers)) {
      let color = "#FFFFFF";
      if (layer.colorIndex >= 1 && layer.colorIndex <= 255) {
        // ACI 7 and 255 are white in the palette but rendered as black on light background
        color = (layer.colorIndex === 7 || layer.colorIndex === 255)
          ? "#000000"
          : rgbNumberToHex(ACI_PALETTE[layer.colorIndex]);
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

  const toggleLayerVisibility = (layerName: string) => {
    const layer = layers.value.get(layerName);
    if (layer && !layer.frozen) {
      layer.visible = !layer.visible;
    }
  };

  const showAllLayers = () => {
    layers.value.forEach((layer) => {
      if (!layer.frozen) layer.visible = true;
    });
  };

  const hideAllLayers = () => {
    layers.value.forEach((layer) => {
      layer.visible = false;
    });
  };

  const visibleLayerNames = computed(() => {
    const names = new Set<string>();
    layers.value.forEach((layer) => {
      if (layer.visible) names.add(layer.name);
    });
    return names;
  });

  const layerList = computed(() => Array.from(layers.value.values()));

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
