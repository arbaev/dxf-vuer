import * as THREE from "three";
import { isThemeAdaptiveColor, resolveThemeColor } from "@/utils/colorResolver";

type ColorMaterial = THREE.Material & { color: THREE.Color };

/**
 * Consolidated cache for Three.js materials used during DXF rendering.
 * Materials are cached per color key to avoid creating duplicates.
 * Theme-dependent materials (ACI 7, dark grays) are tracked for instant dark mode switching.
 */
export class MaterialCacheStore {
  readonly line = new Map<string, THREE.LineBasicMaterial>();
  readonly mesh = new Map<string, THREE.MeshBasicMaterial>();
  readonly points = new Map<string, THREE.PointsMaterial>();

  /** Materials whose color depends on theme — maps material to its sentinel key */
  readonly themeMaterials = new Map<ColorMaterial, string>();

  /** Current dark theme state */
  darkTheme = false;

  /** Resolve color string — replaces theme-adaptive sentinels with concrete hex */
  resolveColor(color: string): string {
    return isThemeAdaptiveColor(color) ? resolveThemeColor(color, this.darkTheme) : color;
  }

  /** Register a material as theme-dependent */
  trackThemeMaterial(mat: ColorMaterial, sentinel: string): void {
    this.themeMaterials.set(mat, sentinel);
  }

  /** Update all theme-dependent materials for new theme */
  switchTheme(darkTheme: boolean): void {
    this.darkTheme = darkTheme;
    for (const [mat, sentinel] of this.themeMaterials) {
      mat.color.set(resolveThemeColor(sentinel, darkTheme));
    }
  }

  /** Dispose all cached materials and clear the maps */
  disposeAll(): void {
    for (const mat of this.line.values()) mat.dispose();
    this.line.clear();
    for (const mat of this.mesh.values()) mat.dispose();
    this.mesh.clear();
    for (const mat of this.points.values()) mat.dispose();
    this.points.clear();
    this.themeMaterials.clear();
  }
}
