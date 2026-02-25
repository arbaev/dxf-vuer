# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-25

### Added

- **Vue 3 component library** with five ready-to-use components:
  - `DXFViewer` -- main viewer with Three.js/WebGL rendering, layer panel, loading spinner, file name overlay, and reset button
  - `FileUploader` -- file input button that emits selected DXF files
  - `LayerPanel` -- collapsible layer visibility toggles with color indicators
  - `UnsupportedEntities` -- collapsible list of unsupported entity types found in the file
  - `DXFStatistics` -- file statistics including size, entity counts, layers, blocks, and AutoCAD version
- **Built-in DXF parser** with zero external dependencies -- custom lexer and section parsers handle the full DXF structure (HEADER, TABLES, BLOCKS, ENTITIES)
- **Parser-only entry point** (`dxf-vuer/parser`) that works without Vue or Three.js, suitable for server-side or headless use
- **16 rendered entity types**: LINE, CIRCLE, ARC, ELLIPSE, POINT, POLYLINE, LWPOLYLINE, SPLINE, TEXT, MTEXT, DIMENSION, INSERT, SOLID, 3DFACE, HATCH, LEADER, MULTILEADER
- **4 parsed but not rendered entity types**: ATTDEF, VIEWPORT, IMAGE, WIPEOUT
- **Full TypeScript support** with generated `.d.ts` declarations mirroring the source structure
- **CSS custom properties** (`--dxf-vuer-*` prefix) for theming -- primary color, error color, background, text, borders, border radius, and spacing variables with inline fallbacks so components work without importing global styles
- **Composables** for building custom viewers:
  - `useDXFRenderer` -- main orchestrator for parsing, display, resize, and layer visibility
  - `useThreeScene` -- Three.js scene, renderer, and camera initialization with cleanup
  - `useCamera` -- orthographic camera positioning and fitting
  - `useOrbitControls` -- pan and zoom controls (no rotation), with `minZoom=0.00001` for large drawings
  - `useLayers` -- layer visibility state management
- **Color resolution** with full priority chain: trueColor (code 420) > ACI (1--255) > ByLayer (256) > ByBlock (0); ACI 7 rendered as black on light backgrounds
- **Block support** (INSERT entities) with recursive processing, position/scale/rotation transforms, and `MAX_RECURSION_DEPTH=10` to guard against circular references
- **Canvas-based text rendering** for TEXT and MTEXT entities with MTEXT formatting support, stacked text, and alignment; font size capped at 256 to prevent memory issues
- **Orthographic camera** with pan and zoom via OrbitControls
- **Layer visibility toggling** with per-layer color indicators
- **Material caching** per color for LineBasicMaterial, MeshBasicMaterial, and PointsMaterial
- **Memory management** with recursive disposal of geometries, materials, and textures on unmount; ResizeObserver with debouncing
- **Graceful error handling** -- each entity handler is wrapped in try-catch so a single malformed entity does not break the entire file
- **Dual package exports**: `dxf-vuer` (full library) and `dxf-vuer/parser` (parser only), plus `dxf-vuer/style.css`
- **Demo application** deployed at [dxf-vuer.netlify.app](https://dxf-vuer.netlify.app)

[1.0.0]: https://github.com/arbaev/dxf-vuer/releases/tag/v1.0.0
