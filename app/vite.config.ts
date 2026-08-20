import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const modelingHubPort = Number(process.env.NET30_MODELING_HUB_PORT ?? 8788);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      react: fileURLToPath(new URL("./node_modules/react", import.meta.url)),
      "react-dom": fileURLToPath(new URL("./node_modules/react-dom", import.meta.url)),
      cobe: fileURLToPath(new URL("./node_modules/cobe/dist/index.esm.js", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: { allow: [".."] },
    proxy: {
      "/3d": {
        target: "http://127.0.0.1:5174",
        changeOrigin: false,
      },
      "/models": {
        target: "http://127.0.0.1:5174",
        changeOrigin: false,
        rewrite: (pathname) => `/3d${pathname}`,
      },
      "/qa": {
        target: "http://127.0.0.1:5174",
        changeOrigin: false,
        rewrite: (pathname) => `/3d${pathname}`,
      },
      "/api/modeling": {
        target: `http://127.0.0.1:${modelingHubPort}`,
        changeOrigin: false,
      },
    },
  },
});
