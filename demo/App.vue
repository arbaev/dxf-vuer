<template>
  <div class="app" :class="{ dark: isDark }">
    <header class="app-header">
      <a href="/" class="app-logo">DXF Vuer</a>

      <FileUploader @file-selected="handleFileSelected" />

      <button
        class="theme-toggle"
        @click="isDark = !isDark"
        :title="isDark ? 'Light mode' : 'Dark mode'"
      >
        <svg
          v-if="isDark"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
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
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </button>
    </header>

    <main class="app-main">
      <section class="hero">
        <h1>DXF Viewer for Vue 3</h1>
        <p class="hero-subtitle">
          View AutoCAD DXF drawings in the browser. Built-in parser, Three.js rendering,
          TypeScript-ready.
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
          :show-coordinates="true"
          :show-export-button="true"
          :allow-drop="true"
          :dark-theme="isDark"
          @dxf-data="handleDXFData"
          @unsupported-entities="handleUnsupportedEntities"
          @error="handleError"
          @dxf-loaded="handleDXFLoaded"
          @reset-view="resetView"
          @file-dropped="(name: string) => (currentFileName = name)"
        />
      </div>

      <section class="features">
        <div class="feature-card">
          <h3>Built-in Parser</h3>
          <p>
            Custom DXF parser with zero external dependencies. 21 entity types including dimensions,
            hatches, splines, multilines, construction lines, and block attributes. Async parsing in
            a Web Worker keeps the UI responsive.
          </p>
        </div>
        <div class="feature-card">
          <h3>Vector Text</h3>
          <p>
            Crisp text at any zoom level via opentype.js triangulated glyphs. Sans and serif fonts,
            bold and italic, stacked fractions, MTEXT formatting. Custom font loading supported.
          </p>
        </div>
        <div class="feature-card">
          <h3>WebGL Rendering</h3>
          <p>
            Three.js-powered rendering with pan, zoom, layer visibility, dark theme, drag-and-drop,
            and PNG export.
          </p>
        </div>
        <div class="feature-card">
          <h3>High Performance</h3>
          <p>
            Geometry merging cuts draw calls by 78%. Block template caching, time-sliced rendering
            with progress bar. Text batched as geometry with all other entities.
          </p>
        </div>
        <div class="feature-card">
          <h3>21 Entity Types</h3>
          <p>
            Lines, arcs, splines, multilines, construction lines, hatches with 25 AutoCAD patterns,
            architectural dimensions, block inserts with attributes, leader/multileader. Linetypes,
            OCS transforms, and paper space filtering.
          </p>
        </div>
        <div class="feature-card">
          <h3>Framework Flexible</h3>
          <p>
            Vue 3 component or standalone parser via dxf-vuer/parser. Works in Node.js, React, or
            any JS runtime. Full TypeScript support with composables for custom builds.
          </p>
        </div>
      </section>

      <footer class="app-footer">
        MIT License &middot;
        <a href="https://www.npmjs.com/package/dxf-vuer" target="_blank" rel="noopener noreferrer"
          >npm</a
        >
        &middot;
        <a href="https://github.com/arbaev/dxf-vuer" target="_blank" rel="noopener noreferrer"
          >GitHub</a
        >
      </footer>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from "vue";
import FileUploader from "@/components/FileUploader.vue";
import UnsupportedEntities from "@/components/UnsupportedEntities.vue";
import DXFViewer from "@/components/DXFViewer.vue";
import type { DxfData } from "@/types/dxf";

const isDark = ref(false);
watch(isDark, (dark) => {
  document.body.style.backgroundColor = dark ? "#121212" : "";
});
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

.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: var(--border-radius);
  color: white;
  padding: 6px;
  cursor: pointer;
  transition: background-color 0.2s;
  flex-shrink: 0;
}

.theme-toggle:hover {
  background: rgba(255, 255, 255, 0.25);
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
  height: 70vh;
  width: 100%;
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
    height: 50vh;
  }

  .features {
    grid-template-columns: 1fr;
  }
}

/* Dark theme */
.app.dark {
  --bg-color: #121212;
  --text-color: #e0e0e0;
  --text-secondary: #999;
  --border-color: #333;
  background-color: var(--bg-color);
  color: var(--text-color);
}

.app.dark .hero-install {
  background-color: #1e1e1e;
  border-color: #444;
}

.app.dark .feature-card {
  background: #1e1e1e;
  border-color: #333;
}

.app.dark .viewer-container {
  border-color: #333;
}

.app.dark .error-message {
  background-color: #3a1c1e;
  color: #f5a0a5;
  border-color: #5c2b2e;
}

.app.dark .app-footer a {
  color: #6b8fd4;
}
</style>
