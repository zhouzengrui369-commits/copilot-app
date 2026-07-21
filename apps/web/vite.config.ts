import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const proxyTarget = process.env.OPENCLAW_WEB_PROXY_TARGET || "http://127.0.0.1:38888";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": proxyTarget
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three/")) return "three";
          if (id.includes("node_modules/@xyflow")) return "xyflow";
          if (id.includes("node_modules/mermaid") || id.includes("node_modules/@braintree")) return "mermaid";
          if (id.includes("node_modules/markmap")) return "markmap";
          if (id.includes("node_modules/katex")) return "katex";
          if (id.includes("node_modules/qrcode")) return "qrcode";
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/") || id.includes("node_modules/scheduler/")) return "react";
        }
      }
    }
  }
});
