import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': './src',
      '~bootstrap': 'node_modules/bootstrap',
      '@manifest': './public/manifest.json'
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
  base: './'
});
