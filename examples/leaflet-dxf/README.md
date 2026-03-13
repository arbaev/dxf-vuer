# dxf-render + Leaflet Example

Display DXF drawings on an interactive OpenStreetMap.

Parses DXF using the **parser-only** entry point (`dxf-render/parser`) — no Three.js dependency.
Converts entities to GeoJSON and renders them as a Leaflet layer on top of OSM tiles.

A sample DXF of Florence city center (from CadMapper) is loaded on startup, geo-referenced
to align with OpenStreetMap buildings.

## Supported entities

LINE, POLYLINE, LWPOLYLINE (with bulge arcs), CIRCLE, ARC, ELLIPSE, POINT, TEXT, MTEXT, SOLID, 3DFACE, INSERT (block references).

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173 — Florence city center DXF is loaded automatically on the map.

## Geo-referencing

DXF files use arbitrary coordinate units (mm, meters, inches). To place a drawing on a real map,
use the geo-reference controls in the toolbar:

- **Lat / Lng** — origin point on the map (where DXF 0,0 maps to)
- **m/unit** — meters per DXF unit (0.001 for mm, 1 for meters, 0.0254 for inches)
- **Rot°** — rotation in degrees (compensates for UTM grid convergence or drawing orientation)
- **DXF checkbox** — toggle DXF overlay visibility

Click **Apply** to update the overlay position.

## How it works

1. `parseDxf()` from `dxf-render/parser` parses the DXF text
2. `dxfToGeoJson()` converts DXF entities to a GeoJSON `FeatureCollection`
3. `coordsToLatLng` transforms DXF coordinates to lat/lng using the geo-reference parameters
4. Leaflet renders the GeoJSON on top of OpenStreetMap tiles
5. Click any feature to see its type, layer, and text content

## Default sample

The included Florence sample uses UTM zone 32N coordinates. The default settings apply:
- Origin: 43.767°N, 11.251°E (Piazza del Duomo)
- Scale: 1 m/unit (CadMapper exports in meters)
- Rotation: -1.56° (UTM grid convergence correction at this longitude)
