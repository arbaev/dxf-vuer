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
        <h1>Typescript DXF Parser &amp; Renderer</h1>
        <p class="hero-subtitle">
          Parse and render AutoCAD DXF files with Three.js. Use standalone with any framework or as
          a ready-made Vue 3 component.
        </p>
        <code class="hero-install">npm install dxf-vuer dxf-render three</code>
      </section>

      <div class="sample-buttons">
        <span class="sample-label">Examples:</span>
        <button
          v-for="sample in samples"
          :key="sample.file"
          class="sample-btn"
          :class="{ active: currentFileName === sample.label, loading: loadingSampleFile === sample.file }"
          :disabled="isLoadingSample"
          @click="loadSample(sample)"
        >
          <span v-if="loadingSampleFile === sample.file" class="sample-spinner" />
          {{ sample.label }}
          <span v-if="sample.hint" class="sample-hint">{{ sample.hint }}</span>
        </button>
      </div>

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
            Three.js-powered rendering with TAA anti-aliasing, pan, zoom, layer visibility, instant
            dark theme switching, drag-and-drop, and PNG export.
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
            Vue 3 component via dxf-vuer, or use
            <a
              href="https://www.npmjs.com/package/dxf-render"
              target="_blank"
              rel="noopener noreferrer"
              >dxf-render</a
            >
            standalone with React, Svelte, or vanilla JS. Parser-only mode for Node.js. Full
            TypeScript support.
          </p>
        </div>
      </section>

      <section class="examples">
        <h2>Examples</h2>
        <p class="examples-subtitle">
          Try interactive examples on StackBlitz — no installation required.
        </p>
        <div class="examples-grid">
          <a
            v-for="example in examples"
            :key="example.title"
            :href="example.url"
            target="_blank"
            rel="noopener noreferrer"
            class="example-card"
          >
            <span class="example-icon" v-html="example.icon" />
            <div>
              <h3>{{ example.title }}</h3>
              <p>{{ example.description }}</p>
            </div>
          </a>
        </div>
      </section>

      <footer class="app-footer">
        MIT License &middot;
        <a href="https://www.npmjs.com/package/dxf-render" target="_blank" rel="noopener noreferrer"
          >dxf-render</a
        >
        &middot;
        <a href="https://www.npmjs.com/package/dxf-vuer" target="_blank" rel="noopener noreferrer"
          >dxf-vuer</a
        >
        &middot;
        <a href="https://github.com/arbaev/dxf-kit" target="_blank" rel="noopener noreferrer"
          >GitHub</a
        >
      </footer>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from "vue";
import { FileUploader, UnsupportedEntities, DXFViewer } from "dxf-vuer";
import "dxf-vuer/style.css";
import type { DxfData } from "dxf-render";

const isDark = ref(false);
watch(isDark, (dark) => {
  document.body.style.backgroundColor = dark ? "#121212" : "";
});
const dxfData = ref<DxfData | null>(null);
const unsupportedEntities = ref<string[]>([]);
const error = ref<string | null>(null);
const currentFileName = ref<string>("");
const dxfViewerRef = ref<InstanceType<typeof DXFViewer> | null>(null);
const isLoadingSample = ref(false);
const loadingSampleFile = ref<string | null>(null);

const STACKBLITZ_BASE = "https://stackblitz.com/github/arbaev/dxf-kit/tree/main/examples";

const examples = [
  {
    title: "Vanilla TypeScript",
    description: "Minimal setup with dxf-render and Three.js — parse, render, and display a DXF file.",
    url: `${STACKBLITZ_BASE}/vanilla-ts?file=src/main.ts&title=dxf-render+Vanilla+TS`,
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
  },
  {
    title: "React",
    description: "DXF viewer as a React component with useEffect, useRef, and Three.js rendering.",
    url: `${STACKBLITZ_BASE}/react?file=src/DxfViewer.tsx&title=dxf-render+React`,
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="2"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/></svg>',
  },
  {
    title: "Vue 3",
    description: "Drop-in DXF viewer using the dxf-vuer component — dark theme, layers, and export.",
    url: `${STACKBLITZ_BASE}/vue?file=src/App.vue&title=dxf-vuer+Vue+3`,
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3l10 19L22 3"/><path d="M6.5 3L12 14.5 17.5 3"/></svg>',
  },
  {
    title: "Leaflet + DXF",
    description: "Overlay DXF on OpenStreetMap with geo-referencing — parser-only, no Three.js. Includes Florence city center sample.",
    url: `${STACKBLITZ_BASE}/leaflet-dxf?file=src/main.ts&title=dxf-render+Leaflet`,
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>',
  },
  {
    title: "DXF to PDF",
    description: "Export DXF drawings to PDF — offscreen Three.js rendering with page size and orientation options.",
    url: `${STACKBLITZ_BASE}/dxf-to-pdf?file=src/main.ts&title=dxf-render+PDF+Export`,
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  },
];

