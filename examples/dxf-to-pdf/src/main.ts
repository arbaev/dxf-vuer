import { parseDxf } from "dxf-render";
import type { DxfData } from "dxf-render";
import {
  renderToCanvas,
  downloadPdf,
  type PageSize,
  type Orientation,
} from "./exportPdf";

const fileInput = document.getElementById("file-input") as HTMLInputElement;
const pageSizeSelect = document.getElementById("page-size") as HTMLSelectElement;
const orientationSelect = document.getElementById("orientation") as HTMLSelectElement;
const exportBtn = document.getElementById("export-btn") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLSpanElement;
const previewEl = document.getElementById("preview") as HTMLCanvasElement;

let currentDxf: DxfData | null = null;
let currentCanvas: HTMLCanvasElement | null = null;
let currentFileName = "drawing";

async function renderPreview() {
  if (!currentDxf) return;

  const pageSize = pageSizeSelect.value as PageSize;
  const orientation = orientationSelect.value as Orientation;

  status.textContent = "Rendering...";
  exportBtn.disabled = true;

  try {
    currentCanvas = await renderToCanvas(currentDxf, pageSize, orientation);

    // Copy to visible preview canvas
    previewEl.width = currentCanvas.width;
    previewEl.height = currentCanvas.height;
    const ctx = previewEl.getContext("2d")!;
    ctx.drawImage(currentCanvas, 0, 0);

    exportBtn.disabled = false;
    status.textContent =
      `${currentFileName} — ready to export (${pageSize.toUpperCase()} ${orientation})`;
  } catch (err) {
    status.textContent = `Render error: ${err}`;
  }
}

async function loadDxf(text: string, fileName: string) {
  status.textContent = "Parsing DXF...";
  currentFileName = fileName;

  try {
    currentDxf = parseDxf(text);
    await renderPreview();
  } catch (err) {
    status.textContent = `Parse error: ${err}`;
  }
}

// Re-render when settings change
pageSizeSelect.addEventListener("change", renderPreview);
orientationSelect.addEventListener("change", renderPreview);

// Export PDF
exportBtn.addEventListener("click", () => {
  if (!currentCanvas) return;
  const pageSize = pageSizeSelect.value as PageSize;
  const orientation = orientationSelect.value as Orientation;
  downloadPdf(currentCanvas, pageSize, orientation, currentFileName);
  status.textContent = `PDF saved: ${currentFileName.replace(/\.dxf$/i, "")}.pdf`;
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
const container = document.getElementById("preview-container")!;

container.addEventListener("dragover", (e) => {
  e.preventDefault();
  container.style.outline = "3px dashed #4a90d9";
});

container.addEventListener("dragleave", () => {
  container.style.outline = "";
});

container.addEventListener("drop", (e) => {
  e.preventDefault();
  container.style.outline = "";
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
  .then((text) => loadDxf(text, "Electric Schematic (sample)"))
  .catch(() => {
    status.textContent = "Drop a .dxf file or click Open DXF file";
  });
