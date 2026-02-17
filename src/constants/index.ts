// Константы для DXF Vuer

// ============================================================================
// CAMERA - настройки камеры Three.js
// ============================================================================

// Угол обзора (Field of View) камеры в градусах
export const CAMERA_FOV = 75;

// Ближняя плоскость отсечения камеры
export const CAMERA_NEAR_PLANE = -2000;

// Дальняя плоскость отсечения камеры
export const CAMERA_FAR_PLANE = 2000;

// Начальная Z-позиция камеры
export const CAMERA_INITIAL_Z_POSITION = 100;

// Отступ камеры от границ вьюпорта (множитель для fitCameraToObject)
export const CAMERA_PADDING = 1.25;

// ============================================================================
// SCENE - настройки сцены Three.js
// ============================================================================

// Цвет фона сцены
export const SCENE_BG_COLOR = "#fafafa";

// ============================================================================
// COLORS - цвета для отрисовки DXF элементов
// ============================================================================

// Цвет по умолчанию когда entity/layer цвет не определён (белый → чёрный на светлом фоне)
export const DEFAULT_ENTITY_COLOR = "#000000";

// Fallback цвета (используются когда colorResolver недоступен)
export const TEXT_COLOR = "#1976d2";
export const LINE_COLOR = "#1976d2";
export const DIM_LINE_COLOR = "#606060";

// ============================================================================
// TEXT - настройки текста
// ============================================================================

// Высота текста по умолчанию
export const TEXT_HEIGHT = 16;

// Высота текста размерных линий
export const DIM_TEXT_HEIGHT = 5;

// Коэффициент для расчета ширины разрыва размерной линии для текста
export const DIM_TEXT_GAP_MULTIPLIER = 1.5;

// Ширина разрыва размерной линии для текста
export const DIM_TEXT_GAP = DIM_TEXT_HEIGHT * DIM_TEXT_GAP_MULTIPLIER;

// Количество знаков после запятой для текста размерности
export const DIM_TEXT_DECIMAL_PLACES = 0;

// ============================================================================
// GEOMETRY - настройки геометрии
// ============================================================================

// Длина стрелки размерных линий
export const ARROW_SIZE = 6;

// Делитель для расчета ширины основания стрелки (длина стрелки / 4)
export const ARROW_BASE_WIDTH_DIVISOR = 4;

// Количество сегментов для окружности
export const CIRCLE_SEGMENTS = 128;

// Размер штриха пунктирной выносной линии
export const EXTENSION_LINE_DASH_SIZE = 2;

// Размер промежутка пунктирной выносной линии
export const EXTENSION_LINE_GAP_SIZE = 1;

// Порог для проверки близости к нулю (для bulge и длин)
export const EPSILON = 0.0001;

// Минимальное количество сегментов для отрисовки дуги
export const MIN_ARC_SEGMENTS = 8;

// Множитель для расчёта сегментов NURBS (controlPoints * NURBS_SEGMENTS_MULTIPLIER)
export const NURBS_SEGMENTS_MULTIPLIER = 4;

// Минимальное количество сегментов для NURBS кривой
export const MIN_NURBS_SEGMENTS = 100;

// Множитель для расчёта сегментов CatmullRom (points * CATMULL_ROM_SEGMENTS_MULTIPLIER)
export const CATMULL_ROM_SEGMENTS_MULTIPLIER = 2;

// Минимальное количество сегментов для CatmullRom сплайна
export const MIN_CATMULL_ROM_SEGMENTS = 50;

// Размер маркера точки POINT в пикселях (sizeAttenuation: false)
export const POINT_MARKER_SIZE = 3;

// ============================================================================
// TIMING - временные константы
// ============================================================================

// Задержка debounce для resize и других операций (в миллисекундах)
export const DEBOUNCE_DELAY = 300;

// ============================================================================
// MATH - математические константы
// ============================================================================

// Делитель для преобразования градусов в радианы (180)
export const DEGREES_TO_RADIANS_DIVISOR = 180;
