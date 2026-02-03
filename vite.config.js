import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  root: './src',
  publicDir: '../public',
  build: {
    outDir: '../dist'
  },
  resolve: {
    alias: [
      { find: /^@n-apt\/(.*)$/, replacement: `${path.resolve(__dirname, 'src')}/$1` },
      { find: '@n-apt', replacement: path.resolve(__dirname, 'src') }
    ]
  },
  server: {
    port: 5173,
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
