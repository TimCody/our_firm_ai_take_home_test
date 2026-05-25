import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // Vite proxies /api/* to the backend in dev so the frontend can
      // use same-origin fetches and skip CORS preflight cost.
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  // pdfjs ships a worker we serve from /pdf.worker.min.mjs in public/
  optimizeDeps: {
    include: ["pdfjs-dist"],
  },
});
