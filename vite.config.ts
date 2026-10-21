import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { seoPlugin } from './build/seo-plugin';

// Each city needs metadata in the initial HTML for link-preview crawlers.
export default defineConfig({
  plugins: [seoPlugin(), {
    name: 'local-google-rating',
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'assets/deals-leaflet.css', source: readFileSync('node_modules/leaflet/dist/leaflet.css', 'utf8') }); },
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), 'GOOGLE_PLACES_');
      process.env.GOOGLE_PLACES_API_KEY ||= env.GOOGLE_PLACES_API_KEY;
      process.env.BLOB_READ_WRITE_TOKEN ||= loadEnv(server.config.mode, process.cwd(), 'BLOB_READ_WRITE_TOKEN').BLOB_READ_WRITE_TOKEN;
      const reviewPassword = loadEnv(server.config.mode, process.cwd(), 'MAP_REVIEW_PASSWORD').MAP_REVIEW_PASSWORD;
      if (reviewPassword) process.env.MAP_REVIEW_PASSWORD ||= reviewPassword;
      const photonUrl = loadEnv(server.config.mode, process.cwd(), 'PHOTON_URL').PHOTON_URL;
      if (photonUrl) process.env.PHOTON_URL ||= photonUrl;
      server.middlewares.use('/api/google-rating', async (req, res, next) => {
        try {
          const { default: handler } = await server.ssrLoadModule('/api/google-rating.ts');
          await handler(req, res);
        } catch (error) { next(error); }
      });
      process.env.ANTHROPIC_API_KEY ||= loadEnv(server.config.mode, process.cwd(), 'ANTHROPIC_API_KEY').ANTHROPIC_API_KEY;
      for (const route of ['coffee-rating', 'scan-menu', 'map-review', 'deals']) server.middlewares.use(`/api/${route}`, async (req, res, next) => {
        try {
          const { default: handler } = await server.ssrLoadModule(`/api/${route}.ts`);
          await handler(req, res);
        } catch (error) { next(error); }
      });
      server.middlewares.use('/api/prices', async (req, res, next) => {
        try {
          const { default: handler } = await server.ssrLoadModule('/api/prices.ts');
          await handler(req, res);
        } catch (error) { next(error); }
      });
    },
  }],
  build: {
    rollupOptions: {
      output: { entryFileNames: chunk => chunk.name === 'dealsPreview' ? 'assets/deals-preview.js' : 'assets/[name]-[hash].js' },
      input: {
        dealsPreview: fileURLToPath(new URL('./src/deal-preview.ts', import.meta.url)),
        zurich: fileURLToPath(new URL('./index.html', import.meta.url)),
        bern: fileURLToPath(new URL('./bern/index.html', import.meta.url)),
        geneva: fileURLToPath(new URL('./de/genf/index.html', import.meta.url)),
        lausanne: fileURLToPath(new URL('./de/lausanne/index.html', import.meta.url)),
        basel: fileURLToPath(new URL('./basel/index.html', import.meta.url)),
        zurichEn: fileURLToPath(new URL('./en/index.html', import.meta.url)),
        bernEn: fileURLToPath(new URL('./en/bern/index.html', import.meta.url)),
        genevaEn: fileURLToPath(new URL('./en/genf/index.html', import.meta.url)),
        lausanneEn: fileURLToPath(new URL('./en/lausanne/index.html', import.meta.url)),
        baselEn: fileURLToPath(new URL('./en/basel/index.html', import.meta.url)),
      },
    },
  },
});
