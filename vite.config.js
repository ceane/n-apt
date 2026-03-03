import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  root: "./src/ts",
  publicDir: "../../public",
  build: {
    outDir: "../../dist",
  },
  resolve: {
    alias: [
      { find: /^@n-apt\/(.*)$/, replacement: `${path.resolve(__dirname, "src/ts")}/$1` },
      { find: "@n-apt", replacement: path.resolve(__dirname, "src/ts") },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: "ws://localhost:8765",
        ws: true,
      },
      "/auth": {
        target: "http://localhost:8765",
      },
      "/status": {
        target: "http://localhost:8765",
      },
      "/capture": {
        target: "http://localhost:8765",
      },
      "/api": {
        target: "http://localhost:8765",
      },
    },
  },
});
