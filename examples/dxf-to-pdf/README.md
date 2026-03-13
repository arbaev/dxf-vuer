# dxf-render — DXF to PDF

Export DXF drawings to PDF. Renders the drawing via Three.js on an offscreen canvas,
then embeds it into a PDF using jsPDF.

## Features

- Page sizes: A4, A3, A1
- Landscape / portrait orientation
- White background (print-ready)
- 150 DPI rendering with 10mm margins
- Live preview before export
- Drag and drop support

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173, load a `.dxf` file, choose page settings, click **Export PDF**.

## How it works

1. `parseDxf()` from `dxf-render` parses the DXF text
2. `loadDefaultFont()` loads the built-in vector font for TEXT/MTEXT rendering
3. `createThreeObjectsFromDXF(dxf, { font })` builds a Three.js scene with text support
4. An offscreen `WebGLRenderer` renders the scene to a canvas at print resolution
5. The drawing is centered on the page with 10mm margins
6. `jsPDF` embeds the canvas image into a PDF document

## Dependencies

- **dxf-render** — DXF parsing and Three.js rendering
- **three** — 3D rendering engine (peer dependency of dxf-render)
- **jspdf** — PDF generation
