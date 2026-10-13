import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { target: "chrome87" },
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    // Preserve the browser Host so media origin checks match the dashboard URL.
    proxy: {
      "^/memo(?:/|$)": {
        target: "http://127.0.0.1:8000",
        changeOrigin: false,
        rewrite: path => path.replace(/^\/memo(?=\/|$)/, "") || "/",
      },
      "^/calendar(?:/|$)": {
        target: "http://127.0.0.1:4173",
        rewrite: path => path.replace(/^\/calendar(?=\/|$)/, "") || "/",
      },
      "^/api(?:/|$)": {
        target: "http://127.0.0.1:3001",
        changeOrigin: false,
      },
    },
  },
});
