import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
// import json from "@rollup/plugin-json";
// import ViteYaml from '@modyfi/vite-plugin-yaml';
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // json(),
    // ViteYaml()
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "~bootstrap": path.resolve(__dirname, "node_modules/bootstrap"),
      '@manifest': path.resolve(__dirname, './public/manifest.json')
    },
  },
  build: {
    outDir: 'com.r-teller.sonoscontroller.sdPlugin',
    rollupOptions: {
      input: {
        pi: "pi.html",
        plugin: "plugin.html",
      },
    },
  },
  base: "./",
});
