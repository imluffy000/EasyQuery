import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: 5173,
    proxy: {
      // Dev-only: lets the app call /api without CORS while running locally.
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        // Monaco and Recharts dominate the bundle and are not needed on the
        // login or dashboard route. Splitting them keeps first paint small
        // and lets them cache independently of app code.
        manualChunks: {
          monaco: ['@monaco-editor/react'],
          charts: ['recharts'],
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
})
