import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// The CircuitForge service (kicad-ai-extension/backend) listens on 127.0.0.1:8765.
// Proxying "/api" in dev keeps the browser on one origin, so no CORS is involved.
// Override with CIRCUITFORGE_BACKEND=http://127.0.0.1:9000 (shell or .env).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "CIRCUITFORGE_");
  const backend = env.CIRCUITFORGE_BACKEND || "http://127.0.0.1:8765";
  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      // The backend only accepts browser requests from http://localhost:5173 and http://127.0.0.1:5173,
      // so fail loudly instead of silently moving to another port.
      port: 5173,
      strictPort: true,
      proxy: { "/api": { target: backend, changeOrigin: false, ws: true } }, // ws: live races
    },
  };
});
