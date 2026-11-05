import { defineConfig } from "vite";

// Vite 8 bundles with Rolldown: manualChunks must be a function.
const vendorChunk = (id) => {
  if (id.includes("node_modules/plotly.js-dist-min")) return "plotly";
  if (id.includes("node_modules/three")) return "three";
  return undefined;
};

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 6000,
    rollupOptions: { output: { manualChunks: vendorChunk } },
  },
  server: { port: 5173 },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.js"],
    coverage: { provider: "v8", include: ["src/**/*.js"], reporter: ["text", "text-summary"] },
  },
});
