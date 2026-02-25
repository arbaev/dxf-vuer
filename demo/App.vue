<template>
  <div class="app">
    <header class="app-header">
      <a href="/" class="app-logo">DXF Vuer</a>

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
      <section class="hero">
        <h1>DXF Viewer for Vue 3</h1>
        <p class="hero-subtitle">
          View AutoCAD DXF drawings in the browser. Built-in parser,
          Three.js rendering, TypeScript-ready.
        </p>
        <code class="hero-install">npm install dxf-vuer three</code>
      </section>

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

      <section class="features">
        <div class="feature-card">
          <h3>Built-in Parser</h3>
          <p>Custom DXF parser with zero external dependencies.
            16 entity types including dimensions, hatches, and splines.</p>
        </div>
        <div class="feature-card">
          <h3>WebGL Rendering</h3>
          <p>Three.js-powered rendering with pan, zoom, layer visibility,
            and AutoCAD Color Index support.</p>
        </div>
        <div class="feature-card">
          <h3>Framework Flexible</h3>
          <p>Vue 3 component or standalone parser via dxf-vuer/parser.
            Works in Node.js, React, or any JS runtime.</p>
        </div>
        <div class="feature-card">
          <h3>Lightweight</h3>
          <p>~75 KB main bundle, ~40 KB parser.
            Tree-shakeable composables for custom builds.</p>
        </div>
      </section>

      <footer class="app-footer">
        MIT License &middot;
        <a href="https://www.npmjs.com/package/dxf-vuer" target="_blank" rel="noopener noreferrer">npm</a> &middot;
        <a href="https://github.com/arbaev/dxf-vuer" target="_blank" rel="noopener noreferrer">GitHub</a>
      </footer>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from "vue";
import FileUploader from "@/components/FileUploader.vue";
import UnsupportedEntities from "@/components/UnsupportedEntities.vue";
import DXFViewer from "@/components/DXFViewer.vue";
import type { DxfData } from "@/types/dxf";

const dxfData = ref<DxfData | null>(null);
const unsupportedEntities = ref<string[]>([]);
const error = ref<string | null>(null);
const currentFileName = ref<string>("");
const dxfViewerRef = ref<InstanceType<typeof DXFViewer> | null>(null);

onMounted(async () => {
  await nextTick();
  try {
    const response = await fetch("/entities.dxf");
    const text = await response.text();
    currentFileName.value = "entities.dxf";
    if (dxfViewerRef.value) {
      dxfViewerRef.value.loadDXFFromText(text);
    }
  } catch {
    // Sample file not available — ignore
  }
});

const handleFileSelected = async (file: File) => {
  try {
    error.value = null;
    unsupportedEntities.value = [];
    currentFileName.value = file.name;

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
  text-decoration: none;
  color: inherit;
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
}

.viewer-container {
  display: flex;
  height: 500px;
  max-width: var(--content-max-width);
  width: 100%;
  margin: 0 auto;
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  overflow: hidden;
}

.hero {
  text-align: center;
  padding: var(--spacing-lg) var(--spacing-lg) var(--spacing-md);
  max-width: var(--content-max-width);
  margin: 0 auto;
}

.hero h1 {
  font-size: 2rem;
  font-weight: 700;
  color: var(--text-color);
  margin-bottom: var(--spacing-sm);
}

.hero-subtitle {
  font-size: 1.125rem;
  color: var(--text-secondary);
  max-width: 600px;
  margin: 0 auto var(--spacing-md);
  line-height: 1.6;
}

.hero-install {
  display: inline-block;
  padding: var(--spacing-sm) var(--spacing-md);
  background-color: #f5f5f5;
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
  font-size: 0.9rem;
  color: var(--text-color);
  user-select: all;
}

.features {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--spacing-md);
  max-width: var(--content-max-width);
  margin: var(--spacing-lg) auto 0;
  padding: 0;
}

.feature-card {
  padding: var(--spacing-lg);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  background: white;
}

.feature-card h3 {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: var(--spacing-sm);
  color: var(--text-color);
}

.feature-card p {
  font-size: 0.875rem;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0;
}

.app-footer {
  text-align: center;
  padding: var(--spacing-lg);
  color: var(--text-secondary);
  font-size: 0.8125rem;
}

.app-footer a {
  color: var(--primary-color);
  text-decoration: none;
}

.app-footer a:hover {
  text-decoration: underline;
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
  }

  .hero h1 {
    font-size: 1.5rem;
  }

  .hero-subtitle {
    font-size: 1rem;
  }

  .viewer-container {
    height: 350px;
  }

  .features {
    grid-template-columns: 1fr;
  }
}
</style>
