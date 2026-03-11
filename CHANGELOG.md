# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## dxf-render [1.0.3] / dxf-vuer [2.0.2] - 2026-03-11

### Added

- **README: "Why dxf-render?" section** — key advantages before Installation
- **README: Comparison table** — feature-by-feature comparison with dxf-viewer, dxf-parser, three-dxf
- **README: React and Svelte examples** — full working Quick Start examples with correct API usage
- **README: StackBlitz buttons** — "Open in StackBlitz" badges in both package READMEs
- **README: CI badge** — GitHub Actions CI status badge in both package READMEs
- **StackBlitz examples** — standalone examples in `examples/` for vanilla-ts, React, and Vue
- **Demo: sample DXF files** — 6 built-in examples with load buttons (Basic Entities, Linetypes, Electric Schematic, Hatch Patterns, Floor Plan, House Plan)
- **GitHub issue templates** — bug report, feature request, DXF rendering issue
- **npm keywords** — added browser-cad, dxf-renderer, cad-viewer, 2d-cad to dxf-render

### Fixed

- **README: Quick Start code** — all examples now use correct API signatures for `useCamera()` and `useOrbitControls()`

## dxf-vuer [2.0.0] / dxf-render [1.0.0] - 2026-03-10

### Added

- **Monorepo architecture** — project split into two npm packages via pnpm workspaces:
  - `dxf-render` (v1.0.0) — framework-agnostic DXF parser + Three.js renderer
  - `dxf-vuer` (v2.0.0) — thin Vue 3 wrapper (components + composables)
- **`dxf-render` package** — standalone package usable with React, Svelte, vanilla JS, or any framework; includes parser, renderer, scene helpers, and all utilities
- **`parseDxfAsync()`** — new async parser API in dxf-render: runs `parseDxf()` in an inline Web Worker with automatic fallback to sync; `terminateParserWorker()` for cleanup
- **`dxf-render/parser` entry point** — parser-only import with zero dependencies (replaces `dxf-vuer/parser`)

### Changed

- **Package structure** — monorepo with `packages/dxf-render/`, `packages/dxf-vuer/`, `demo/`
- **File layout** — `src/composables/geometry/` → `packages/dxf-render/src/render/`; `src/composables/geometry/text.ts` → `render/text/mtextParser.ts`; camera/controls → `scene/`; parser/types/utils/constants/workers/assets unchanged in structure
- **Package manager** — yarn → pnpm 9.15 workspaces
- **Build** — sequential build: dxf-render first, then dxf-vuer (dxf-vuer depends on dxf-render)
- **Bundle sizes** — dxf-render: ~960 KB main + ~50 KB parser + ~525 KB serif font; dxf-vuer: ~33 KB + ~14 KB CSS
- **Backward compatibility** — `dxf-vuer` re-exports everything from `dxf-render` (`export * from "dxf-render"`); existing imports from `dxf-vuer` continue to work

### Breaking

- **New peer dependency** — `dxf-vuer` now requires `dxf-render >= 1.0.0` as a peer dependency
- **Parser entry point moved** — `dxf-vuer/parser` → `dxf-render/parser`
- **Worker logic extracted** — `useDXFRenderer` no longer manages Web Worker directly; uses `parseDxfAsync`/`terminateParserWorker` from dxf-render

## [1.5.0] - 2026-03-10

### Added

- **TAA anti-aliasing** — Temporal Anti-Aliasing via Three.js `EffectComposer` + `TAARenderPass`: hardware MSAA disabled (thin lines), 32 jittered frames accumulated progressively when idle (~530ms at 60fps) for smooth text and edges without thickening lines
- **Instant dark mode** — theme switching without full re-render; ACI 7 color resolved via sentinel value (`ACI7_COLOR`) deferred to material level; `MaterialCacheStore.switchTheme()` updates all theme-dependent materials in-place
- **Overlay rendering** — separate overlay mesh buffer in `GeometryCollector` for text glyphs and dimension/leader arrows; rendered last in `flush()` so annotations always appear on top of drawing geometry
- **Hatch style support** — `style` property (code 75) parsed: Normal (even-odd), Outer (level 0+1 only), Ignore (level 0 only); `filterPolygonsByStyle()` filters pattern polygons by nesting depth
- **Leader arrow size from XDATA** — LEADER entities parse XDATA DSTYLE override for DIMASZ (arrow size); `arrowSize` field on `DxfLeaderEntity`

### Fixed

