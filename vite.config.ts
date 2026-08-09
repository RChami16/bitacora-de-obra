import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  server: {
    // El entorno de desarrollo arranca Vite desde una ruta corta (8.3) de
    // Windows para evitar problemas de codificación con el acento de
    // "Bitácora" en la ruta real; esto confunde el chequeo de seguridad
    // fs.allow de Vite, así que lo relajamos solo en local.
    fs: { strict: false },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Bitácora de Obra',
        short_name: 'Bitácora',
        description: 'Bitácora de obra colaborativa: fotos, notas y audio, con o sin conexión.',
        theme_color: '#e67e22',
        background_color: '#faf6f0',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        lang: 'es',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cachea el shell de la app para que abra offline.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // Las fotos/audio no pasan por aquí: se guardan directo en IndexedDB.
        runtimeCaching: [],
      },
      devOptions: {
        enabled: true, // permite probar el service worker con `npm run dev`
      },
    }),
  ],
})
