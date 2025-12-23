// Управление камерой Three.js
import * as THREE from "three";
import { CAMERA_PADDING, CAMERA_INITIAL_Z_POSITION, DEBOUNCE_DELAY } from "@/constants";

export function useCamera() {
  let isResizing = false;

  // Подгонка камеры под размер объекта (для ортогональной камеры)
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

    // Для ортогональной камеры позиционируем камеру строго перпендикулярно к плоскости XY
    // Камера всегда на фиксированной высоте
    camera.position.set(center.x, center.y, CAMERA_INITIAL_Z_POSITION);
    camera.lookAt(center.x, center.y, 0);

    // Вычисляем zoom для подгонки объекта в видимую область
    const visibleHeight = camera.top - camera.bottom;
    const visibleWidth = camera.right - camera.left;

    // Определяем какое измерение (ширина или высота) будет ограничивающим
    const scaleX = visibleWidth / (size.x * CAMERA_PADDING);
    const scaleY = visibleHeight / (size.y * CAMERA_PADDING);

    // Используем меньший масштаб, чтобы весь объект поместился
    camera.zoom = Math.min(scaleX, scaleY);
    camera.updateProjectionMatrix();
  };

  // Обработка изменения размера контейнера (для ортогональной камеры)
  const handleResize = (
    container: HTMLDivElement,
    camera: THREE.OrthographicCamera | null,
    renderer: THREE.WebGLRenderer | null,
    scene: THREE.Scene | null,
    currentObject: THREE.Object3D | null
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

        // Для ортогональной камеры обновляем границы frustum при изменении размера
        const aspect = containerWidth / containerHeight;
        const frustumSize = 100;

        camera.left = (frustumSize * aspect) / -2;
        camera.right = (frustumSize * aspect) / 2;
        camera.top = frustumSize / 2;
        camera.bottom = frustumSize / -2;
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
