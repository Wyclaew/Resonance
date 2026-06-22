import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Tauri expects a fixed dev server port and ignores its own source dir.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  // Produce smaller, faster bundles; Tauri targets a modern webview.
  build: {
    target: ["es2021", "chrome105", "safari13"],
    minify: "esbuild",
    sourcemap: false,
  },
  envPrefix: ["VITE_", "TAURI_"],
}));
