# Changelog

## 1.1.0

### Features

- **Theme-adaptive ACI 250-251**: dark gray colors (ACI 250, 251) now invert to light grays in dark mode, keeping them visible against dark backgrounds. New exports: `isThemeAdaptiveColor()`, `resolveThemeColor()`.

### Bug Fixes

- **Single-point polyline**: polylines with a single vertex are now rendered as points instead of being silently skipped.
- **Layer default visibility**: layers now default to `visible: true`, `frozen: false`, `locked: false` when flags are not explicitly set in the DXF file.
- **Three.js addon imports**: updated import paths from `three/examples/jsm/` to `three/addons/` for Three.js 0.182 compatibility.

## 1.0.3

Initial public release.
