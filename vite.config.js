import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@n-apt': path.resolve(__dirname, './src'),
      '@n-apt/components': path.resolve(__dirname, './src/components'),
      '@n-apt/fft': path.resolve(__dirname, './src/fft'),
      '@n-apt/waterfall': path.resolve(__dirname, './src/waterfall'),
      '@n-apt/consts': path.resolve(__dirname, './src/consts'),
      '@n-apt/hooks': path.resolve(__dirname, './src/hooks'),
      '@n-apt/glb_models': path.resolve(__dirname, './src/glb_models')
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:8765',
        ws: true,
      },
    },
  },
})