- **Hatch arc edges** — CW arc edges (ccw=false) angles inverted from CW convention to standard CCW via `hatchArcRadians()`; fixes boundary polygon connectivity (gap 171→0 units) and incorrect clipping in 7+ regions
- **Hatch nearly-full-circle arcs** — arcs >350° from incorrect ccw flag now clamped to the short arc; prevents tiny boundary edges from becoming huge circles
- **Hatch polygon centroid** — `polygonCentroid()` used instead of first vertex for even-odd nesting test; fixes incorrect hole detection when boundaries share vertices
- **Dimension text angle** — `while` loop instead of `if` for angle normalization; fixes upside-down text on dimensions with angles >270°
- **Leader arrow angle** — arrow direction computed from spline point at `arrowSize` distance, not from first two control points; fixes misaligned arrow/line junction
- **MTEXT word wrap** — width/height ratio threshold (≥0.05) filters artifact micro-widths from DXF exporters while preserving intentional narrow columns

### Changed

- **Architecture**: monolithic `useDXFGeometry.ts` (2622 lines) replaced by modular collector system — 15 entity collector modules in `geometry/collectors/` with dispatch map; `createDXFScene.ts` (~400 lines) as slim orchestrator
- **Color resolution** — `resolveEntityColor()` returns `ACI7_COLOR` sentinel instead of concrete hex for ACI 7/255; theme resolved at material creation time via `MaterialCacheStore.resolveColor()`
- **Material cache** — three separate `Map` caches consolidated into `MaterialCacheStore` with `getLineMaterial()`, `getMeshMaterial()`, `getPointsMaterial()`, `switchTheme()`, `disposeAll()`
- **Render context** — `EntityColorContext` replaced by `RenderContext` composing `ColorContext`, `LinetypeContext`, `TextContext`, `DimensionContext`
- **Typed header** — `DxfHeader` typed interface (20 properties) replaces `Record<string, unknown>`
- **Curve points** — `generateCirclePoints()`, `generateArcPoints()`, `generateEllipsePoints()` extracted to shared `curvePoints.ts`
- **Rendering pipeline** — `useThreeScene` now manages `EffectComposer` lifecycle; `renderScene()` and `resizeComposer()` replace direct `renderer.render()` calls
- **Bundle size**: main ~992 KB (was ~1000 KB), parser chunk ~49 KB (unchanged)
- Test suite expanded from 818 to 841 cases across 36 files

## [1.4.0] - 2026-03-09

### Added

- **MLINE entity** — multiline entities with multiple parallel line elements, individual element colors and linetypes
- **XLINE entity** — construction lines (infinite in both directions), clipped to drawing extents for rendering
- **RAY entity** — rays (infinite in one direction), clipped to drawing extents for rendering
- **HELIX entity** — parsed as SPLINE, rendered through the existing spline pipeline
- **ATTDEF rendering** — attribute definitions now rendered as text (previously parse-only)
- **3DSOLID parser** — 3DSOLID entities parsed (not rendered, data stored for future use)
- **DIMSTYLE table** — dimension style table fully parsed with 40+ dimension variables (DIMBLK, DIMSCALE, DIMTXT, etc.)
- **BLOCK_RECORD table** — block record table parsed for handle-to-name mapping
- **INSUNITS support** — `$INSUNITS` header variable parsed; `getInsUnitsScale()` utility for unit conversion
- **Architectural units** — dimension text formatted in feet-inches notation (DIMLUNIT=4) with fractions
- **Architectural ticks** — oblique tick marks for dimension lines (DIMTSZ > 0, DIMBLK tick patterns)
- **Text underline** — MTEXT `\L...\l` underline formatting rendered as line segments below text
- **Tab support** — MTEXT tab characters (`\t`, `^I`) rendered with 4×textHeight tab stops (AutoCAD standard)
- **3D polygon mesh** — POLYLINE entities with `is3dPolygonMesh` flag rendered as wireframe grids
- **PDMODE 34** — point symbol rendering with cross-in-circle style
- **$MIRRTEXT support** — mirrored text in blocks with negative X scale respects `$MIRRTEXT` header variable
- Test suite expanded from 648 to 789 cases across 34 files (was 27)

### Fixed

- Dimension lines: rotated dimensions, angular dimensions, overshoot lines, text gap adjustment, radial/diametric placement
- Dimension text: architectural formatting, stacked fractions, DIMSCALE/DIMVARS support
- Text rendering: text height from DIMSTYLE, leading spaces preserved, height format application, textSize parameter
- Hatch patterns: solid fill optimization (86× faster on large files), spline edge parsing, donut shapes, parquette pattern
- MTEXT: word wrapping optimization (O(n) incremental), tab indentation, `\H` height format apply
- Polyline: bulge=1 arcs, closed LWPOLYLINE, `closed` parameter support, polyline resolution, polyface mesh
- Ellipse: arc sweep direction, OCS transform
- Linetype: pattern scaling, auto-LTSCALE computation from extents
- Leader: path type handling, tick marks, arrow sizing
- 3D entities: 3DFACE parsing, parse robustness for 3D entities
- Entity visibility: `visible` parameter support for entities
- Objects rendering order preserved
- DXF files without TABLES section parsed correctly

