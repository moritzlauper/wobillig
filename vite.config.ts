import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { seoPlugin } from './build/seo-plugin';

// Each city needs metadata in the initial HTML for link-preview crawlers.
export default defineConfig({
  plugins: [seoPlugin()],
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
