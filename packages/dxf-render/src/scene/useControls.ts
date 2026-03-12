import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";

const ENABLE_DAMPING = false;
const DAMPING_FACTOR = 0.05;
// Very small min zoom needed for large architectural/engineering drawings
const MIN_ZOOM = 0.00001;
const MAX_ZOOM = 1000;
const PAN_SPEED = 1.0;
const ZOOM_SPEED = 1.0;

// All buttons mapped to PAN — rotation is disabled for 2D DXF viewing
const MOUSE_BUTTONS = {
  LEFT: THREE.MOUSE.PAN,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.PAN,
};

export function useControls() {
  let controls: MapControls | null = null;

  const initControls = (camera: THREE.Camera, domElement: HTMLElement) => {
    controls = new MapControls(camera, domElement);

    controls.enableDamping = ENABLE_DAMPING;
    controls.dampingFactor = DAMPING_FACTOR;
    controls.minZoom = MIN_ZOOM;
    controls.maxZoom = MAX_ZOOM;
    controls.panSpeed = PAN_SPEED;
    controls.zoomSpeed = ZOOM_SPEED;
    controls.mouseButtons = MOUSE_BUTTONS;

    controls.enableRotate = false;
    controls.enablePan = true;
    controls.enableZoom = true;

    // Lock polar angle to Math.PI/2 for top-down 2D view of XY plane
    controls.minPolarAngle = Math.PI / 2;
    controls.maxPolarAngle = Math.PI / 2;

    controls.screenSpacePanning = true;

    return controls;
  };

  const getControls = () => controls;

  const setTarget = (x: number, y: number, z: number) => {
    if (controls) {
      controls.target.set(x, y, z);
      controls.update();
    }
  };

  const saveState = () => {
    if (controls) {
      controls.saveState();
    }
  };

  const resetCamera = () => {
    if (controls) {
      controls.reset();
    }
  };

  const cleanup = () => {
    if (controls) {
      controls.dispose();
      controls = null;
    }
  };

  return {
    initControls,
    getControls,
    setTarget,
    saveState,
    resetCamera,
    cleanup,
  };
}

/** @deprecated Use `useControls` instead */
export const useOrbitControls = useControls;
