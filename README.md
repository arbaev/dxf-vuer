# dxf-vuer

[![npm](https://img.shields.io/npm/v/dxf-vuer)](https://www.npmjs.com/package/dxf-vuer)
[![npm downloads](https://img.shields.io/npm/dm/dxf-vuer)](https://www.npmjs.com/package/dxf-vuer)
[![bundle size](https://img.shields.io/bundlephobia/minzip/dxf-vuer)](https://bundlephobia.com/package/dxf-vuer)
[![license](https://img.shields.io/npm/l/dxf-vuer)](https://github.com/arbaev/dxf-vuer/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue)](https://www.typescriptlang.org/)

Vue 3 component for viewing DXF files in the browser. Built-in DXF parser, Three.js rendering, zero external DXF dependencies.

[Live Demo](https://dxf-vuer.netlify.app)

![dxf-vuer screenshot](https://raw.githubusercontent.com/arbaev/dxf-vuer/main/docs/screenshot.png)

## Features

- **21 DXF entity types** rendered: LINE, CIRCLE, ARC, ELLIPSE, SPLINE, POLYLINE, LWPOLYLINE, TEXT, MTEXT, DIMENSION, HATCH, INSERT, SOLID, 3DFACE, LEADER, MULTILEADER, MLINE, XLINE, RAY, ATTDEF, HELIX — plus ATTRIB within INSERT blocks
- **Linetype rendering** — DASHED, HIDDEN, CENTER, PHANTOM, DOT, DASHDOT and other DXF line patterns with entity/layer/block resolution and LTSCALE support
- **Hatch patterns** — 25 built-in AutoCAD patterns (ANSI31–38, BRICK, DOTS, NET, HEX, GOST_* etc.) with scale, angle, dot elements, multi-boundary even-odd clipping
- **OCS support** — Arbitrary Axis Algorithm for correct rendering of mirrored/rotated entities
- **Vector text rendering** — crisp text at any zoom via opentype.js triangulated glyphs; embedded Liberation Sans Regular font with lazy-loaded Liberation Serif; bold, italic, underline, stacked fractions, tab stops, and inline MTEXT formatting; custom font loading via `fontUrl` prop
- **Built-in DXF parser** — no external parser dependencies, custom scanner with full type casting
- **Parser-only entry point** — use `dxf-vuer/parser` in Node.js, React, or any JS/TS project (zero dependencies)
- **TypeScript** — strict types, full `.d.ts` declarations
- **Composables** — build custom viewers with `useDXFRenderer`, `useThreeScene`, `useCamera`, etc.
- **CSS custom properties** — theme with `--dxf-vuer-*` variables, no global resets
- **Dark theme** — `darkTheme` prop switches scene background, entity colors (ACI 7), and all overlays to dark mode
- **Drag-and-drop** — `allowDrop` prop enables dropping DXF files directly onto the viewer
- **Export to PNG** — `exportToPNG()` method and optional toolbar button to save current view
- **Loading by URL** — `url` prop to load DXF files from a remote URL
- **Loading progress** — progress bar with percentage during rendering phase
- **Performance optimizations** — geometry merging (–78% draw calls), block template caching, async parsing in Web Worker, time-sliced rendering with progress bar
- **Layer panel** — toggle layer visibility with color indicators; frozen/locked layer support
- **Paper space filtering** — paper space entities (title blocks, borders) automatically excluded
- **World coordinates** — optional cursor position display in drawing units
- **Fullscreen mode** — built-in fullscreen button in the viewer toolbar
- **Bundle sizes** — ~1000 KB main bundle (includes embedded font + opentype.js), ~49 KB parser-only chunk (zero dependencies), ~525 KB serif font chunk (lazy-loaded only when needed)

## Installation

```bash
npm install dxf-vuer three
# or
yarn add dxf-vuer three
```

Peer dependencies: `vue >= 3.4`, `three >= 0.160`.

## Quick Start

```vue
<script setup>
import { ref } from 'vue'
import { DXFViewer, parseDxf } from 'dxf-vuer'
import 'dxf-vuer/style.css'

const dxfData = ref(null)

async function loadFile(file) {
  const text = await file.text()
  dxfData.value = parseDxf(text)
}
</script>

<template>
  <input type="file" accept=".dxf" @change="loadFile($event.target.files[0])" />
  <DXFViewer
    :dxf-data="dxfData"
    show-reset-button
    style="width: 100%; height: 600px"
  />
</template>
```

Or use the imperative API for better loading UX (shows a spinner):

```vue
<script setup>
import { ref } from 'vue'
import { DXFViewer } from 'dxf-vuer'
import 'dxf-vuer/style.css'

const viewer = ref(null)

async function loadFile(file) {
  const text = await file.text()
  viewer.value.loadDXFFromText(text)
}
</script>

<template>
  <input type="file" accept=".dxf" @change="loadFile($event.target.files[0])" />
  <DXFViewer ref="viewer" show-reset-button style="width: 100%; height: 600px" />
</template>
```

## DXFViewer

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `dxfData` | `DxfData \| null` | `null` | Parsed DXF data to display |
| `fileName` | `string` | `""` | File name shown in the top-left corner |
| `url` | `string` | `""` | URL to load DXF file from |
| `showResetButton` | `boolean` | `false` | Show a reset-view button |
| `showFullscreenButton` | `boolean` | `true` | Show a fullscreen button |
| `showExportButton` | `boolean` | `false` | Show an export-to-PNG button |
| `showFileName` | `boolean` | `true` | Show the file name overlay |
| `showCoordinates` | `boolean` | `false` | Show world coordinates at cursor position |
| `allowDrop` | `boolean` | `false` | Enable drag-and-drop of DXF files onto the viewer |
| `darkTheme` | `boolean` | `false` | Dark theme for scene, entity colors, and overlays |
| `autoFit` | `boolean` | `true` | Auto-fit camera to content |
| `fontUrl` | `string` | `""` | URL to a custom .ttf/.otf font for text rendering |

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `dxf-loaded` | `boolean` | Emitted after load attempt (true = success) |
| `dxf-data` | `DxfData \| null` | Parsed data after successful load |
| `error` | `string` | Error message on failure |
| `unsupported-entities` | `string[]` | List of entity types that could not be rendered |
| `reset-view` | — | Emitted when user clicks reset button |
| `file-dropped` | `string` | File name when a file is dropped (requires `allowDrop`) |

### Exposed Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `loadDXFFromText` | `(text: string) => void` | Parse and display DXF from raw text (shows loading spinner) |
| `loadDXFFromData` | `(data: DxfData) => void` | Display pre-parsed DXF data |
| `loadDXFFromUrl` | `(url: string) => void` | Fetch and display DXF from URL |
| `resetView` | `() => void` | Reset camera to fit content |
| `exportToPNG` | `() => void` | Download current view as PNG |
| `resize` | `() => void` | Trigger manual resize |

## Other Components

| Component | Description |
|-----------|-------------|
| `FileUploader` | File input styled as a button. Emits `file-selected` with `File` |
| `LayerPanel` | Collapsible layer visibility panel with color indicators |
| `UnsupportedEntities` | Collapsible list of unsupported entity types |
| `DXFStatistics` | File statistics display (entities, layers, blocks, AutoCAD version) |

## Parser-Only Usage

Use the parser without Vue or Three.js — works in Node.js, React, or any JS environment:

```ts
import { parseDxf } from 'dxf-vuer/parser'
import type { DxfData, DxfLineEntity, isLineEntity } from 'dxf-vuer/parser'

const dxf: DxfData = parseDxf(dxfText)

for (const entity of dxf.entities) {
  if (isLineEntity(entity)) {
    console.log(entity.startPoint, entity.endPoint)
  }
}
```

The `dxf-vuer/parser` entry has zero dependencies.

## Composables

For building custom viewers:

```ts
import { useDXFRenderer, useThreeScene, useCamera, useOrbitControls, useLayers } from 'dxf-vuer'
import { createThreeObjectsFromDXF } from 'dxf-vuer'
import { resolveEntityColor } from 'dxf-vuer'
```

## Supported DXF Entities

**Rendered** (21 types): LINE, CIRCLE, ARC, ELLIPSE, POINT, POLYLINE, LWPOLYLINE, SPLINE, TEXT, MTEXT, DIMENSION, INSERT, SOLID, 3DFACE, HATCH, LEADER, MULTILEADER, MLINE, XLINE, RAY, ATTDEF

**Rendered within INSERT**: ATTRIB (attribute text with alignment, rotation, individual color)

**Rendered via SPLINE**: HELIX (parsed as spline data, rendered through the spline pipeline)

**Parsed but not rendered**: 3DSOLID, VIEWPORT, IMAGE, WIPEOUT

## CSS Customization

Override CSS custom properties to match your app's theme:

```css
:root {
  --dxf-vuer-primary-color: #ff6600;
  --dxf-vuer-bg-color: #ffffff;
  --dxf-vuer-border-color: #cccccc;
  --dxf-vuer-border-radius: 8px;
  --dxf-vuer-text-color: #333333;
  --dxf-vuer-text-secondary: #666666;
  --dxf-vuer-error-color: #ff0000;
  --dxf-vuer-spacing-xs: 4px;
  --dxf-vuer-spacing-sm: 8px;
  --dxf-vuer-spacing-md: 16px;
  --dxf-vuer-spacing-lg: 24px;
}
```

## Tech Stack

Vue 3.5, TypeScript 5.9, Three.js 0.182, Vite 7, opentype.js 1.3.

## Performance

- **Geometry merging** — entities are merged by layer+color into shared buffers, reducing draw calls by ~78%
- **Block template caching** — frequently used INSERT blocks are parsed once, then instantiated via matrix transforms
- **Web Worker parsing** — DXF parsing runs in a Web Worker to keep the UI responsive
- **Time-sliced rendering** — entity processing yields to the main thread every ~16ms with a progress bar
- **Vector text** — text rendered as triangulated mesh geometry, batched with other entities via GeometryCollector; no per-entity canvas/texture allocations

## Acknowledgements

The DXF parser architecture was inspired by and initially ported from [dxf-parser](https://github.com/gdsestimating/dxf-parser) by GDS Estimating. The codebase has since been substantially rewritten in TypeScript with a modular structure, 25 entity handlers (10 new), linetype/OCS/hatch pattern systems, and a comprehensive test suite.

## License

MIT
