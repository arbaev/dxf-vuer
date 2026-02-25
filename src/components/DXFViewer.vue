<template>
  <div ref="dxfContainer" class="dxf-viewer">
    <!-- Ошибка WebGL -->
    <div v-if="!webGLSupported" class="message-overlay">
      <div class="message-content error">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
          />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <div class="message-title">WebGL Not Supported</div>
        <div class="message-text">Update your browser or enable hardware acceleration</div>
      </div>
    </div>

    <!-- Имя файла в левом верхнем углу -->
    <div v-if="fileName && hasDXFData" class="file-name-overlay">
      {{ fileName }}
    </div>

    <!-- Кнопка сброса вида в правом верхнем углу -->
    <button
      v-if="showResetButton && hasDXFData"
      class="reset-button-overlay"
      @click="handleResetView"
      title="Reset View"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    </button>

    <!-- Панель слоёв -->
    <LayerPanel
      v-if="hasDXFData && layerList.length > 0"
      :layers="layerList"
      @toggle-layer="handleToggleLayer"
      @show-all="handleShowAllLayers"
      @hide-all="handleHideAllLayers"
    />

    <!-- Лоадер при загрузке файла -->
    <div v-if="isLoading" class="message-overlay loading-overlay">
      <div class="message-content">
        <div class="spinner"></div>
        <div class="message-text">Loading DXF file...</div>
      </div>
    </div>

    <!-- Placeholder когда нет данных -->
    <div v-else-if="!hasDXFData" class="message-overlay">
      <div class="message-content placeholder">
        <svg
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1"
        >
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <polyline points="13 2 13 9 20 9" />
        </svg>
        <div class="message-text">Select a DXF file to view</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import { useDXFRenderer } from "@/composables/dxf/useDXFRenderer";
import { useLayers } from "@/composables/dxf/useLayers";
import type { DxfData, DxfLayer } from "@/types/dxf";
import LayerPanel from "./LayerPanel.vue";

// Props
interface Props {
  dxfData?: DxfData | null;
  fileName?: string;
  showResetButton?: boolean;
  autoFit?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  dxfData: null,
  fileName: "",
  showResetButton: false,
  autoFit: true,
});

// Emits
interface Emits {
  (e: "dxf-loaded", success: boolean): void;
  (e: "dxf-data", data: DxfData | null): void;
  (e: "error", error: string): void;
  (e: "unsupported-entities", entities: string[]): void;
  (e: "reset-view"): void;
}

const emit = defineEmits<Emits>();

const dxfContainer = ref<HTMLDivElement | null>(null);

const {
  isLoading,
  webGLSupported,
  error: rendererError,
  initThreeJS,
  parseDXF,
  displayDXF,
  handleResize,
  resetView,
  applyLayerVisibility,
  cleanup,
} = useDXFRenderer();

const {
  layerList,
  visibleLayerNames,
  initLayers,
  toggleLayerVisibility,
  showAllLayers,
  hideAllLayers,
  clearLayers,
} = useLayers();

const hasDXFData = computed(() => {
  return props.dxfData && props.dxfData.entities && props.dxfData.entities.length > 0;
});

// Ссылка на данные, загруженные через loadDXFFromText, чтобы watch не загружал их повторно
let lastLoadedDxf: DxfData | null = null;

const handleResetView = () => {
  resetView();
  emit("reset-view");
};

// Инициализация слоёв из DXF данных
const initLayersFromDXF = (dxf: DxfData) => {
  const dxfLayers = (dxf.tables?.layer?.layers || {}) as Record<string, DxfLayer>;
  // Подсчёт entity по слоям
  const entityLayerCounts: Record<string, number> = {};
  for (const entity of dxf.entities) {
    const layerName = entity.layer || "0";
    entityLayerCounts[layerName] = (entityLayerCounts[layerName] || 0) + 1;
  }
  initLayers(dxfLayers, entityLayerCounts);
};

// Обработчики событий панели слоёв
const handleToggleLayer = (layerName: string) => {
  toggleLayerVisibility(layerName);
  applyLayerVisibility(visibleLayerNames.value);
};

const handleShowAllLayers = () => {
  showAllLayers();
  applyLayerVisibility(visibleLayerNames.value);
};

const handleHideAllLayers = () => {
  hideAllLayers();
  applyLayerVisibility(visibleLayerNames.value);
};

const loadDXFFromText = (dxfText: string) => {
  isLoading.value = true;
  // Двойной requestAnimationFrame гарантирует, что браузер успеет отрисовать спиннер
  // перед синхронной блокировкой парсинга/рендеринга
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        const dxf = parseDXF(dxfText);
        lastLoadedDxf = dxf;
        const unsupportedEntities = displayDXF(dxf);
        initLayersFromDXF(dxf);
        emit("dxf-loaded", true);
        emit("dxf-data", dxf);

        // Передаем неподдерживаемые entity наружу
        if (unsupportedEntities && unsupportedEntities.length > 0) {
          emit("unsupported-entities", unsupportedEntities);
        }
      } catch (error) {
        clearLayers();
        const errorMsg = error instanceof Error ? error.message : "Unknown error loading DXF";
        emit("error", errorMsg);
        emit("dxf-loaded", false);
        emit("dxf-data", null);
      } finally {
        isLoading.value = false;
      }
    });
  });
};

