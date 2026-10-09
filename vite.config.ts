import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { generateReadingFixture } from './scripts/reading-fixture';
generateReadingFixture();
export default defineConfig({ plugins: [react(), tailwind()], server: { proxy: { '/api': { target:'http://127.0.0.1:8787',changeOrigin:false } } } });
