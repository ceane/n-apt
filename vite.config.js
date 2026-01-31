import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
