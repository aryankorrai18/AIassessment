import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// /api is proxied to the backend so cookies are same-origin in dev (mirrors the Hosting rewrite).
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true, proxy: { "/api": "http://localhost:4000" } },
  preview: { port: 5174, proxy: { "/api": "http://localhost:4000" } },
});
