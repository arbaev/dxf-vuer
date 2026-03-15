<template>
  <div class="app" :class="{ dark: isDark }">
    <header class="app-header">
      <a href="/" class="app-logo">DXF Vuer</a>

      <FileUploader @file-selected="handleFileSelected" />

      <button
        class="theme-toggle"
        @click="isDark = !isDark"
        :title="isDark ? 'Light mode' : 'Dark mode'"
        :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
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
        <div class="hero-install-wrapper">
          <code class="hero-install">npm install dxf-vuer dxf-render three</code>
          <button class="copy-btn" aria-label="Copy install command" @click="copyInstallCommand">
            <svg
              v-if="!copied"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <svg
              v-else
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        </div>
        <div class="hero-stats">
          <div class="hero-stat">
            <span class="hero-stat-value">21</span>
            <span class="hero-stat-label">entity types</span>
          </div>
          <div class="hero-stat-divider" />
          <div class="hero-stat">
            <span class="hero-stat-value">−78%</span>
            <span class="hero-stat-label">draw calls</span>
          </div>
          <div class="hero-stat-divider" />
          <div class="hero-stat">
            <span class="hero-stat-value">874</span>
            <span class="hero-stat-label">tests</span>
          </div>
          <div class="hero-stat-divider" />
          <div class="hero-stat">
            <span class="hero-stat-value">Web Worker</span>
            <span class="hero-stat-label">parsing</span>
          </div>
        </div>
        <div class="hero-cta">
          <button class="cta-btn cta-btn--primary" @click="scrollToViewer">Try it now</button>
          <a
            class="cta-btn cta-btn--secondary"
            href="https://github.com/arbaev/dxf-kit"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"
              />
            </svg>
            GitHub
          </a>
        </div>
      </section>

      <div class="sample-buttons">
        <span class="sample-label">Examples:</span>
        <button
          v-for="sample in samples"
          :key="sample.file"
          class="sample-btn"
          :class="{
            active: currentFileName === sample.label,
            loading: loadingSampleFile === sample.file,
          }"
          :disabled="isLoadingSample"
          :aria-label="`Load sample: ${sample.label} (${sample.size})`"
          @click="loadSample(sample)"
        >
          <span v-if="loadingSampleFile === sample.file" class="sample-spinner" />
          {{ sample.label }}
          <span class="sample-hint" :class="{ 'sample-hint--heavy': sample.heavy }">{{
            sample.size
          }}</span>
        </button>
      </div>

      <p class="controls-hint">
        {{ isTouchDevice ? "Pinch to zoom · Drag to pan" : "Scroll to zoom · Drag to pan" }}
      </p>

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

      <div id="viewer" class="viewer-container">
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
        <div v-for="feature in features" :key="feature.title" class="feature-card">
          <div class="feature-icon" v-html="feature.icon" />
          <h3>{{ feature.title }}</h3>
          <p v-html="feature.body" />
        </div>
      </section>

      <section class="whats-new">
        <h2>What's New</h2>
        <div class="whats-new-list">
          <div v-for="item in whatsNew" :key="item.text" class="whats-new-item">
            <span class="whats-new-version">{{ item.version }}</span>
            <span class="whats-new-text">{{ item.text }}</span>
          </div>
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

const isDark = ref(window.matchMedia("(prefers-color-scheme: dark)").matches);
const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

function scrollToViewer() {
  document.getElementById("viewer")?.scrollIntoView({ behavior: "smooth" });
}
const copied = ref(false);

async function copyInstallCommand() {
  try {
    await navigator.clipboard.writeText("npm install dxf-vuer dxf-render three");
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    // Fallback for older browsers
    const el = document.createElement("textarea");
    el.value = "npm install dxf-vuer dxf-render three";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  }
}
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

