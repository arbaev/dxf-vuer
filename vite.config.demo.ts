import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

// Конфиг для демо-приложения (dev-сервер и сборка для Netlify)
export default defineConfig({
  plugins: [vue()],
  root: "demo",
  publicDir: path.resolve(__dirname, "public"),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: path.resolve(__dirname, "dist-demo"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three", "three/examples/jsm/curves/NURBSCurve.js"],
        },
      },
    },
  },
});
