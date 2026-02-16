// Основной composable для рендеринга DXF файлов
import { ref } from "vue";
import * as THREE from "three";
import type { Group } from "three";
import { parseDxf } from "@/parser";
import type { DxfData } from "@/types/dxf";
import { useThreeScene, type ThreeJSOptions } from "./useThreeScene";
import { useCamera } from "./useCamera";
import { createThreeObjectsFromDXF } from "./useDXFGeometry";

export function useDXFRenderer() {
  const isLoading = ref(false);
  let currentDXFGroup: Group | null = null;

  const {
    webGLSupported,
    error,
    initThreeJS: initThreeJSScene,
    cleanup: cleanupScene,
    disposeObject3D,
    getScene,
    getCamera,
    getRenderer,
    getControls,
    setOrbitTarget,
    saveOrbitState,
    resetOrbitControls,
  } = useThreeScene();

  const { fitCameraToObject, handleResize: handleCameraResize, resetResizing } = useCamera();

  const render = () => {
    const scene = getScene();
    const camera = getCamera();
    const renderer = getRenderer();

    if (renderer && scene && camera) {
      renderer.render(scene, camera);
    }
  };

  const initThreeJS = (container: HTMLDivElement, options: ThreeJSOptions = {}) => {
    initThreeJSScene(container, options);

    // Добавляем слушатель события change от OrbitControls для автоматического рендеринга
    const controls = getControls();
    if (controls) {
      controls.addEventListener("change", render);
    }
  };

  // Парсинг DXF из текста
  const parseDXF = (dxfText: string): DxfData => {
    try {
      return parseDxf(dxfText);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown parsing error";
      throw new Error(`DXF file parsing error: ${message}`);
    }
  };

  // Отображение DXF данных на сцене
  // КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: возвращаем unsupportedEntities
  const displayDXF = (dxf: DxfData): string[] | undefined => {
    const scene = getScene();
    const camera = getCamera();

    if (!scene) {
      return undefined;
    }

    // Удаляем предыдущий DXF объект если он есть
    if (currentDXFGroup) {
      disposeObject3D(currentDXFGroup);
      scene.remove(currentDXFGroup);
      currentDXFGroup = null;
    }

    const result = createThreeObjectsFromDXF(dxf);
    scene.add(result.group);

    // Сохраняем ссылку на текущий объект для resize
    currentDXFGroup = result.group;

    if (camera) {
      // Получаем центр объекта для установки target
      const box = new THREE.Box3().setFromObject(result.group);
      const center = box.getCenter(new THREE.Vector3());

      // Устанавливаем target OrbitControls на центр объекта (на плоскости z=0)
      setOrbitTarget(center.x, center.y, 0);

      // Подгоняем камеру под объект
      fitCameraToObject(result.group, camera);

      // Сохраняем состояние
      saveOrbitState();
    }

    render();

    if (result.warnings) {
      console.warn("⚠️ Предупреждения при обработке DXF:", result.warnings);
    }

    // КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: возвращаем unsupportedEntities для отображения на странице
    return result.unsupportedEntities;
  };

  // Обработка resize
  const handleResize = (container: HTMLDivElement) => {
    handleCameraResize(container, getCamera(), getRenderer(), getScene());
  };

  // Сброс камеры и объекта в исходное состояние
  const resetView = () => {
    if (currentDXFGroup && getCamera()) {
      resetOrbitControls();
      render();
    }
  };

  // Применить видимость слоёв к объектам на сцене
  const applyLayerVisibility = (visibleLayers: Set<string>) => {
    if (!currentDXFGroup) return;
    currentDXFGroup.traverse((child) => {
      const layerName = child.userData?.layerName;
      if (layerName !== undefined) {
        child.visible = visibleLayers.has(layerName);
      }
    });
    render();
  };

  // Полная очистка ресурсов
  const cleanup = () => {
    cleanupScene(currentDXFGroup);
    currentDXFGroup = null;
    resetResizing();
  };

  return {
    isLoading,
    webGLSupported,
    error,

    initThreeJS,
    parseDXF,
    displayDXF,
    handleResize,
    resetView,
    applyLayerVisibility,
    cleanup,
  };
}
