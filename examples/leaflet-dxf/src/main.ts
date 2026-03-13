import L from "leaflet";
import { parseDxf } from "dxf-render/parser";
import { dxfToGeoJson } from "./dxfToGeoJson";

const fileInput = document.getElementById("file-input") as HTMLInputElement;
const status = document.getElementById("status") as HTMLSpanElement;
const latInput = document.getElementById("input-lat") as HTMLInputElement;
const lngInput = document.getElementById("input-lng") as HTMLInputElement;
const scaleInput = document.getElementById("input-scale") as HTMLInputElement;
const rotInput = document.getElementById("input-rotation") as HTMLInputElement;
const applyBtn = document.getElementById("apply-btn") as HTMLButtonElement;
const toggleDxf = document.getElementById("toggle-dxf") as HTMLInputElement;

// Geo-reference parameters
let originLat = 43.767147;
let originLng = 11.251495;
let metersPerUnit = 1; // DXF in meters (CadMapper export)
let rotationDeg = -1.56; // UTM grid convergence correction

// Set initial values in inputs
latInput.value = String(originLat);
lngInput.value = String(originLng);
scaleInput.value = String(metersPerUnit);
rotInput.value = String(rotationDeg);

// Leaflet map with OSM tiles
const map = L.map("map").setView([originLat, originLng], 17);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 22,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

let currentLayer: L.GeoJSON | null = null;
let currentGeoJson: ReturnType<typeof dxfToGeoJson> | null = null;
let currentFileName = "";
let currentEntityCount = 0;

/**
 * Convert DXF coordinates to lat/lng using the geo-reference parameters.
 */
function dxfToLatLng(x: number, y: number): L.LatLng {
  const mx = x * metersPerUnit;
  const my = y * metersPerUnit;

  // Rotation
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = mx * cos - my * sin;
  const ry = mx * sin + my * cos;

  // Meters to lat/lng offset
  const lat = originLat + ry / 111320;
  const lng = originLng + rx / (111320 * Math.cos((originLat * Math.PI) / 180));
  return L.latLng(lat, lng);
}

function renderGeoJson(fitView: boolean) {
  if (!currentGeoJson) return;

  if (currentLayer) {
    map.removeLayer(currentLayer);
  }

  currentLayer = L.geoJSON(currentGeoJson as any, {
    coordsToLatLng: (coords: number[]) => dxfToLatLng(coords[0], coords[1]),
    style: (feature: any) => ({
      color: (feature?.properties?.color as string) ?? "#000000",
      weight: 1.5,
      opacity: 0.9,
      fillOpacity: 0.1,
    }),
    pointToLayer: (_feature: any, latlng: L.LatLng) =>
      L.circleMarker(latlng, { radius: 3, fillOpacity: 0.8 }),
    onEachFeature: (feature: any, layer: L.Layer) => {
      const p = feature.properties;
      const lines = [`<b>${p.type}</b>`, `Layer: ${p.layer}`];
      if (p.text) lines.push(`Text: ${p.text}`);
      (layer as any).bindPopup(lines.join("<br>"));
    },
  }).addTo(map);

  if (fitView) {
    const bounds = currentLayer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [20, 20] });
    }
  }

  const featureCount = currentGeoJson.features.length;
  status.textContent =
    `${currentFileName} — ${currentEntityCount} entities, ${featureCount} features on map`;
}

function loadDxf(text: string, fileName: string, fitView = true) {
  status.textContent = "Parsing DXF...";
  const dxf = parseDxf(text);

  status.textContent = "Converting to GeoJSON...";
  currentGeoJson = dxfToGeoJson(dxf);
  currentFileName = fileName;
  currentEntityCount = dxf.entities.filter((e) => !e.inPaperSpace).length;

  renderGeoJson(fitView);
}

// Apply geo-reference changes
applyBtn.addEventListener("click", () => {
  originLat = parseFloat(latInput.value) || originLat;
  originLng = parseFloat(lngInput.value) || originLng;
  metersPerUnit = parseFloat(scaleInput.value) || metersPerUnit;
  rotationDeg = parseFloat(rotInput.value) || 0;
  renderGeoJson(true);
});

// Toggle DXF visibility
toggleDxf.addEventListener("change", () => {
  if (!currentLayer) return;
  if (toggleDxf.checked) {
    currentLayer.addTo(map);
  } else {
    map.removeLayer(currentLayer);
  }
});

// File input
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  status.textContent = `Reading ${file.name}...`;
  const reader = new FileReader();
  reader.onload = () => loadDxf(reader.result as string, file.name);
  reader.readAsText(file);
});

// Drag and drop
const mapEl = document.getElementById("map")!;

mapEl.addEventListener("dragover", (e) => {
  e.preventDefault();
  mapEl.style.outline = "3px dashed #4a90d9";
});

mapEl.addEventListener("dragleave", () => {
  mapEl.style.outline = "";
});

mapEl.addEventListener("drop", (e) => {
  e.preventDefault();
  mapEl.style.outline = "";
  const file = e.dataTransfer?.files[0];
  if (!file || !file.name.toLowerCase().endsWith(".dxf")) return;
  status.textContent = `Reading ${file.name}...`;
  const reader = new FileReader();
  reader.onload = () => loadDxf(reader.result as string, file.name);
  reader.readAsText(file);
});

// Load default sample on start
fetch("/sample.dxf")
  .then((r) => r.text())
  .then((text) => loadDxf(text, "Florence city center"))
  .catch(() => {
    status.textContent = "Drop a .dxf file onto the map or click Open DXF file";
  });
