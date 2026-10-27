/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { seoPlugin } from './build/seo-plugin';

// Each city needs metadata in the initial HTML for link-preview crawlers.
export default defineConfig({
  // Prebundle every browser dependency before serving pages. Discovering a new
  // shared chunk mid-session otherwise reloads open maps and browser tests.
  optimizeDeps: { noDiscovery: true, include: ['leaflet', '@vercel/analytics', '@stripe/stripe-js'] },
  test: { setupFiles: ['tests/setup.ts'] },
  server: { watch: { ignored: ['**/test-results/**', '**/playwright-report/**'] } },
  plugins: [seoPlugin(), {
    name: 'local-google-rating',
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'assets/deals-leaflet.css', source: readFileSync('node_modules/leaflet/dist/leaflet.css', 'utf8') }); },
    configureServer(server) {
      // Vitest runs this hook too. Tests must not receive secrets from .env.local, or they send real mail.
      if (process.env.VITEST) return;
      const securityEnv = loadEnv(server.config.mode, process.cwd(), ['COMMUNITY_', 'CONTRIBUTION_', 'TURNSTILE_', 'EMAIL_', 'SMTP_']);
      for (const [key, value] of Object.entries(securityEnv)) process.env[key] ||= value;
      const env = loadEnv(server.config.mode, process.cwd(), 'GOOGLE_PLACES_');
      process.env.GOOGLE_PLACES_API_KEY ||= env.GOOGLE_PLACES_API_KEY;
      process.env.TRIPADVISOR_API_KEY ||= loadEnv(server.config.mode, process.cwd(), 'TRIPADVISOR_API_KEY').TRIPADVISOR_API_KEY;
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
      process.env.STRIPE_SECRET_KEY ||= loadEnv(server.config.mode, process.cwd(), 'STRIPE_SECRET_KEY').STRIPE_SECRET_KEY;
      process.env.STRIPE_PUBLISHABLE_KEY ||= loadEnv(server.config.mode, process.cwd(), 'STRIPE_PUBLISHABLE_KEY').STRIPE_PUBLISHABLE_KEY;
      for (const route of ['coffee-rating', 'scan-menu', 'map-review', 'community-auth', 'community-review', 'price-review', 'deals', 'tip']) server.middlewares.use(`/api/${route}`, async (req, res, next) => {
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
        geneva: fileURLToPath(new URL('./de/geneve/index.html', import.meta.url)),
        lausanne: fileURLToPath(new URL('./de/lausanne/index.html', import.meta.url)),
        basel: fileURLToPath(new URL('./basel/index.html', import.meta.url)),
        winterthur: fileURLToPath(new URL('./winterthur/index.html', import.meta.url)),
        olten: fileURLToPath(new URL('./olten/index.html', import.meta.url)),
        zurichEn: fileURLToPath(new URL('./en/index.html', import.meta.url)),
        bernEn: fileURLToPath(new URL('./en/bern/index.html', import.meta.url)),
        genevaEn: fileURLToPath(new URL('./en/geneve/index.html', import.meta.url)),
        lausanneEn: fileURLToPath(new URL('./en/lausanne/index.html', import.meta.url)),
        baselEn: fileURLToPath(new URL('./en/basel/index.html', import.meta.url)),
        winterthurEn: fileURLToPath(new URL('./en/winterthur/index.html', import.meta.url)),
        oltenEn: fileURLToPath(new URL('./en/olten/index.html', import.meta.url)),
      },
    },
  },
});
