import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site from /overachiever/. The deploy workflow sets BASE_PATH.
// Locally it defaults to the root.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: true },
});
