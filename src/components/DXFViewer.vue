<template>
  <div
    ref="dxfContainer"
    class="dxf-viewer"
    @mousemove="handleMouseMove"
    @mouseleave="handleMouseLeave"
  >
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

    <div v-if="fileName && hasDXFData" class="file-name-overlay">
      {{ fileName }}
    </div>

    <div v-if="hasDXFData" class="toolbar-overlay">
      <button
        v-if="showResetButton"
        class="toolbar-button"
        @click="handleResetView"
        title="Fit to View"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="7" />
          <line x1="12" y1="2" x2="12" y2="5" />
          <line x1="12" y1="19" x2="12" y2="22" />
          <line x1="2" y1="12" x2="5" y2="12" />
          <line x1="19" y1="12" x2="22" y2="12" />
        </svg>
      </button>
      <button
        v-if="showFullscreenButton"
        class="toolbar-button"
        @click="toggleFullscreen"
        :title="isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'"
      >
        <svg
          v-if="!isFullscreen"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M4 8V4h4" />
          <path d="M16 4h4v4" />
          <path d="M20 16v4h-4" />
          <path d="M4 16v4h4" />
        </svg>
        <svg
          v-else
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M8 4v4H4" />
          <path d="M16 4v4h4" />
          <path d="M4 16h4v4" />
          <path d="M20 16h-4v4" />
        </svg>
      </button>
    </div>

    <LayerPanel
      v-if="hasDXFData && layerList.length > 0"
      :layers="layerList"
      @toggle-layer="handleToggleLayer"
      @show-all="handleShowAllLayers"
      @hide-all="handleHideAllLayers"
    />

    <div v-if="showCoordinates && isCursorVisible && hasDXFData" class="coordinates-overlay">
      X: {{ cursorX.toFixed(2) }} &nbsp; Y: {{ cursorY.toFixed(2) }}
    </div>

    <div v-if="isLoading" class="message-overlay loading-overlay">
      <div class="message-content">
        <div class="spinner"></div>
        <div class="message-text">
          {{ loadingPhase === 'parsing' ? 'Parsing DXF...' : 'Rendering...' }}
        </div>
        <div v-if="loadingPhase === 'rendering'" class="progress-container">
          <div class="progress-bar" :style="{ width: (displayProgress * 100) + '%' }"></div>
        </div>
        <div v-if="loadingPhase === 'rendering'" class="progress-text">
          {{ Math.round(displayProgress * 100) }}%
        </div>
      </div>
    </div>

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
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick, toRaw } from "vue";
import * as THREE from "three";
import { useDXFRenderer } from "@/composables/useDXFRenderer";
import { useLayers } from "@/composables/useLayers";
import type { DxfData, DxfLayer } from "@/types/dxf";
import LayerPanel from "./LayerPanel.vue";

interface Props {
  dxfData?: DxfData | null;
  fileName?: string;
  showResetButton?: boolean;
  showFullscreenButton?: boolean;
  autoFit?: boolean;
  showCoordinates?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  dxfData: null,
  fileName: "",
  showResetButton: false,
  showFullscreenButton: true,
  autoFit: true,
  showCoordinates: false,
});

interface Emits {
  (e: "dxf-loaded", success: boolean): void;
  (e: "dxf-data", data: DxfData | null): void;
  (e: "error", error: string): void;
  (e: "unsupported-entities", entities: string[]): void;
  (e: "reset-view"): void;
}

const emit = defineEmits<Emits>();

const dxfContainer = ref<HTMLDivElement | null>(null);
const isFullscreen = ref(false);

const {
  isLoading,
  displayProgress,
  webGLSupported,
  error: rendererError,
  initThreeJS,
  parseDXFAsync,
  displayDXF,
  handleResize,
  resetView,
  applyLayerVisibility,
  cleanup,
  getCamera,
  getRenderer,
} = useDXFRenderer();

const loadingPhase = ref<"" | "parsing" | "rendering">("");

// Cursor world coordinates
const cursorX = ref(0);
const cursorY = ref(0);
const isCursorVisible = ref(false);

const handleMouseMove = (e: MouseEvent) => {
  if (!props.showCoordinates) return;
  const container = dxfContainer.value;
  const camera = getCamera();
  if (!container || !camera) return;

  const rect = container.getBoundingClientRect();
  const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  const worldPos = new THREE.Vector3(ndcX, ndcY, 0).unproject(camera);

  cursorX.value = worldPos.x;
  cursorY.value = worldPos.y;
  isCursorVisible.value = true;
};

