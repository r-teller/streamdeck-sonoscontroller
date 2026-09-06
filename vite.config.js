import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL("./src", import.meta.url)),
      '~bootstrap': fileURLToPath(new URL("./node_modules/bootstrap", import.meta.url)),
      '@manifest': fileURLToPath(new URL("./public/manifest.json", import.meta.url))
    }
  },
  build: {
    outDir: 'com.r-teller.sonoscontroller.sdPlugin',
    rollupOptions: {
      input: {
        pi: 'pi.html',
        plugin: 'plugin.html'
      }
    }
  },
  base: './',
  test: {
    setupFiles: ["tests/setup.js"],
    include: ["tests/unit/**/*.test.js"]
  }
});
