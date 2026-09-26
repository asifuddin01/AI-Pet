import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// @see https://v2.tauri.app/start/frontend/vite/
const host = process.env.TAURI_DEV_HOST;
const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_"],
  build: {
    // macOS 13+ ships Safari 16's WebKit.
    target: "safari16",
    sourcemap: false,
    rolldownOptions: {
      input: {
        pet: page("./index.html"),
        settings: page("./settings.html"),
      },
    },
  },
});
