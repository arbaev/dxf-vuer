import * as THREE from "three";
import {
  createThreeObjectsFromDXF,
  loadDefaultFont,
} from "dxf-render";
import type { DxfData } from "dxf-render";
import { jsPDF } from "jspdf";

export type PageSize = "a4" | "a3" | "a1";
export type Orientation = "landscape" | "portrait";

// Page dimensions in mm [short, long]
const PAGE_SIZES: Record<PageSize, [number, number]> = {
  a4: [210, 297],
  a3: [297, 420],
  a1: [594, 841],
};

const DPI = 150;
const MARGIN_MM = 10;

function mmToPx(mm: number): number {
  return Math.round((mm / 25.4) * DPI);
}

/**
 * Render DXF data to a canvas at specified resolution.
 * The drawing is centered on the page with margins.
 */
export async function renderToCanvas(
  dxf: DxfData,
  pageSize: PageSize,
  orientation: Orientation,
): Promise<HTMLCanvasElement> {
  const font = loadDefaultFont();

  const { group } = await createThreeObjectsFromDXF(dxf, { font });

  const [shortMm, longMm] = PAGE_SIZES[pageSize];
  const widthMm = orientation === "landscape" ? longMm : shortMm;
  const heightMm = orientation === "landscape" ? shortMm : longMm;

  const drawWidthMm = widthMm - 2 * MARGIN_MM;
  const drawHeightMm = heightMm - 2 * MARGIN_MM;

  const widthPx = mmToPx(widthMm);
  const heightPx = mmToPx(heightMm);

  // Offscreen renderer
  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(widthPx, heightPx, false);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0xffffff, 1);

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  scene.add(group);

  // Camera — fit drawing into printable area with margins
  const box = new THREE.Box3().setFromObject(group);
  const drawingWidth = box.max.x - box.min.x;
  const drawingHeight = box.max.y - box.min.y;

  if (drawingWidth <= 0 || drawingHeight <= 0) {
    renderer.dispose();
    return canvas;
  }

  const centerX = (box.min.x + box.max.x) / 2;
  const centerY = (box.min.y + box.max.y) / 2;

  // How many mm on paper per drawing unit (fit drawing into printable area)
  const scaleX = drawWidthMm / drawingWidth;
  const scaleY = drawHeightMm / drawingHeight;
  const scale = Math.min(scaleX, scaleY);

  // Full page expressed in drawing units (camera sees entire page)
  const frustumW = widthMm / scale;
  const frustumH = heightMm / scale;

  const camera = new THREE.OrthographicCamera(
    -frustumW / 2,
    frustumW / 2,
    frustumH / 2,
    -frustumH / 2,
    0.1,
    1000,
  );
  camera.position.set(centerX, centerY, 500);
  camera.lookAt(centerX, centerY, 0);
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  renderer.dispose();

  return canvas;
}

/**
 * Export rendered canvas to PDF and trigger download.
 */
export function downloadPdf(
  canvas: HTMLCanvasElement,
  pageSize: PageSize,
  orientation: Orientation,
  fileName: string,
): void {
  const [shortMm, longMm] = PAGE_SIZES[pageSize];
  const widthMm = orientation === "landscape" ? longMm : shortMm;
  const heightMm = orientation === "landscape" ? shortMm : longMm;

  const doc = new jsPDF({
    orientation,
    unit: "mm",
    format: pageSize,
  });

  const dataUrl = canvas.toDataURL("image/png");
  doc.addImage(dataUrl, "PNG", 0, 0, widthMm, heightMm);

  const pdfName = fileName.replace(/\.dxf$/i, "") + ".pdf";
  doc.save(pdfName);
}
