// Управление камерой Three.js
import * as THREE from "three";
import {
  CAMERA_PADDING,
  CAMERA_INITIAL_Z_POSITION,
  DEBOUNCE_DELAY,
  DEGREES_TO_RADIANS_DIVISOR,
} from "@/constants";

export function useCamera() {
  let isResizing = false;

  // Подгонка камеры под размер объекта
  const fitCameraToObject = (object: THREE.Object3D, camera: THREE.PerspectiveCamera) => {
    const box = new THREE.Box3().setFromObject(object);

    if (box.isEmpty()) {
      camera.position.set(0, 0, CAMERA_INITIAL_Z_POSITION);
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Вычисляем оптимальное расстояние для камеры с учетом aspect ratio и глубины объекта
    const fov = camera.fov * (Math.PI / DEGREES_TO_RADIANS_DIVISOR);
    const aspect = camera.aspect;
    const distanceY = size.y / 2 / Math.tan(fov / 2);
    const fovX = 2 * Math.atan(Math.tan(fov / 2) * aspect);
    const distanceX = size.x / 2 / Math.tan(fovX / 2);

    // Берем максимальное расстояние по X и Y, затем добавляем половину глубины объекта
    // чтобы учесть, что объект может выступать вперед и назад от центра + отступ для полей
    const maxDistance = Math.max(distanceX, distanceY);
    const cameraZ = (maxDistance + size.z / 2) * CAMERA_PADDING;

    camera.position.set(center.x, center.y, center.z + cameraZ);
    camera.lookAt(center);
  };

  // Обработка изменения размера контейнера
  const handleResize = (
    container: HTMLDivElement,
    camera: THREE.PerspectiveCamera | null,
    renderer: THREE.WebGLRenderer | null,
    scene: THREE.Scene | null,
    currentObject: THREE.Object3D | null,
  ) => {
    if (isResizing) {
      return;
    }

    isResizing = true;

    requestAnimationFrame(() => {
      try {
        // Проверяем что Three.js всё ещё инициализирован
        if (!camera || !renderer || !scene) {
          return;
        }

        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;

        if (containerWidth <= 0 || containerHeight <= 0) {
          return;
        }

        camera.aspect = containerWidth / containerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(containerWidth, containerHeight, false);

        if (currentObject) {
          fitCameraToObject(currentObject, camera);
        }

        renderer.render(scene, camera);
      } finally {
        setTimeout(() => {
          isResizing = false;
        }, DEBOUNCE_DELAY);
      }
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
