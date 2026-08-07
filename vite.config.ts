import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // Force these into their own vendor chunks regardless of how the
        // automatic heuristic happens to group things route-to-route (it
        // previously split dexie into its own chunk on its own, but that
        // was an accidental side effect of the exact set of lazy routes
        // importing it — removing a route was enough to tip it back into
        // the main entry chunk). Keeping the entry chunk small matters
        // since it loads on every single page view.
        manualChunks(id) {
          if (id.includes('node_modules/dexie')) return 'dexie'
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'recharts'
          if (id.includes('node_modules/framer-motion')) return 'framer-motion'
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Finance Tracker',
        short_name: 'Finance',
        description: 'Personal finance tracker — accounts, budgets, bills and payouts',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        // Long-press the installed app icon for these — most home screens
        // show 2-4. "Quick command" links to a URL (not a button) since
        // that's all a launcher shortcut can target; CommandBar.tsx opens
        // itself on seeing ?command=1 and immediately strips it from the URL.
        shortcuts: [
          {
            name: 'Add transaction',
            short_name: 'Add',
            url: '/#/add',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Quick command',
            short_name: 'Command',
            url: '/#/?command=1',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
    }),
  ],
})