### Changed

- **Fonts**: Noto Sans Light → Liberation Sans Regular (Arial-metrically-compatible, ~410 KB embedded); Noto Serif Light → Liberation Serif Regular (Times New Roman-compatible, ~525 KB lazy-loaded)
- **Bundle sizes**: main ~790 KB → ~1000 KB, parser chunk ~43 KB → ~49 KB, serif font chunk ~646 KB → ~525 KB
- Entity parsers: 22 → 25 handlers (added mline, xline, 3dsolid)
- Refactored geometry function signatures to use options objects instead of positional parameters
- INSERT entity parser now includes additional parameters (column/row counts, spacing)

## [1.3.0] - 2026-03-05

### Added

- **Vector text rendering** — replaced canvas-based text textures with opentype.js triangulated vector glyphs; text is now rendered as geometry (mesh triangles) batched into GeometryCollector alongside lines and other entities; eliminates per-entity canvas allocations and produces sharp text at any zoom level
- **Font management** — embedded Noto Sans Light (.ttf) as default font; glyph triangulation cache with `ShapePath`/`ShapeUtils` (curveSubdivision=2); fallback characters for missing glyphs
- **Sans/serif font classification** — `fontClassifier.ts` classifies DXF font names (e.g. "Times New Roman" → serif, "Arial" → sans); Noto Serif Light loaded lazily as a separate chunk (~646 KB) only when serif fonts are referenced
- **STYLE table parsing** — DXF STYLE table entries (code 7) parsed and used for font resolution in TEXT, MTEXT, DIMENSION, ATTRIB entities
- **Bold & italic** — faux bold (duplicate shifted triangles) and faux italic (shear transform) for MTEXT inline formatting (`\fArial|b1|i1;`)
- **Custom glyphs** — hand-crafted vector glyphs for degree (%%d), plus-minus (%%p), and diameter (%%c) symbols that may be missing from the font
- **`fontUrl` prop** — new DXFViewer prop to load a custom .ttf/.otf font instead of the built-in Noto Sans Light
- Test suite expanded from 492 to 648 cases across 27 files

### Fixed

- MTEXT word wrapping with very small width (code 41 < text height) no longer produces single-character columns; wrapping is skipped when width is too narrow for even one character
- Rendering progress bar restored — yield-to-browser check was unreachable for collected entity types (TEXT, MTEXT, DIMENSION, LEADER, etc.) due to early `continue`; moved to loop start
- MTEXT vertical alignment (attachment points 4-9) positioning corrected
- MTEXT line spacing factor applied correctly
- Dimension stacked fraction text positioning improved
- Relative height multiplier (`\H<value>x;`) in MTEXT now works correctly

### Changed

- Text rendering pipeline: canvas-based → vector-based (opentype.js); text entities go through GeometryCollector like all other geometry
- Main bundle size: ~145 KB → ~790 KB (includes inline Noto Sans Light font ~290 KB + opentype.js)
- New lazy-loaded serif font chunk: ~646 KB (only loaded when serif fonts are referenced)
- Parser chunk unchanged: ~43 KB

## [1.2.0] - 2026-03-03

### Added

