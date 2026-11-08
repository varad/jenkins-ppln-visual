import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds one self-contained HTML file: opens from disk, embeds in IDE webviews, no CDN.
// `--mode embed` builds the view-only page for IDE plugins.
export default defineConfig(({ mode }) => ({
  plugins: [react(), viteSingleFile()],
  base: './',
  server: { fs: { allow: ['../..'] } },
  build: mode === 'embed' ? { outDir: 'dist-embed', rollupOptions: { input: 'embed.html' } } : {},
}));
