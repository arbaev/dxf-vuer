<template>
  <div class="app">
    <header class="app-header">
      <h1>DXF Vuer</h1>
      <p>Легковесный просмотрщик DXF файлов</p>
    </header>

    <main class="app-main">
      <!-- Загрузка файла -->
      <FileUploader @file-selected="handleFileSelected" @file-cleared="handleFileCleared" />

      <!-- Список неподдерживаемых entity -->
      <UnsupportedEntities v-if="unsupportedEntities.length > 0" :entities="unsupportedEntities" />

      <!-- DXF Viewer -->
      <div class="viewer-container">
        <DXFViewer
          ref="dxfViewerRef"
          :dxf-data="dxfData"
          @dxf-data="handleDXFData"
          @unsupported-entities="handleUnsupportedEntities"
          @error="handleError"
          @dxf-loaded="handleDXFLoaded"
        />
      </div>

      <!-- Управление просмотром -->
      <ViewControls v-if="dxfData" @reset-view="resetView" />

      <!-- Ошибки -->
      <div v-if="error" class="error-message">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>{{ error }}</span>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import FileUploader from "./components/FileUploader.vue";
import UnsupportedEntities from "./components/UnsupportedEntities.vue";
import DXFViewer from "./components/DXFViewer.vue";
import ViewControls from "./components/ViewControls.vue";
import type { DxfData } from "./types/dxf";

const dxfData = ref<DxfData | null>(null);
const unsupportedEntities = ref<string[]>([]);
const error = ref<string | null>(null);
const dxfViewerRef = ref<InstanceType<typeof DXFViewer> | null>(null);

const handleFileSelected = async (file: File) => {
  try {
    error.value = null;
    unsupportedEntities.value = [];

    const text = await file.text();

    // Парсинг и отображение происходит внутри DXFViewer
    // через exposed метод loadDXFFromText
    if (dxfViewerRef.value) {
      dxfViewerRef.value.loadDXFFromText(text);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Ошибка загрузки файла";
    dxfData.value = null;
    unsupportedEntities.value = [];
  }
};

const handleFileCleared = () => {
  dxfData.value = null;
  unsupportedEntities.value = [];
  error.value = null;
};

const handleUnsupportedEntities = (entities: string[]) => {
  unsupportedEntities.value = entities;
};

const handleError = (errorMsg: string) => {
  error.value = errorMsg;
};

const handleDXFLoaded = (success: boolean) => {
  if (!success) {
    dxfData.value = null;
  }
};

const handleDXFData = (data: DxfData | null) => {
  dxfData.value = data;
};

const resetView = () => {
  if (dxfViewerRef.value) {
    dxfViewerRef.value.resetView();
  }
};
</script>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-header {
  background: linear-gradient(135deg, var(--primary-color) 0%, #1565c0 100%);
  color: white;
  padding: var(--spacing-lg);
  text-align: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.app-header h1 {
  margin: 0;
  font-size: 2rem;
  font-weight: 600;
  letter-spacing: -0.5px;
}

.app-header p {
  margin: var(--spacing-sm) 0 0;
  opacity: 0.95;
  font-size: 1rem;
  font-weight: 400;
}

.app-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: var(--spacing-lg);
  max-width: 1400px;
  width: 100%;
  margin: 0 auto;
}

.viewer-container {
  flex: 1;
  display: flex;
  min-height: 500px;
  margin: 0 var(--spacing-md);
}

.error-message {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin: var(--spacing-md);
  padding: var(--spacing-md);
  background-color: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
  border-radius: var(--border-radius);
  font-size: 14px;
}

.error-message svg {
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .app-header h1 {
    font-size: 1.5rem;
  }

  .app-header p {
    font-size: 0.9rem;
  }

  .app-main {
    padding: var(--spacing-md);
  }

  .viewer-container {
    min-height: 350px;
    margin: 0;
  }
}
</style>
