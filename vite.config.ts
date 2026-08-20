import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globIgnores: [
          '**/assets/annualCashReportPdf-*.js',
          '**/assets/charts-vendor-*.js',
          '**/assets/contractGenerator-*.js',
          '**/assets/html2canvas*.js',
          '**/assets/jspdf*.js',
        ],
      },
      manifest: {
        name: 'GR SOLUTION',
        short_name: 'GR SOLUTION',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/pwa-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/pwa-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@firebase') || id.includes('/firebase/')) return 'firebase-vendor'
          if (id.includes('react-dom') || id.includes('/react/')) return 'react-vendor'
          if (id.includes('recharts') || id.includes('/d3-')) return 'charts-vendor'
          return undefined
        },
      },
    },
  },
})