const features = [
  {
    title: "Built-in Parser",
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    body: "Custom DXF parser with zero external dependencies. 21 entity types including dimensions, hatches, splines, multilines, construction lines, and block attributes. Async parsing in a Web Worker keeps the UI responsive.",
  },
  {
    title: "Vector Text",
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
    body: "Crisp text at any zoom level via opentype.js triangulated glyphs. Sans and serif fonts, bold and italic, stacked fractions, MTEXT formatting. Custom font loading supported.",
  },
  {
    title: "WebGL Rendering",
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    body: "Three.js-powered rendering with TAA anti-aliasing, pan, zoom, layer visibility, instant dark theme switching, drag-and-drop, and PNG export.",
  },
  {
    title: "High Performance",
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    body: "Geometry merging cuts draw calls by 78%. Block template caching, time-sliced rendering with progress bar. Text batched as geometry with all other entities.",
  },
  {
    title: "21 Entity Types",
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    body: "Lines, arcs, splines, multilines, construction lines, hatches with 25 AutoCAD patterns, architectural dimensions, block inserts with attributes, leader/multileader. Variable-width polylines with per-vertex tapering, arrows, and donuts. Linetypes, OCS transforms, and paper space filtering.",
  },
  {
    title: "Framework Flexible",
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    body: 'Vue 3 component via dxf-vuer, or use <a href="https://www.npmjs.com/package/dxf-render" target="_blank" rel="noopener noreferrer">dxf-render</a> standalone with React, Svelte, or vanilla JS. Parser-only mode for Node.js. Full TypeScript support.',
  },
];

const whatsNew = [
  {
    version: "1.2.0",
    text: "Variable-width polylines with per-vertex tapering, arrows, and donuts",
  },
  {
    version: "1.2.0",
    text: "GIS origin translation — large UTM/state plane coordinates without precision loss",
  },
  { version: "1.2.0", text: "Touch support — native one-finger pan on mobile devices" },
  { version: "1.1.0", text: "Theme-adaptive ACI 250-251 colors — dark grays invert in dark mode" },
  {
    version: "1.5.0",
    text: "TAA anti-aliasing — 32-frame temporal accumulation for crisp text and edges",
  },
  { version: "1.5.0", text: "Instant dark mode — theme switching without full re-render" },
  { version: "1.4.0", text: "MLINE, XLINE, RAY entities — multilines and construction lines" },
  {
    version: "1.4.0",
    text: "25 built-in hatch patterns with solid fill optimization (86× faster)",
  },
];

const STACKBLITZ_BASE = "https://stackblitz.com/github/arbaev/dxf-kit/tree/main/examples";

const examples = [
  {
    title: "Vanilla TypeScript",
    description:
      "Minimal setup with dxf-render and Three.js — parse, render, and display a DXF file.",
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
    description:
      "Drop-in DXF viewer using the dxf-vuer component — dark theme, layers, and export.",
    url: `${STACKBLITZ_BASE}/vue?file=src/App.vue&title=dxf-vuer+Vue+3`,
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3l10 19L22 3"/><path d="M6.5 3L12 14.5 17.5 3"/></svg>',
  },
  {
    title: "Leaflet + DXF",
    description:
      "Overlay DXF on OpenStreetMap with geo-referencing — parser-only, no Three.js. Includes Florence city center sample.",
    url: `${STACKBLITZ_BASE}/leaflet-dxf?file=src/main.ts&title=dxf-render+Leaflet`,
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>',
  },
  {
    title: "DXF to PDF",
    description:
      "Export DXF drawings to PDF — offscreen Three.js rendering with page size and orientation options.",
    url: `${STACKBLITZ_BASE}/dxf-to-pdf?file=src/main.ts&title=dxf-render+PDF+Export`,
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  },
];

