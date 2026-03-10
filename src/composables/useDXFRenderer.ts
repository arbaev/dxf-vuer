import { ref } from "vue";
import * as THREE from "three";
import type { Group } from "three";
import { parseDxf } from "@/parser";
import type { DxfData } from "@/types/dxf";
import { SCENE_BG_COLOR, SCENE_BG_COLOR_DARK } from "@/constants";
import { useThreeScene, type ThreeJSOptions } from "./useThreeScene";
import { useCamera } from "./useCamera";
import { createThreeObjectsFromDXF } from "./createDXFScene";
import { loadDefaultFont, loadFont } from "./geometry/fontManager";
import type { MaterialCacheStore } from "./geometry/materialCache";
import ParserWorker from "@/workers/parserWorker?worker&inline";

/** Mutable internal state for the renderer composable. */
interface RendererState {
  currentDXFGroup: Group | null;
  currentMaterials: MaterialCacheStore | null;
  originOffset: THREE.Vector3;
  worker: Worker | null;
  workerFailed: boolean;
  messageId: number;
  abortController: AbortController | null;
}

export function useDXFRenderer() {
  const isLoading = ref(false);
  const displayProgress = ref(0);

  const state: RendererState = {
    currentDXFGroup: null,
    currentMaterials: null,
    originOffset: new THREE.Vector3(),
    worker: null,
    workerFailed: false,
    messageId: 0,
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

  const getOrCreateWorker = (): Worker | null => {
    if (state.workerFailed) return null;
    if (state.worker) return state.worker;
    try {
      state.worker = new ParserWorker();
      return state.worker;
    } catch {
      state.workerFailed = true;
      return null;
    }
  };

  const terminateWorker = () => {
    if (state.worker) {
      state.worker.terminate();
      state.worker = null;
    }
  };

  const parseDXFAsync = (dxfText: string): Promise<DxfData> => {
    const w = getOrCreateWorker();
    if (!w) {
      return Promise.resolve(parseDXF(dxfText));
    }
    const id = ++state.messageId;
    return new Promise<DxfData>((resolve, reject) => {
      const onMessage = (event: MessageEvent) => {
        if (event.data.id !== id) return;
        w.removeEventListener("message", onMessage);
        w.removeEventListener("error", onError);
        if (event.data.success) {
          resolve(event.data.data);
        } else {
          reject(new Error(`DXF file parsing error: ${event.data.error}`));
        }
      };
      const onError = (event: ErrorEvent) => {
        w.removeEventListener("message", onMessage);
        w.removeEventListener("error", onError);
        reject(new Error(`Worker error: ${event.message}`));
      };
      w.addEventListener("message", onMessage);
      w.addEventListener("error", onError);
      w.postMessage({ id, dxfText });
    });
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
      const extMin = dxf.header?.["$EXTMIN"] as { x: number; y: number; z?: number } | undefined;
      const extMax = dxf.header?.["$EXTMAX"] as { x: number; y: number; z?: number } | undefined;

      let box: THREE.Box3;
      if (extMin && extMax && extMin.x < extMax.x && extMin.y < extMax.y) {
        box = new THREE.Box3(
          new THREE.Vector3(extMin.x, extMin.y, extMin.z ?? 0),
          new THREE.Vector3(extMax.x, extMax.y, extMax.z ?? 0),
        );
      } else {
        box = new THREE.Box3().setFromObject(result.group);
      }

      const center = box.getCenter(new THREE.Vector3());

      // Shift group to origin for float32 precision on large coordinates
      state.originOffset.set(center.x, center.y, 0);
      result.group.position.set(-center.x, -center.y, 0);
      box.translate(new THREE.Vector3(-center.x, -center.y, 0));

      // OrbitControls target at origin (group already shifted)
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
    terminateWorker();
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
