import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// StůlHraje – PWA konfigurace. Manifest slouží zároveň jako základ aplikace
// pro Android (Trusted Web Activity, balíček cz.stulhraje.app): ikony,
// barvy, start_url a zkratky se propisují do nainstalované appky.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        // Stažení APK a soubory pro ověření domény nesmí zachytit SPA fallback
        navigateFallbackDenylist: [/^\/download\//, /^\/\.well-known\//],
      },
      manifest: {
        id: '/',
        name: 'StůlHraje',
        short_name: 'StůlHraje',
        description: 'Objednávky, platby a hry u stolu pro hospody, bary a restaurace.',
        lang: 'cs',
        dir: 'ltr',
        theme_color: '#0f1115',
        background_color: '#0f1115',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['food', 'entertainment', 'games', 'lifestyle'],
        prefer_related_applications: false,
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          {
            name: 'Naskenovat QR kód stolu',
            short_name: 'Skenovat stůl',
            url: '/skenovat',
            icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Mapa podniků',
            short_name: 'Podniky',
            url: '/podniky',
            icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
  },
  preview: {
    host: true,
    port: 5173,
    allowedHosts: true,
  },
})
