<template>
  <div class="app">
    <header class="app-header">
      <h1 class="app-logo">DXF Vuer</h1>

      <FileUploader @file-selected="handleFileSelected" />

      <a
        href="https://github.com/arbaev/dxf-vuer"
        class="github-link"
        title="GitHub Repo"
        target="_blank"
        rel="noopener noreferrer"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
          />
        </svg>
      </a>
    </header>

    <main class="app-main">
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

      <UnsupportedEntities v-if="unsupportedEntities.length > 0" :entities="unsupportedEntities" />

      <div class="viewer-container">
        <DXFViewer
          ref="dxfViewerRef"
          :dxf-data="dxfData"
          :file-name="currentFileName"
          :show-reset-button="!!dxfData"
          @dxf-data="handleDXFData"
          @unsupported-entities="handleUnsupportedEntities"
          @error="handleError"
          @dxf-loaded="handleDXFLoaded"
          @reset-view="resetView"
        />
      </div>

      <DXFStatistics v-if="statistics" :statistics="statistics" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import FileUploader from "@/components/FileUploader.vue";
import UnsupportedEntities from "@/components/UnsupportedEntities.vue";
import DXFViewer from "@/components/DXFViewer.vue";
import DXFStatistics from "@/components/DXFStatistics.vue";
import type { DxfData, DxfStatistics } from "@/types/dxf";
import { collectDXFStatistics } from "@/utils/dxfStatistics";

const dxfData = ref<DxfData | null>(null);
const unsupportedEntities = ref<string[]>([]);
const error = ref<string | null>(null);
const currentFileName = ref<string>("");
const currentFileSize = ref<number>(0);
const statistics = ref<DxfStatistics | null>(null);
const dxfViewerRef = ref<InstanceType<typeof DXFViewer> | null>(null);

const handleFileSelected = async (file: File) => {
  try {
    error.value = null;
    unsupportedEntities.value = [];
    statistics.value = null;
    currentFileName.value = file.name;
    currentFileSize.value = file.size;

    const text = await file.text();

    // Parsing and display happen inside DXFViewer
    // via the exposed loadDXFFromText method
    if (dxfViewerRef.value) {
      dxfViewerRef.value.loadDXFFromText(text);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Error loading file";
    dxfData.value = null;
    unsupportedEntities.value = [];
    statistics.value = null;
  }
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

  if (data && currentFileName.value) {
    statistics.value = collectDXFStatistics(data, currentFileName.value, currentFileSize.value);
  } else {
    statistics.value = null;
  }
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  background: linear-gradient(135deg, var(--primary-color) 0%, var(--secondary-color) 100%);
  color: white;
  padding: var(--spacing-md) var(--spacing-lg);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.app-logo {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.5px;
  white-space: nowrap;
}

.github-link {
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  opacity: 0.9;
  transition: opacity 0.2s;
  flex-shrink: 0;
}

.github-link:hover {
  opacity: 1;
}

.app-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: var(--spacing-lg);
  width: 100%;
  height: calc(100vh - var(--header-height) - var(--spacing-lg) * 2);
}

.viewer-container {
  flex: 1;
  display: flex;
  margin: 0;
  height: 100%;
}

.error-message {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
  padding: var(--spacing-md);
  background-color: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
  border-radius: var(--border-radius);
  font-size: 14px;
  flex-shrink: 0;
}

.error-message svg {
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .app-header {
    padding: var(--spacing-sm) var(--spacing-md);
  }

  .app-logo {
    font-size: 1.25rem;
  }

  .app-main {
    padding: var(--spacing-md);
    height: calc(100vh - var(--header-height) - var(--spacing-md) * 2);
  }

  .viewer-container {
    margin: 0;
  }
}
</style>
