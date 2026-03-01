import * as THREE from "three";
import { CAMERA_PADDING, CAMERA_INITIAL_Z_POSITION } from "@/constants";

export function useCamera() {
  let isResizing = false;

  const fitCameraToObject = (object: THREE.Object3D, camera: THREE.OrthographicCamera) => {
    const box = new THREE.Box3().setFromObject(object);

    if (box.isEmpty()) {
      camera.position.set(0, 0, CAMERA_INITIAL_Z_POSITION);
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    camera.position.set(center.x, center.y, CAMERA_INITIAL_Z_POSITION);
    camera.lookAt(center.x, center.y, 0);

    const visibleHeight = camera.top - camera.bottom;
    const visibleWidth = camera.right - camera.left;

    const scaleX = visibleWidth / (size.x * CAMERA_PADDING);
    const scaleY = visibleHeight / (size.y * CAMERA_PADDING);

    // Use the smaller scale so the entire object fits in view
    camera.zoom = Math.min(scaleX, scaleY);
    camera.updateProjectionMatrix();
  };

  // Only updates frustum aspect ratio and renderer size; zoom and position are preserved
  const handleResize = (
    container: HTMLDivElement,
    camera: THREE.OrthographicCamera | null,
    renderer: THREE.WebGLRenderer | null,
    scene: THREE.Scene | null,
  ) => {
    if (isResizing) {
      return;
    }

    isResizing = true;

    requestAnimationFrame(() => {
      isResizing = false;

      if (!camera || !renderer || !scene) {
        return;
      }

      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      if (containerWidth <= 0 || containerHeight <= 0) {
        return;
      }

      const aspect = containerWidth / containerHeight;
      const frustumSize = 100;

      camera.left = (frustumSize * aspect) / -2;
      camera.right = (frustumSize * aspect) / 2;
      camera.top = frustumSize / 2;
      camera.bottom = frustumSize / -2;
      camera.updateProjectionMatrix();

      renderer.setSize(containerWidth, containerHeight);

      renderer.render(scene, camera);
    });
  };

  const resetResizing = () => {
    isResizing = false;
  };

  return {
    fitCameraToObject,
    handleResize,
    resetResizing,
  };
}
