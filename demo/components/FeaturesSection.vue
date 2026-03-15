<template>
  <section class="features">
    <div v-for="feature in features" :key="feature.title" class="feature-card">
      <div class="feature-icon" v-html="feature.icon" />
      <h3>{{ feature.title }}</h3>
      <p v-html="feature.body" />
    </div>
  </section>
</template>

<script setup lang="ts">
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
</script>

<style scoped>
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
  border: none;
  border-radius: var(--border-radius);
  background: transparent;
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
  background: var(--accent-bg, #f0f4ff);
  color: var(--primary-color);
  margin-bottom: var(--spacing-sm);
}

@media (max-width: 768px) {
  .features {
    grid-template-columns: 1fr;
  }
}
</style>
