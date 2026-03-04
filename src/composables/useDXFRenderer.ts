import { ref } from "vue";
import * as THREE from "three";
import type { Group } from "three";
import { parseDxf } from "@/parser";
import type { DxfData } from "@/types/dxf";
import { SCENE_BG_COLOR, SCENE_BG_COLOR_DARK } from "@/constants";
import { useThreeScene, type ThreeJSOptions } from "./useThreeScene";
import { useCamera } from "./useCamera";
import { createThreeObjectsFromDXF, type DisplaySignal } from "./useDXFGeometry";
import { loadDefaultFont, loadFont } from "./geometry/fontManager";
import ParserWorker from "@/workers/parserWorker?worker&inline";

export function useDXFRenderer() {
  const isLoading = ref(false);
  const displayProgress = ref(0);
  let currentDXFGroup: Group | null = null;
  // Origin offset: group is shifted by -center for float32 precision on large coordinates
  let originOffset = new THREE.Vector3();
  let worker: Worker | null = null;
  let workerFailed = false;
  let messageId = 0;
  let displaySignal: DisplaySignal | null = null;

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

  const { fitCameraToBox, handleResize: handleCameraResize, resetResizing } = useCamera();

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

  const getOrCreateWorker = (): Worker | null => {
    if (workerFailed) return null;
    if (worker) return worker;
    try {
      worker = new ParserWorker();
      return worker;
    } catch {
      workerFailed = true;
      return null;
    }
  };

  const terminateWorker = () => {
    if (worker) {
      worker.terminate();
      worker = null;
    }
  };

  const parseDXFAsync = (dxfText: string): Promise<DxfData> => {
    const w = getOrCreateWorker();
    if (!w) {
      return Promise.resolve(parseDXF(dxfText));
    }
    const id = ++messageId;
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

    if (!scene) {
      return undefined;
    }

    // Update scene background for theme
    scene.background = new THREE.Color(darkTheme ? SCENE_BG_COLOR_DARK : SCENE_BG_COLOR);

    // Cancel previous display if still running
    if (displaySignal) {
      displaySignal.cancelled = true;
    }
    displayProgress.value = 0;
    const signal: DisplaySignal = {
      cancelled: false,
      onProgress: (p: number) => { displayProgress.value = p; },
    };
    displaySignal = signal;

    if (currentDXFGroup) {
      disposeObject3D(currentDXFGroup);
      scene.remove(currentDXFGroup);
      currentDXFGroup = null;
    }

    const font = fontUrl ? await loadFont(fontUrl) : loadDefaultFont();
    const result = await createThreeObjectsFromDXF(dxf, signal, darkTheme, font);

    if (signal.cancelled) {
      return undefined;
    }

    scene.add(result.group);

    currentDXFGroup = result.group;

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
      originOffset.set(center.x, center.y, 0);
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

  const getOriginOffset = () => originOffset;

  const cleanup = () => {
    terminateWorker();
    // Remove listener before cleaning up controls
    const controls = getControls();
    if (controls) {
      controls.removeEventListener("change", render);
    }
    cleanupScene(currentDXFGroup);
    currentDXFGroup = null;
    originOffset = new THREE.Vector3();
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
    cleanup,
    getCamera,
    getRenderer,
    getOriginOffset,
  };
}
