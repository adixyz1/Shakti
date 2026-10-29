import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        manifest: false,
        includeAssets: [
          'icon.svg',
          'manifest.webmanifest',
          '.well-known/assetlinks.json',
          'icons/icon-192x192.png',
          'icons/icon-512x512.png',
        ],
        workbox: {
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,json,webmanifest,woff2}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [
            /^\/api\//,
            /^\/ws\//,
            /^\/\.well-known\//,
            /\.apk$/i,
          ],
          runtimeCaching: [
            {
              urlPattern: ({ request, url }) =>
                !url.pathname.startsWith('/api/') &&
                (request.destination === 'image' ||
                  request.destination === 'font' ||
                  /\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?)$/i.test(
                    url.pathname
                  )),
              handler: 'CacheFirst',
              options: {
                cacheName: 'saathi-static-assets-cache-first',
                expiration: {
                  maxEntries: 60,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    test: {
      environment: 'jsdom',
      globals: true,
      exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/android/**'],
    },
  };
});
