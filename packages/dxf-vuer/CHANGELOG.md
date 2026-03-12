# Changelog

## 2.1.0

### Features

- **Theme-adaptive layer colors**: layer panel now correctly inverts ACI 250-251 gray colors in dark mode via `resolveThemeColor()`.

### Bug Fixes

- **sRGB color output**: added `OutputPass` to the post-processing pipeline for correct linear→sRGB color conversion.
- **Three.js addon imports**: updated import paths from `three/examples/jsm/` to `three/addons/` for Three.js 0.182 compatibility.

### Dependencies

- Requires `dxf-render` ≥ 1.1.0 (new `resolveThemeColor` export).

## 2.0.2

Initial public release.
