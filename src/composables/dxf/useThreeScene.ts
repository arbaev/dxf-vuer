import { ref } from "vue";
import * as THREE from "three";
import { useOrbitControls } from "./useOrbitControls";
import {
  CAMERA_NEAR_PLANE,
  CAMERA_FAR_PLANE,
  CAMERA_INITIAL_Z_POSITION,
  SCENE_BG_COLOR,
} from "@/constants";

export interface ThreeJSOptions {
  enableControls?: boolean;
}

interface MaterialWithTextures extends THREE.Material {
  map?: THREE.Texture | null;
  lightMap?: THREE.Texture | null;
  bumpMap?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  specularMap?: THREE.Texture | null;
  envMap?: THREE.Texture | null;
  alphaMap?: THREE.Texture | null;
  aoMap?: THREE.Texture | null;
  displacementMap?: THREE.Texture | null;
  emissiveMap?: THREE.Texture | null;
  gradientMap?: THREE.Texture | null;
  metalnessMap?: THREE.Texture | null;
  roughnessMap?: THREE.Texture | null;
}

export function useThreeScene() {
  const webGLSupported = ref(true);
  const error = ref<string | null>(null);

  let scene: THREE.Scene | null = null;
  let camera: THREE.OrthographicCamera | null = null;
  let renderer: THREE.WebGLRenderer | null = null;

  const {
    initControls,
    updateControls,
    getControls,
    saveState: saveOrbitState,
    resetCamera: resetOrbitControls,
    cleanup: cleanupControls,
  } = useOrbitControls();

  // Проверка поддержки WebGL
  const checkWebGLSupport = (): boolean => {
    try {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      return !!context;
    } catch {
      return false;
    }
  };

  // Очистка всех материалов
  const disposeMaterial = (material: THREE.Material) => {
    if (!material) return;

    const mat = material as MaterialWithTextures;

    if (mat.map instanceof THREE.Texture) mat.map.dispose();
    if (mat.lightMap instanceof THREE.Texture) mat.lightMap.dispose();
    if (mat.bumpMap instanceof THREE.Texture) mat.bumpMap.dispose();
    if (mat.normalMap instanceof THREE.Texture) mat.normalMap.dispose();
    if (mat.specularMap instanceof THREE.Texture) mat.specularMap.dispose();
    if (mat.envMap instanceof THREE.Texture) mat.envMap.dispose();
    if (mat.alphaMap instanceof THREE.Texture) mat.alphaMap.dispose();
    if (mat.aoMap instanceof THREE.Texture) mat.aoMap.dispose();
    if (mat.displacementMap instanceof THREE.Texture) mat.displacementMap.dispose();
    if (mat.emissiveMap instanceof THREE.Texture) mat.emissiveMap.dispose();
    if (mat.gradientMap instanceof THREE.Texture) mat.gradientMap.dispose();
    if (mat.metalnessMap instanceof THREE.Texture) mat.metalnessMap.dispose();
    if (mat.roughnessMap instanceof THREE.Texture) mat.roughnessMap.dispose();

    material.dispose();
  };

  // Очистка Three.js объекта и всех его ресурсов
  const disposeObject3D = (object: THREE.Object3D) => {
    if (!object) return;

    object.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        if (child.geometry) {
          child.geometry.dispose();
        }

        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((material) => disposeMaterial(material));
          } else {
            disposeMaterial(child.material);
          }
        }
      }
    });

    while (object.children.length > 0) {
      const child = object.children[0];
      if (child) {
        object.remove(child);
      }
    }
  };

  // Инициализация Three.js сцены
  const initThreeJS = (container: HTMLDivElement, options: ThreeJSOptions = {}) => {
    const { enableControls = false } = options;

    error.value = null;

    if (!checkWebGLSupport()) {
      webGLSupported.value = false;
      error.value = "WebGL is not supported in this browser";
      container.innerHTML = "";
      return;
    }

    scene = new THREE.Scene();
    scene.background = new THREE.Color(SCENE_BG_COLOR);

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const aspect = containerWidth / containerHeight;

    // Для ортогональной проекции используем фиксированную высоту видимой области
    const frustumSize = 100;
    camera = new THREE.OrthographicCamera(
      (frustumSize * aspect) / -2, // left
      (frustumSize * aspect) / 2, // right
      frustumSize / 2, // top
      frustumSize / -2, // bottom
      CAMERA_NEAR_PLANE,
      CAMERA_FAR_PLANE,
    );
    camera.position.set(0, 0, CAMERA_INITIAL_Z_POSITION);
    camera.zoom = 1;

    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
      renderer.setSize(containerWidth, containerHeight);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error creating renderer";
      webGLSupported.value = false;
      error.value = `WebGL initialization error: ${errorMessage}`;
      return;
    }

    container.appendChild(renderer.domElement);

    if (enableControls) {
      initControls(camera, renderer.domElement);
    }
  };

  // Полная очистка всех ресурсов Three.js
  const cleanup = (currentObject: THREE.Object3D | null) => {
    if (currentObject) {
      disposeObject3D(currentObject);
      if (scene) {
        scene.remove(currentObject);
      }
    }

    if (scene) {
      while (scene.children.length > 0) {
        const object = scene.children[0];
        if (object) {
          disposeObject3D(object);
          scene.remove(object);
        }
      }
    }

    cleanupControls();

    if (renderer) {
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
      renderer = null;
    }

    scene = null;
    camera = null;

    error.value = null;
  };

  // Геттеры для доступа к объектам
  const getScene = () => scene;
  const getCamera = () => camera;
  const getRenderer = () => renderer;

  return {
    webGLSupported,
    error,
    initThreeJS,
    cleanup,
    disposeObject3D,
    getScene,
    getCamera,
    getRenderer,
    updateControls,
    getControls,
    saveOrbitState,
    resetOrbitControls,
  };
}
