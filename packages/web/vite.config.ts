import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds one self-contained index.html: opens from disk, embeds in IDE webviews, no CDN.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  server: { fs: { allow: ['../..'] } },
});
