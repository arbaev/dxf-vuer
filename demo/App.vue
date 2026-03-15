<template>
  <div class="app" :class="{ dark: isDark }">
    <div class="top-actions">
      <a
        class="top-action-btn"
        href="https://github.com/arbaev/dxf-kit"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="View on GitHub"
        title="View on GitHub"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"
          />
        </svg>
      </a>
      <button
        class="top-action-btn"
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
    </div>

    <main class="app-main">
      <section class="hero">
        <span class="hero-brand">dxf-render</span>
        <h1>Render AutoCAD DXF Drawings in&nbsp;the&nbsp;Browser</h1>
        <p class="hero-subtitle">
          TypeScript DXF parser and Three.js WebGL renderer. Use standalone with React, Svelte, or
          vanilla JS — or as a drop-in Vue&nbsp;3 component.
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
      </section>

      <div class="upload-area">
        <FileUploader @file-selected="handleFileSelected" />
      </div>

      <div class="sample-buttons">
        <span class="sample-label">or try built-in samples:</span>
        <div class="sample-list">
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

      <FeaturesSection />
      <WhatsNewSection />
      <ExamplesSection />

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
import FeaturesSection from "./components/FeaturesSection.vue";
import WhatsNewSection from "./components/WhatsNewSection.vue";
import ExamplesSection from "./components/ExamplesSection.vue";

const isDark = ref(window.matchMedia("(prefers-color-scheme: dark)").matches);
const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

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
  position: relative;
}

.top-actions {
  position: fixed;
  top: var(--spacing-md);
  right: var(--spacing-md);
  z-index: 100;
  display: flex;
  gap: 8px;
}

.top-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  color: var(--text-secondary);
  width: 36px;
  height: 36px;
  padding: 0;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  text-decoration: none;
}

.top-action-btn:hover {
  color: var(--primary-color);
  border-color: var(--primary-color);
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

.hero-brand {
  display: inline-block;
  font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--primary-color);
  background: #f0f4ff;
  padding: 4px 12px;
  border-radius: 999px;
  margin-bottom: var(--spacing-md);
  letter-spacing: 0.5px;
}

.hero h1 {
  font-size: 2.5rem;
  font-weight: 800;
  color: var(--text-color);
  margin-bottom: var(--spacing-sm);
  letter-spacing: -0.5px;
  line-height: 1.15;
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

.upload-area {
  display: flex;
  justify-content: center;
  margin-bottom: var(--spacing-sm);
}

.upload-area :deep(.file-uploader) {
  max-width: none;
  flex: none;
}

.upload-area :deep(.file-button) {
  background: var(--primary-color);
  color: white;
  border: none;
  padding: 12px 32px;
  font-size: 1rem;
  font-weight: 600;
  border-radius: var(--border-radius);
  box-shadow: 0 2px 8px rgba(74, 144, 217, 0.3);
  backdrop-filter: none;
}

.upload-area :deep(.file-button:hover) {
  background: #3a7bc8;
  box-shadow: 0 4px 12px rgba(74, 144, 217, 0.4);
}

.sample-buttons {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-bottom: var(--spacing-md);
}

.sample-label {
  color: var(--text-secondary);
  font-size: 0.8125rem;
}

.sample-list {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
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
  .app-main {
    padding: var(--spacing-md);
  }

  .hero {
    padding: 2rem var(--spacing-md) 1.5rem;
  }

  .hero h1 {
    font-size: 1.75rem;
  }

  .hero-subtitle {
    font-size: 1rem;
  }

  .hero-stats {
    gap: var(--spacing-sm);
  }

  .hero-stat-value {
    font-size: 1.25rem;
  }

  .viewer-container {
    height: 50vh;
  }
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* Focus visible */
.top-action-btn:focus-visible,
.copy-btn:focus-visible,
.sample-btn:focus-visible {
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

.app.dark .top-action-btn {
  background: #1e1e1e;
  border-color: #444;
  color: #999;
}

.app.dark .top-action-btn:hover {
  color: #6b8fd4;
  border-color: #6b8fd4;
}

.app.dark .hero-brand {
  background: #1a2744;
  color: #6b8fd4;
}

.app.dark .hero-install-wrapper {
  background-color: #1e1e1e;
  border-color: #444;
}

.app.dark .copy-btn {
  border-left-color: #444;
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

.app.dark .app-footer a {
  color: #6b8fd4;
}
</style>
