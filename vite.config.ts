import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { seoPlugin } from './build/seo-plugin';

// Each city needs metadata in the initial HTML for link-preview crawlers.
export default defineConfig({
  plugins: [seoPlugin(), {
    name: 'local-google-rating',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), 'GOOGLE_PLACES_');
      process.env.GOOGLE_PLACES_API_KEY ||= env.GOOGLE_PLACES_API_KEY;
      process.env.BLOB_READ_WRITE_TOKEN ||= loadEnv(server.config.mode, process.cwd(), 'BLOB_READ_WRITE_TOKEN').BLOB_READ_WRITE_TOKEN;
      server.middlewares.use('/api/google-rating', async (req, res, next) => {
        try {
          const { default: handler } = await server.ssrLoadModule('/api/google-rating.ts');
          await handler(req, res);
        } catch (error) { next(error); }
      });
    },
  }],
  build: {
    rollupOptions: {
      input: {
        zurich: fileURLToPath(new URL('./index.html', import.meta.url)),
        bern: fileURLToPath(new URL('./bern/index.html', import.meta.url)),
        basel: fileURLToPath(new URL('./basel/index.html', import.meta.url)),
        zurichEn: fileURLToPath(new URL('./en/index.html', import.meta.url)),
        bernEn: fileURLToPath(new URL('./en/bern/index.html', import.meta.url)),
        baselEn: fileURLToPath(new URL('./en/basel/index.html', import.meta.url)),
      },
    },
  },
});
