import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// every build gets an id; the app knows its own id (__BUILD_ID__) and the build also publishes it as /version.json, so a running app can see "a newer build exists" within
// seconds, long before the service worker has downloaded the new files (src/update.js)
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 10) + Date.now().toString(36);
const buildInfo = () => ({ name: 'build-info', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) }); } });

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  build: {
    rollupOptions: { output: { manualChunks(id) { if (id.includes('node_modules/pdfjs-dist')) return 'pdfjs-lib'; } } },   // the PDF reader used by the overtime scan: its own chunk, not precached
  },
  plugins: [
    buildInfo(),
    VitePWA({
      registerType: 'prompt',          // a new build waits until the person taps Refresh (src/update.js)
      injectRegister: false,
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Timesheet',
        short_name: 'Timesheet',
        description: 'Daily status and overtime recording',
        start_url: '/',
        display: 'standalone',
        background_color: '#f4f6f8',
        theme_color: '#0f766e',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell is cached; Supabase API calls always go to the network.
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,woff2}'],      // the developer-name font is part of the app shell
        navigateFallbackDenylist: [/^\/functions\//, /^\/auth\//, /^\/rest\//],
        // the OCR engine (several MB) is NOT part of the app shell: cached on first use instead (works offline afterwards)
        globIgnores: ['**/tesseract-core*', '**/pdf.worker*', '**/worker.min*', '**/pdfjs-lib*'],
        runtimeCaching: [{ urlPattern: /\/(ocr\/lang\/|assets\/(tesseract-core|pdf\.worker|worker\.min|pdfjs-lib))/, handler: 'CacheFirst', options: { cacheName: 'ocr-engine', expiration: { maxEntries: 12 } } }],
      },
    }),
  ],
});
