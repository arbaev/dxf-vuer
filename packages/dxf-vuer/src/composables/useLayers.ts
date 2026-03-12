import { ref, computed } from "vue";
import type { DxfLayer } from "dxf-render";
import { rgbNumberToHex, ACI_PALETTE, resolveThemeColor } from "dxf-render";

export interface LayerState {
  name: string;
  visible: boolean;
  frozen: boolean;
  locked: boolean;
  color: string;
  entityCount: number;
  /** True when layer color is ACI 7/255 (theme-dependent) */
  isAci7: boolean;
  /** Sentinel key for theme-adaptive colors (ACI 7/255, 250-252) */
  themeSentinel?: string;
}

export function useLayers() {
  const layers = ref<Map<string, LayerState>>(new Map());

  const initLayers = (
    dxfLayers: Record<string, DxfLayer>,
    entityLayerCounts: Record<string, number>,
    darkTheme?: boolean,
  ) => {
    const newLayers = new Map<string, LayerState>();
    for (const [name, layer] of Object.entries(dxfLayers)) {
      const ci = layer.colorIndex;
      const isAci7 = ci === 7 || ci === 255;
      const isGrayAdaptive = ci >= 250 && ci <= 251;
      const themeSentinel = isAci7 ? "\0ACI7" : isGrayAdaptive ? "\0ACI" + ci : undefined;
      let color = "#FFFFFF";
      if (ci >= 1 && ci <= 255) {
        color = themeSentinel
          ? resolveThemeColor(themeSentinel, darkTheme)
          : rgbNumberToHex(ACI_PALETTE[ci]);
      }

      newLayers.set(name, {
        name,
        visible: layer.visible && !layer.frozen,
        frozen: layer.frozen,
        locked: layer.locked ?? false,
        color,
        entityCount: entityLayerCounts[name] || 0,
        isAci7: isAci7 || isGrayAdaptive,
        themeSentinel,
      });
    }

    // Add layers referenced by entities but missing from the LAYER table
    const aci7Color = darkTheme ? "#ffffff" : "#000000";
    for (const [name, count] of Object.entries(entityLayerCounts)) {
      if (!newLayers.has(name)) {
        newLayers.set(name, {
          name,
          visible: true,
          frozen: false,
          locked: false,
          color: aci7Color,
          entityCount: count,
          isAci7: true,
        });
      }
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

  const updateLayerThemeColors = (darkTheme: boolean) => {
    for (const layer of layers.value.values()) {
      if (layer.themeSentinel) {
        layer.color = resolveThemeColor(layer.themeSentinel, darkTheme);
      } else if (layer.isAci7) {
        layer.color = darkTheme ? "#ffffff" : "#000000";
      }
    }
  };

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
    updateLayerThemeColors,
    clearLayers,
  };
}