const samples = [
  { file: "/entities.dxf", label: "Basic Entities", size: "191 KB" },
  { file: "/samples/linetypes.dxf", label: "Line Types & Widths", size: "3 KB" },
  { file: "/samples/electric.dxf", label: "Electric Schematic", size: "220 KB" },
  { file: "/samples/hatch-patterns.dxf", label: "Hatch Patterns", size: "164 KB" },
  { file: "/samples/floorplan.dxf", label: "Floor Plan", size: "1.1 MB" },
  { file: "/samples/house-plan.dxf", label: "House Plan", size: "17 MB", heavy: true },
];

async function loadSample(sample: { file: string; label: string; size: string; heavy?: boolean }) {
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
  padding: 3rem var(--spacing-lg) 3rem;
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

.hero-install-wrapper {
  display: inline-flex;
  align-items: center;
  gap: 0;
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  background-color: #f5f5f5;
  overflow: hidden;
  margin: var(--spacing-sm) 0;
}

.hero-install {
  display: inline-block;
  padding: var(--spacing-sm) var(--spacing-md);
  background-color: transparent;
  border: none;
  font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
  font-size: 0.9rem;
  color: var(--text-color);
  user-select: all;
}

.copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-sm) 10px;
  background: transparent;
  border: none;
  border-left: 1px solid var(--border-color);
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    color 0.15s,
    background-color 0.15s;
}

.copy-btn:hover {
  color: var(--primary-color);
  background-color: rgba(74, 144, 217, 0.08);
}

.copy-btn svg {
  flex-shrink: 0;
}

.hero-cta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-md);
}

.cta-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 24px;
  border-radius: var(--border-radius);
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  text-decoration: none;
  border: none;
}

.cta-btn--primary {
  background: var(--primary-color);
  color: white;
}

.cta-btn--primary:hover {
  background: #3a7bc8;
}

.cta-btn--secondary {
  background: transparent;
  color: var(--text-color);
  border: 1px solid var(--border-color);
}

.cta-btn--secondary:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.cta-btn:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

.hero-stats {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-md);
  margin-top: var(--spacing-lg);
  margin-bottom: var(--spacing-lg);
}

.hero-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.hero-stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--primary-color);
  line-height: 1;
  white-space: nowrap;
}

.hero-stat-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.hero-stat-divider {
  width: 1px;
  height: 32px;
  background: var(--border-color);
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

.feature-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: #f0f4ff;
  color: var(--primary-color);
  margin-bottom: var(--spacing-sm);
}

.whats-new {
  max-width: var(--content-max-width);
  margin: var(--spacing-lg) auto 0;
  text-align: center;
}

.whats-new h2 {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-color);
  margin-bottom: var(--spacing-md);
}

.whats-new-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
}

.whats-new-item {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-sm);
  padding: 6px 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.whats-new-version {
  flex-shrink: 0;
  font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--primary-color);
  background: #f0f4ff;
  padding: 2px 8px;
  border-radius: 4px;
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
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
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
  to {
    transform: rotate(360deg);
  }
}

.sample-hint {
  font-size: 0.6875rem;
  opacity: 0.6;
  margin-left: 4px;
}

.sample-hint--heavy {
  color: #d32f2f;
  opacity: 1;
  font-weight: 600;
}

.sample-btn.active .sample-hint--heavy {
  color: #ffcdd2;
}

.controls-hint {
  text-align: center;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  opacity: 0.7;
  margin: 0 0 var(--spacing-sm);
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

/* Focus visible */
.theme-toggle:focus-visible,
.copy-btn:focus-visible,
.sample-btn:focus-visible,
.example-card:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
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

.app.dark .hero-install-wrapper {
  background-color: #1e1e1e;
  border-color: #444;
}

.app.dark .copy-btn {
  border-left-color: #444;
}

.app.dark .cta-btn--secondary {
  border-color: #444;
}

.app.dark .cta-btn--secondary:hover {
  border-color: #6b8fd4;
  color: #6b8fd4;
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

.app.dark .whats-new-version {
  background: #1a2744;
  color: #6b8fd4;
}

.app.dark .feature-icon {
  background: #1a2744;
  color: #6b8fd4;
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