const handleMouseLeave = () => {
  isCursorVisible.value = false;
};

const toggleFullscreen = async () => {
  if (!dxfContainer.value) return;
  if (!document.fullscreenElement) {
    await dxfContainer.value.requestFullscreen();
  } else {
    await document.exitFullscreen();
  }
};

const onFullscreenChange = () => {
  isFullscreen.value = !!document.fullscreenElement;
};

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

// Reference to data loaded via loadDXFFromText so watch does not reload them
let lastLoadedDxf: DxfData | null = null;

const handleResetView = () => {
  resetView();
  emit("reset-view");
};

const initLayersFromDXF = (dxf: DxfData) => {
  const dxfLayers = (dxf.tables?.layer?.layers || {}) as Record<string, DxfLayer>;
  const entityLayerCounts: Record<string, number> = {};
  for (const entity of dxf.entities) {
    const layerName = entity.layer || "0";
    entityLayerCounts[layerName] = (entityLayerCounts[layerName] || 0) + 1;
  }
  initLayers(dxfLayers, entityLayerCounts);
};

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

const loadDXFFromText = async (dxfText: string) => {
  isLoading.value = true;
  try {
    loadingPhase.value = "parsing";
    console.time("[dxf-vuer] parseDXF");
    const dxf = await parseDXFAsync(dxfText);
    console.timeEnd("[dxf-vuer] parseDXF");

    lastLoadedDxf = dxf;

    loadingPhase.value = "rendering";
    console.time("[dxf-vuer] displayDXF");
    const unsupportedEntities = await displayDXF(dxf);
    console.timeEnd("[dxf-vuer] displayDXF");

    initLayersFromDXF(dxf);
    applyLayerVisibility(visibleLayerNames.value);
    emit("dxf-loaded", true);
    emit("dxf-data", dxf);

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
    loadingPhase.value = "";
    isLoading.value = false;
  }
};

const loadDXFFromData = async (dxfData: DxfData) => {
  isLoading.value = true;
  loadingPhase.value = "rendering";
  try {
    const unsupportedEntities = await displayDXF(dxfData);
    initLayersFromDXF(dxfData);
    applyLayerVisibility(visibleLayerNames.value);
    emit("dxf-loaded", true);
    emit("dxf-data", dxfData);

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
  } finally {
    loadingPhase.value = "";
    isLoading.value = false;
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
    // Skip if data was already loaded via loadDXFFromText
    if (newData && hasDXFData.value && toRaw(newData) !== lastLoadedDxf) {
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
  document.addEventListener("fullscreenchange", onFullscreenChange);
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
  document.removeEventListener("fullscreenchange", onFullscreenChange);
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
  getRenderer,
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

.toolbar-overlay {
  position: absolute;
  top: var(--dxf-vuer-spacing-sm, 8px);
  right: var(--dxf-vuer-spacing-sm, 8px);
  z-index: 10;
  display: flex;
  gap: 4px;
}

.toolbar-button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--dxf-vuer-spacing-sm, 8px);
  color: var(--dxf-vuer-text-color, #212121);
  border: 1px solid var(--dxf-vuer-border-color, #e0e0e0);
  border-radius: var(--dxf-vuer-border-radius, 4px);
  transition: all 0.2s;
  user-select: none;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  background-color: rgba(255, 255, 255, 0.95);
  cursor: pointer;
}

.toolbar-button:hover {
  border-color: rgb(from var(--dxf-vuer-primary-color, #1040b0) r g b / 0.5);
}

.toolbar-button:active {
  transform: scale(0.94);
}

.dxf-viewer :deep(canvas) {
  display: block;
}

.coordinates-overlay {
  position: absolute;
  bottom: var(--dxf-vuer-spacing-sm, 8px);
  right: var(--dxf-vuer-spacing-sm, 8px);
  z-index: 10;
  padding: 4px var(--dxf-vuer-spacing-sm, 8px);
  background-color: rgba(0, 0, 0, 0.7);
  color: #fff;
  border-radius: var(--dxf-vuer-border-radius, 4px);
  font-size: 12px;
  font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
  pointer-events: none;
  white-space: nowrap;
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

.progress-container {
  width: 200px;
  height: 4px;
  background-color: var(--dxf-vuer-border-color, #e0e0e0);
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background-color: var(--dxf-vuer-primary-color, #1040b0);
  transition: width 0.1s ease-out;
}

.progress-text {
  font-size: 0.85rem;
  color: var(--dxf-vuer-text-secondary, #757575);
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

  .toolbar-button {
    padding: 6px;
  }

  .toolbar-button svg {
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
