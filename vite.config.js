import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    rollupOptions: { output: { manualChunks(id) { if (id.includes('node_modules/pdfjs-dist')) return 'pdfjs-lib'; } } },   // the PDF reader used by the overtime scan: its own chunk, not precached
  },
  plugins: [
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
