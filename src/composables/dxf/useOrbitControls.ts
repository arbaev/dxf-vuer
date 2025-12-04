// Управление OrbitControls для интерактивного просмотра 3D моделей
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Настройки OrbitControls
const ENABLE_DAMPING = false; // Плавное затухание движения (отключено для экономии ресурсов)
const DAMPING_FACTOR = 0.05; // Коэффициент затухания
const MIN_DISTANCE = 1; // Минимальное расстояние зума
const MAX_DISTANCE = 1000; // Максимальное расстояние зума
const PAN_SPEED = 1.0; // Скорость панорамирования
const ZOOM_SPEED = 1.0; // Скорость зума

// Кнопки мыши для управления
const MOUSE_BUTTONS = {
  LEFT: THREE.MOUSE.PAN, // Левая кнопка - панорамирование
  MIDDLE: THREE.MOUSE.PAN, // Средняя кнопка - панорамирование
  RIGHT: THREE.MOUSE.PAN, // Правая кнопка - панорамирование
};

export function useOrbitControls() {
  let controls: OrbitControls | null = null;

  // Инициализация OrbitControls (работает с любой камерой)
  const initControls = (camera: THREE.Camera, domElement: HTMLElement) => {
    // Создаем controls
    controls = new OrbitControls(camera, domElement);

    // Настройка поведения
    controls.enableDamping = ENABLE_DAMPING;
    controls.dampingFactor = DAMPING_FACTOR;

    // Ограничения зума
    controls.minDistance = MIN_DISTANCE;
    controls.maxDistance = MAX_DISTANCE;

    // Скорости управления
    controls.panSpeed = PAN_SPEED;
    controls.zoomSpeed = ZOOM_SPEED;

    // Назначение кнопок мыши
    controls.mouseButtons = MOUSE_BUTTONS;

    // Включаем только pan и zoom (без вращения)
    controls.enableRotate = false; // Вращение отключено
    controls.enablePan = true; // Панорамирование любой кнопкой
    controls.enableZoom = true; // Зум колесом мыши

    return controls;
  };

  const updateControls = () => {
    if (controls && controls.enableDamping) {
      controls.update();
    }
  };

  const getControls = () => controls;

  // Сохранение текущего состояния камеры и контролов как исходного
  const saveState = () => {
    if (controls) {
      controls.saveState();
    }
  };

  // Сброс камеры и контролов в исходное состояние
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
    updateControls,
    getControls,
    saveState,
    resetCamera,
    cleanup,
  };
}
