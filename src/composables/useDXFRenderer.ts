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

    const controls = getControls();
    if (controls) {
      controls.addEventListener("change", render);
    }
  };

  const parseDXF = (dxfText: string): DxfData => {
    try {
      return parseDxf(dxfText);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown parsing error";
      throw new Error(`DXF file parsing error: ${message}`);
    }
  };

  const displayDXF = (dxf: DxfData): string[] | undefined => {
    const scene = getScene();
    const camera = getCamera();

    if (!scene) {
      return undefined;
    }

    if (currentDXFGroup) {
      disposeObject3D(currentDXFGroup);
      scene.remove(currentDXFGroup);
      currentDXFGroup = null;
    }

    const result = createThreeObjectsFromDXF(dxf);
    scene.add(result.group);

    currentDXFGroup = result.group;

    if (camera) {
      const box = new THREE.Box3().setFromObject(result.group);
      const center = box.getCenter(new THREE.Vector3());

      // Set OrbitControls target to object center (on the z=0 plane)
      setOrbitTarget(center.x, center.y, 0);
      fitCameraToObject(result.group, camera);
      saveOrbitState();
    }

    render();

    if (result.warnings) {
      console.warn("Warnings during DXF processing:", result.warnings);
    }

    return result.unsupportedEntities;
  };

  const handleResize = (container: HTMLDivElement) => {
    handleCameraResize(container, getCamera(), getRenderer(), getScene());
  };

  const resetView = () => {
    if (currentDXFGroup && getCamera()) {
      resetOrbitControls();
      render();
    }
  };

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

  const cleanup = () => {
    // Remove listener before cleaning up controls
    const controls = getControls();
    if (controls) {
      controls.removeEventListener("change", render);
    }
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
