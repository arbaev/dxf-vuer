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
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useDXFRenderer } from "@/composables/dxf/useDXFRenderer";
import type { DxfData } from "@/types/dxf";
import { DEBOUNCE_DELAY } from "@/constants";

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
  webGLSupported,
  error: rendererError,
  initThreeJS,
  parseDXF,
  displayDXF,
  handleResize,
  resetView,
  cleanup,
} = useDXFRenderer();

const hasDXFData = computed(() => {
  return props.dxfData && props.dxfData.entities && props.dxfData.entities.length > 0;
});

const handleResetView = () => {
  resetView();
  emit("reset-view");
};

const loadDXFFromText = (dxfText: string) => {
  try {
    const dxf = parseDXF(dxfText);
    const unsupportedEntities = displayDXF(dxf);
    emit("dxf-loaded", true);
    emit("dxf-data", dxf);

    // Передаем неподдерживаемые entity наружу
    if (unsupportedEntities && unsupportedEntities.length > 0) {
      emit("unsupported-entities", unsupportedEntities);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error loading DXF";
    emit("error", errorMsg);
    emit("dxf-loaded", false);
    emit("dxf-data", null);
  }
};

const loadDXFFromData = (dxfData: DxfData) => {
  try {
    const unsupportedEntities = displayDXF(dxfData);
    emit("dxf-loaded", true);
    emit("dxf-data", dxfData);

    // Передаем неподдерживаемые entity наружу
    if (unsupportedEntities && unsupportedEntities.length > 0) {
      emit("unsupported-entities", unsupportedEntities);
    }
  } catch (error) {
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
    if (newData && hasDXFData.value) {
      loadDXFFromData(newData);
    }
  },
  { deep: true }
);

watch(rendererError, (newError) => {
  if (newError) {
    emit("error", newError);
  }
});

let resizeObserver: ResizeObserver | null = null;
let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

const debouncedResize = () => {
  if (resizeTimeout) {
    clearTimeout(resizeTimeout);
  }

  resizeTimeout = setTimeout(() => {
    resize();
  }, DEBOUNCE_DELAY);
};

onMounted(() => {
  setTimeout(() => {
    if (dxfContainer.value) {
      initThreeJS(dxfContainer.value, { enableControls: true });

      if (props.dxfData && hasDXFData.value) {
        loadDXFFromData(props.dxfData);
      }

      resizeObserver = new ResizeObserver(() => {
        debouncedResize();
      });
      resizeObserver.observe(dxfContainer.value);
    }
  }, 100);
});

onBeforeUnmount(() => {
  if (resizeTimeout) {
    clearTimeout(resizeTimeout);
    resizeTimeout = null;
  }

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
  background-color: var(--bg-color);
  border: 2px solid var(--border-color);
  border-radius: var(--border-radius);
  overflow: hidden;
}

.file-name-overlay {
  position: absolute;
  top: var(--spacing-sm);
  left: var(--spacing-sm);
  z-index: 10;
  padding: var(--spacing-sm) var(--spacing-md);
  background-color: rgba(255, 255, 255, 0.95);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  font-size: 14px;
  color: var(--text-color);
  max-width: calc(100% - var(--spacing-lg) * 2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reset-button-overlay {
  position: absolute;
  top: var(--spacing-sm);
  right: var(--spacing-sm);
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-sm);
  color: var(--text-color);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  font-weight: 500;
  font-size: 14px;
  transition: all 0.2s;
  user-select: none;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  background-color: rgba(255, 255, 255, 0.95);
  cursor: pointer;
}

.reset-button-overlay:hover {
  border-color: rgb(from var(--primary-color) r g b / 0.5);
}

.reset-button-overlay:active {
  transform: scale(0.94);
}

.dxf-viewer :deep(canvas) {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
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
  padding: var(--spacing-lg);
}

.message-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-md);
  text-align: center;
}

.message-content.error svg {
  color: var(--error-color);
}

.message-content.placeholder svg {
  color: var(--border-color);
}

.message-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-color);
}

.message-text {
  font-size: 1rem;
  color: var(--text-secondary);
  max-width: 300px;
}

@media (max-width: 768px) {
  .file-name-overlay {
    top: var(--spacing-sm);
    left: var(--spacing-sm);
    padding: 6px var(--spacing-sm);
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
