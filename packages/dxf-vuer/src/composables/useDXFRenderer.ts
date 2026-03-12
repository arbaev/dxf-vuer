import { ref } from "vue";
import * as THREE from "three";
import type { Group } from "three";
import {
  parseDxf,
  parseDxfAsync,
  terminateParserWorker,
  createThreeObjectsFromDXF,
  loadDefaultFont,
  loadFont,
  useCamera,
  SCENE_BG_COLOR,
  SCENE_BG_COLOR_DARK,
} from "dxf-render";
import type { DxfData, MaterialCacheStore } from "dxf-render";
import { useThreeScene, type ThreeJSOptions } from "./useThreeScene";

/** Mutable internal state for the renderer composable. */
interface RendererState {
  currentDXFGroup: Group | null;
  currentMaterials: MaterialCacheStore | null;
  originOffset: THREE.Vector3;
  abortController: AbortController | null;
}

export function useDXFRenderer() {
  const isLoading = ref(false);
  const displayProgress = ref(0);

  const state: RendererState = {
    currentDXFGroup: null,
    currentMaterials: null,
    originOffset: new THREE.Vector3(),
    abortController: null,
  };

  const {
    webGLSupported,
    error,
    initThreeJS: initThreeJSScene,
    cleanup: cleanupScene,
    disposeObject3D,
    renderScene,
    resizeComposer,
    getScene,
    getCamera,
    getRenderer,
    getControls,
    setOrbitTarget,
    saveOrbitState,
    resetOrbitControls,
  } = useThreeScene();

  const { fitCameraToBox, handleResize: handleCameraResize, resetResizing } = useCamera();

  const render = () => {
    renderScene();
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

  const parseDXFAsync = (dxfText: string): Promise<DxfData> => {
    return parseDxfAsync(dxfText);
  };

  const displayDXF = async (dxf: DxfData, darkTheme?: boolean, fontUrl?: string): Promise<string[] | undefined> => {
    const scene = getScene();
    const camera = getCamera();
    const renderer = getRenderer();

    if (!scene) {
      return undefined;
    }

    // Update scene background for theme
    scene.background = new THREE.Color(darkTheme ? SCENE_BG_COLOR_DARK : SCENE_BG_COLOR);

    // Cancel previous display if still running
    if (state.abortController) {
      state.abortController.abort();
    }
    displayProgress.value = 0;
    state.abortController = new AbortController();
    const signal = state.abortController.signal;

    if (state.currentDXFGroup) {
      disposeObject3D(state.currentDXFGroup);
      scene.remove(state.currentDXFGroup);
      state.currentDXFGroup = null;
    }
    // Clear renderer internal render lists to free cached references
    if (renderer) {
      renderer.renderLists.dispose();
    }

    const font = fontUrl ? await loadFont(fontUrl) : loadDefaultFont();

    const result = await createThreeObjectsFromDXF(dxf, {
      signal,
      onProgress: (p: number) => { displayProgress.value = p; },
      darkTheme,
      font,
    });

    if (signal.aborted) {
      // Dispose leaked group and its objects on cancellation
      disposeObject3D(result.group);
      return undefined;
    }

    scene.add(result.group);

    state.currentDXFGroup = result.group;
    state.currentMaterials = result.materials;

    if (camera) {
      const oo = result.originOffset;
      state.originOffset.set(oo.x, oo.y, 0);

      const extMin = dxf.header?.["$EXTMIN"] as { x: number; y: number; z?: number } | undefined;
      const extMax = dxf.header?.["$EXTMAX"] as { x: number; y: number; z?: number } | undefined;

      let box: THREE.Box3;
      if (extMin && extMax && extMin.x < extMax.x && extMin.y < extMax.y) {
        // Translate header extents to offset coordinates
        box = new THREE.Box3(
          new THREE.Vector3(extMin.x - oo.x, extMin.y - oo.y, extMin.z ?? 0),
          new THREE.Vector3(extMax.x - oo.x, extMax.y - oo.y, extMax.z ?? 0),
        );
      } else {
        box = new THREE.Box3().setFromObject(result.group);
      }

      // If origin offset was applied by the renderer, geometry is already near zero.
      // Otherwise, shift group to origin for camera/controls (old fallback behavior).
      if (oo.x === 0 && oo.y === 0) {
        const center = box.getCenter(new THREE.Vector3());
        state.originOffset.set(center.x, center.y, 0);
        result.group.position.set(-center.x, -center.y, 0);
        box.translate(new THREE.Vector3(-center.x, -center.y, 0));
      }

      setOrbitTarget(0, 0, 0);
      fitCameraToBox(box, camera);
      saveOrbitState();
    }

    render();

    if (result.warnings) {
      console.warn("Warnings during DXF processing:", result.warnings);
    }

    return result.unsupportedEntities;
  };

  const handleResize = (container: HTMLDivElement) => {
    handleCameraResize(container, getCamera(), getRenderer(), getScene(), (w, h) => {
      resizeComposer(w, h);
      renderScene();
    });
  };

  const resetView = () => {
    if (state.currentDXFGroup && getCamera()) {
      resetOrbitControls();
      render();
    }
  };

  const applyLayerVisibility = (visibleLayers: Set<string>) => {
    if (!state.currentDXFGroup) return;
    state.currentDXFGroup.traverse((child) => {
      const layerName = child.userData?.layerName;
      if (layerName !== undefined) {
        child.visible = visibleLayers.has(layerName);
      }
    });
    render();
  };

  const switchTheme = (darkTheme: boolean) => {
    const scene = getScene();
    if (!scene || !state.currentMaterials) return;
    scene.background = new THREE.Color(darkTheme ? SCENE_BG_COLOR_DARK : SCENE_BG_COLOR);
    state.currentMaterials.switchTheme(darkTheme);
    render();
  };

  const getOriginOffset = () => state.originOffset;

  const cleanup = () => {
    terminateParserWorker();
    // Remove listener before cleaning up controls
    const controls = getControls();
    if (controls) {
      controls.removeEventListener("change", render);
    }
    cleanupScene(state.currentDXFGroup);
    // Reset all mutable state
    state.currentDXFGroup = null;
    state.currentMaterials = null;
    state.originOffset = new THREE.Vector3();
    state.abortController = null;
    resetResizing();
  };

  return {
    isLoading,
    displayProgress,
    webGLSupported,
    error,

    initThreeJS,
    parseDXF,
    parseDXFAsync,
    displayDXF,
    handleResize,
    resetView,
    applyLayerVisibility,
    switchTheme,
    cleanup,
    getCamera,
    getRenderer,
    getOriginOffset,
  };
}