const samples = [
  { file: "/entities.dxf", label: "Basic Entities" },
  { file: "/samples/linetypes.dxf", label: "Linetypes" },
  { file: "/samples/electric.dxf", label: "Electric Schematic" },
  { file: "/samples/hatch-patterns.dxf", label: "Hatch Patterns" },
  { file: "/samples/floorplan.dxf", label: "Floor Plan" },
  { file: "/samples/house-plan.dxf", label: "House Plan", hint: "17 MB" },
];

async function loadSample(sample: { file: string; label: string }) {
  if (isLoadingSample.value) return;
  isLoadingSample.value = true;
  loadingSampleFile.value = sample.file;
  error.value = null;
  unsupportedEntities.value = [];
  try {
    const response = await fetch(sample.file);
    const text = await response.text();
    currentFileName.value = sample.label;
    loadingSampleFile.value = null;
    if (dxfViewerRef.value) {
      dxfViewerRef.value.loadDXFFromText(text);
    }
  } catch {
    error.value = `Failed to load ${sample.label}`;
  } finally {
    isLoadingSample.value = false;
    loadingSampleFile.value = null;
  }
}

onMounted(async () => {
  await nextTick();
  loadSample(samples[0]);
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

.examples {
  max-width: var(--content-max-width);
  margin: var(--spacing-lg) auto 0;
  text-align: center;
}

.examples h2 {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-color);
  margin-bottom: var(--spacing-sm);
}

.examples-subtitle {
  color: var(--text-secondary);
  margin-bottom: var(--spacing-md);
}

.examples-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--spacing-md);
  text-align: left;
}

.example-card {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-md) var(--spacing-lg);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  background: white;
  text-decoration: none;
  color: inherit;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  transition: border-color 0.15s, box-shadow 0.15s;
}

.example-card:hover {
  border-color: var(--primary-color);
  box-shadow: 0 3px 12px rgba(74, 144, 217, 0.15);
}

.example-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: #f0f4ff;
  color: var(--primary-color);
}

.example-card h3 {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 2px;
}

.example-card p {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.5;
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

.sample-buttons {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: var(--spacing-md);
  flex-wrap: wrap;
}

.sample-label {
  color: var(--text-secondary);
  font-weight: 500;
}

.sample-btn {
  padding: 6px 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  background: white;
  color: var(--text-color);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.sample-btn:hover:not(:disabled):not(.active) {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.sample-btn.active {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: white;
}

.sample-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sample-btn.loading {
  opacity: 0.7;
}

.sample-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  vertical-align: middle;
  margin-right: 4px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.sample-hint {
  font-size: 0.6875rem;
  opacity: 0.6;
  margin-left: 4px;
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

  .examples-grid {
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

.app.dark .sample-btn {
  background: #1e1e1e;
  border-color: #444;
}

.app.dark .sample-btn:hover:not(:disabled) {
  border-color: #6b8fd4;
  color: #6b8fd4;
}

.app.dark .sample-btn.active {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: white;
}

.app.dark .viewer-container {
  border-color: #333;
}

.app.dark .error-message {
  background-color: #3a1c1e;
  color: #f5a0a5;
  border-color: #5c2b2e;
}

.app.dark .example-card {
  background: #1e1e1e;
  border-color: #333;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}

.app.dark .example-card:hover {
  border-color: #6b8fd4;
  box-shadow: 0 3px 12px rgba(107, 143, 212, 0.2);
}

.app.dark .example-icon {
  background: #1a2744;
  color: #6b8fd4;
}

.app.dark .app-footer a {
  color: #6b8fd4;
}
</style>
