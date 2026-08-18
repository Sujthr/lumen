import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The dev server proxies /api to the Lumen proxy on 8115. The control token
// lives there and never reaches this bundle — Vite inlines every VITE_*
// variable into the shipped JavaScript, so a token here would be published.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Vite otherwise binds only ::1 here, so a browser that resolves localhost
    // to IPv4 first gets a refused connection and shows a blank page.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8115',
        changeOrigin: true,
        // Server-sent events must not be buffered into one late reveal.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              delete proxyRes.headers['content-length']
            }
          })
        },
      },
    },
  },
})
