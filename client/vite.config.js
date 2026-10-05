import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev the Vite server proxies API + WebSocket traffic to the Node backend,
// so the browser only ever talks to one origin (no CORS headaches).
const BACKEND = process.env.VITE_DEV_BACKEND || "http://localhost:5000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": BACKEND,
      "/socket.io": { target: BACKEND, ws: true },
    },
  },
});
