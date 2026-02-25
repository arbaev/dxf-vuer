// Главная точка входа npm-пакета dxf-vuer
// Использование: import { DXFViewer, parseDxf } from 'dxf-vuer'

// Стили библиотеки
import "./styles.css";

// --- Компоненты ---
export { default as DXFViewer } from "./components/DXFViewer.vue";
export { default as LayerPanel } from "./components/LayerPanel.vue";
export { default as FileUploader } from "./components/FileUploader.vue";
export { default as UnsupportedEntities } from "./components/UnsupportedEntities.vue";
export { default as DXFStatistics } from "./components/DXFStatistics.vue";

// --- Композаблы ---
export { useDXFRenderer } from "./composables/dxf/useDXFRenderer";
export { useThreeScene } from "./composables/dxf/useThreeScene";
export { useCamera } from "./composables/dxf/useCamera";
export { useOrbitControls } from "./composables/dxf/useOrbitControls";
export { useLayers } from "./composables/dxf/useLayers";
export { createThreeObjectsFromDXF } from "./composables/dxf/useDXFGeometry";

// --- Утилиты ---
export { resolveEntityColor, rgbNumberToHex } from "./utils/colorResolver";

// --- Константы ---
export * from "./constants";

// --- Парсер, типы, type-guards (реэкспорт) ---
export * from "./parser-entry";