- **Dark theme** — new `darkTheme` prop: dark scene background (#1a1a1a), ACI 7 rendered as white, dark overlays for all UI elements including layer panel, coordinates, toolbar, and loading spinner
- **Drag-and-drop** — new `allowDrop` prop enables dropping DXF files directly onto the viewer area; visual "Drop DXF file here" overlay during drag; emits `file-dropped` event with file name
- **Export to PNG** — new `exportToPNG()` exposed method and `showExportButton` prop for toolbar button; downloads current view as PNG file
- **Loading by URL** — new `url` prop to fetch and display DXF files from a remote URL; `loadDXFFromUrl()` exposed method
- **Loading progress bar** — progress bar with percentage shown during the rendering phase; separate loading phases: fetching, parsing, rendering
- **`showFullscreenButton` prop** — control visibility of the fullscreen button (default: `true`)
- **`showFileName` prop** — control visibility of the file name overlay (default: `true`)
- **Geometry merging** — entities merged by layer+color into shared `LineSegments`/`Points`/`Mesh` buffers, reducing draw calls by ~78% on complex drawings
- **Block template caching** — frequently used INSERT blocks parsed once and instantiated via matrix transforms; `INSTANCING_THRESHOLD=2`
- **Web Worker parsing** — DXF parsing offloaded to an inline Web Worker to keep UI responsive; automatic fallback to main thread if Workers are unavailable
- **Time-sliced rendering** — entity processing yields to the main thread every ~16ms, preventing UI freezes on large files; cancellation support for fast file switching
- **Camera fit from header extents** — uses `$EXTMIN`/`$EXTMAX` from DXF header for instant camera fitting instead of computing bounding box from geometry
- Test suite expanded from 465 to 492 cases across 22 files

### Changed

- Coordinates panel moved to bottom-left, layer panel to bottom-right
- Coordinates panel styled consistently with other overlays (light background with border); values displayed in two rows with fixed-width columns
- Main bundle size: ~89 KB → ~145 KB (includes inline Web Worker with parser)
- `preserveDrawingBuffer` enabled on WebGL renderer to support PNG export

## [1.1.0] - 2026-03-02

### Added

- **Linetype rendering** — all DXF line patterns (DASHED, HIDDEN, CENTER, PHANTOM, DOT, DASHDOT etc.) via geometric splitting; resolution chain: entity → ByBlock → ByLayer → LTYPE table; scaling entityScale × $LTSCALE; auto-LTSCALE for large drawings
- **Hatch pattern rendering** — 25 built-in AutoCAD patterns (ANSI31–38, BRICK, DOTS, NET, HEX, GOST_* etc.); pattern scale/angle, dot elements, multi-boundary even-odd clipping (donut shapes), fallback dictionary
- **OCS (Object Coordinate System)** — Arbitrary Axis Algorithm for 10 entity types; correct rendering of mirrored/rotated entities
- **ATTRIB rendering** in INSERT blocks — attribute text with alignment, rotation, individual color
- **Frozen and locked layer support** — snowflake/lock icons in layer panel
- **Paper space filtering** — entities with `inPaperSpace` (DXF code 67=1) skipped during rendering
- **World coordinates display** — new `showCoordinates` prop shows cursor position in drawing units
- **Fullscreen button** in the viewer toolbar
- **Test suite** expanded from 379 to 465 cases across 21 files

### Fixed

- Dashed line patterns invisible on large blueprints (auto-LTSCALE from drawing extents)
- Dimension extension line dashes not scaling with drawing size
- Hatch pattern lines not reaching boundary when base point is far from polygon

### Changed

- Composables directory restructured from `composables/dxf/` to `composables/`
- Main bundle size increased from ~75 KB to ~89 KB

## [1.0.1] - 2026-02-26

### Added

- **Test suite** -- 379 test cases covering all testable business logic (Vitest 4)
  - DXF parser core: scanner, parseHelpers, parseDxf, parseEntities
  - All 21 entity handlers: LINE, CIRCLE, ARC, POINT, ELLIPSE, SOLID, 3DFACE, POLYLINE, LWPOLYLINE, SPLINE, TEXT, MTEXT, ATTDEF, DIMENSION, INSERT, HATCH, LEADER, MULTILEADER, VIEWPORT, IMAGE, WIPEOUT
  - Section parsers: HEADER, TABLES, BLOCKS
  - Utilities: colorResolver, dxfStatistics, 16 type guards
  - Geometry: text formatting, dimension math, hatch clipping, angle conversion
  - Vue composable: useLayers
- **CI pipeline** -- GitHub Actions workflow (`ci.yml`) runs type check, build, and tests on push/PR to main (Node.js 20 + 22)

### Fixed

- TypeScript strict mode errors in test files (unused imports, type narrowing)

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

[2.0.0]: https://github.com/arbaev/dxf-kit/releases/tag/dxf-vuer%402.0.0
[1.0.0]: https://github.com/arbaev/dxf-kit/releases/tag/dxf-render%401.0.0
[1.5.0]: https://github.com/arbaev/dxf-kit/releases/tag/v1.5.0
[1.4.0]: https://github.com/arbaev/dxf-kit/releases/tag/v1.4.0
[1.3.0]: https://github.com/arbaev/dxf-kit/releases/tag/v1.3.0
[1.2.0]: https://github.com/arbaev/dxf-kit/releases/tag/v1.2.0
[1.1.0]: https://github.com/arbaev/dxf-kit/releases/tag/v1.1.0
[1.0.1]: https://github.com/arbaev/dxf-kit/releases/tag/v1.0.1
