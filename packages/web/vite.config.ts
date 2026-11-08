import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds one self-contained HTML file: opens from disk, embeds in IDE webviews, no CDN.
// `--mode embed` builds the view-only page for IDE plugins; chrome97 is the Chromium
// bundled with IntelliJ 2022.1, the oldest IDE the plugin supports.
export default defineConfig(({ mode }) => ({
  plugins: [react(), viteSingleFile()],
  base: './',
  server: { fs: { allow: ['../..'] } },
  build: mode === 'embed' ? { target: 'chrome97', outDir: 'dist-embed', rollupOptions: { input: 'embed.html' } } : {},
}));
