import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Each city needs metadata in the initial HTML for link-preview crawlers.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        zurich: fileURLToPath(new URL('./index.html', import.meta.url)),
        bern: fileURLToPath(new URL('./bern/index.html', import.meta.url)),
        basel: fileURLToPath(new URL('./basel/index.html', import.meta.url)),
      },
    },
  },
});