const loadDXFFromData = (dxfData: DxfData) => {
  try {
    const unsupportedEntities = displayDXF(dxfData);
    initLayersFromDXF(dxfData);
    emit("dxf-loaded", true);
    emit("dxf-data", dxfData);

    // Передаем неподдерживаемые entity наружу
    if (unsupportedEntities && unsupportedEntities.length > 0) {
      emit("unsupported-entities", unsupportedEntities);
    }
  } catch (error) {
    clearLayers();
    const errorMsg =
      error instanceof Error ? error.message : "Unknown error displaying DXF";
    emit("error", errorMsg);
    emit("dxf-loaded", false);
    emit("dxf-data", null);
  }
};

const resize = () => {
  if (dxfContainer.value) {
    handleResize(dxfContainer.value);
  }
};

watch(
  () => props.dxfData,
  (newData) => {
    // Пропускаем если данные уже загружены через loadDXFFromText
    if (newData && hasDXFData.value && newData !== lastLoadedDxf) {
      loadDXFFromData(newData);
    }
  },
);

watch(rendererError, (newError) => {
  if (newError) {
    emit("error", newError);
  }
});

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  nextTick(() => {
    if (dxfContainer.value) {
      initThreeJS(dxfContainer.value, { enableControls: true });

      if (props.dxfData && hasDXFData.value) {
        loadDXFFromData(props.dxfData);
      }

      resizeObserver = new ResizeObserver(() => {
        resize();
      });
      resizeObserver.observe(dxfContainer.value);
    }
  });
});

onBeforeUnmount(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  cleanup();
});

defineExpose({
  loadDXFFromText,
  loadDXFFromData,
  resize,
  resetView,
});
</script>

<style scoped>
.dxf-viewer {
  position: relative;
  width: 100%;
  flex: 1;
  background-color: var(--dxf-vuer-bg-color, #fafafa);
  border: 2px solid var(--dxf-vuer-border-color, #e0e0e0);
  border-radius: var(--dxf-vuer-border-radius, 4px);
  overflow: hidden;
}

.file-name-overlay {
  position: absolute;
  top: var(--dxf-vuer-spacing-sm, 8px);
  left: var(--dxf-vuer-spacing-sm, 8px);
  z-index: 10;
  padding: var(--dxf-vuer-spacing-sm, 8px) var(--dxf-vuer-spacing-md, 16px);
  background-color: rgba(255, 255, 255, 0.95);
  border: 1px solid var(--dxf-vuer-border-color, #e0e0e0);
  border-radius: var(--dxf-vuer-border-radius, 4px);
  font-size: 14px;
  color: var(--dxf-vuer-text-color, #212121);
  max-width: calc(100% - var(--dxf-vuer-spacing-lg, 24px) * 2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reset-button-overlay {
  position: absolute;
  top: var(--dxf-vuer-spacing-sm, 8px);
  right: var(--dxf-vuer-spacing-sm, 8px);
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--dxf-vuer-spacing-sm, 8px);
  color: var(--dxf-vuer-text-color, #212121);
  border: 1px solid var(--dxf-vuer-border-color, #e0e0e0);
  border-radius: var(--dxf-vuer-border-radius, 4px);
  font-weight: 500;
  font-size: 14px;
  transition: all 0.2s;
  user-select: none;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  background-color: rgba(255, 255, 255, 0.95);
  cursor: pointer;
}

.reset-button-overlay:hover {
  border-color: rgb(from var(--dxf-vuer-primary-color, #1040b0) r g b / 0.5);
}

.reset-button-overlay:active {
  transform: scale(0.94);
}

.dxf-viewer :deep(canvas) {
  display: block;
}

.message-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--dxf-vuer-spacing-lg, 24px);
}

.message-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--dxf-vuer-spacing-md, 16px);
  text-align: center;
}

.message-content.error svg {
  color: var(--dxf-vuer-error-color, #f44336);
}

.message-content.placeholder svg {
  color: var(--dxf-vuer-border-color, #e0e0e0);
}

.message-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--dxf-vuer-text-color, #212121);
}

.message-text {
  font-size: 1rem;
  color: var(--dxf-vuer-text-secondary, #757575);
  max-width: 300px;
}

.loading-overlay {
  z-index: 20;
  background-color: rgba(250, 250, 250, 0.85);
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--dxf-vuer-border-color, #e0e0e0);
  border-top-color: var(--dxf-vuer-primary-color, #1040b0);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 768px) {
  .file-name-overlay {
    top: var(--dxf-vuer-spacing-sm, 8px);
    left: var(--dxf-vuer-spacing-sm, 8px);
    padding: 6px var(--dxf-vuer-spacing-sm, 8px);
    font-size: 12px;
    max-width: calc(100% - 80px);
  }

  .reset-button-overlay {
    padding: 6px;
  }

  .reset-button-overlay svg {
    width: 18px;
    height: 18px;
  }

  .message-title {
    font-size: 1.1rem;
  }

  .message-text {
    font-size: 0.9rem;
  }
}
</style>
