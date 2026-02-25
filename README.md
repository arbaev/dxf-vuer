# DXF Vuer

Lightweight DXF file viewer built with Vue 3 + TypeScript + Three.js.

Zero external DXF dependencies — includes a custom built-in parser.

## Features

- **15 entity types**: LINE, CIRCLE, ARC, ELLIPSE, POINT, POLYLINE, LWPOLYLINE, SPLINE, TEXT, MTEXT, DIMENSION, INSERT, SOLID, 3DFACE, ATTDEF
- **Layer management**: toggle layer visibility via collapsible panel with color indicators
- **Color support**: AutoCAD Color Index (ACI), TrueColor (code 420), ByLayer/ByBlock inheritance
- **Block references**: INSERT with nested blocks, position/scale/rotation transforms
- **Orthographic view**: zoom and pan navigation via OrbitControls
- **File statistics**: entity counts, layers, blocks, AutoCAD version
- **Display of unsupported entities** on the page

## Tech Stack

| Package | Version |
|---------|---------|
| Vue | 3.5 |
| Three.js | 0.182 |
| TypeScript | 5.9 |
| Vite | 7 |

Only two runtime dependencies: `vue` and `three`.

## Installation and Running

Install dependencies:

```bash
yarn install
```

### Development Mode

```bash
yarn dev
```

### Production Build

```bash
yarn build
```

Built files will be in the `dist/` directory.

### Preview

```bash
yarn preview
```

## Project Structure

```
src/
  parser/              — Built-in DXF parser (lexer, sections, 15 entity handlers)
  composables/dxf/     — Rendering logic (scene, camera, geometry, layers)
  components/          — Vue components (viewer, uploader, layer panel, stats)
  utils/               — Color resolver, statistics collector
  types/               — DXF type definitions
  constants/           — Rendering constants
```

## License

MIT
