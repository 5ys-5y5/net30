import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const modelingHubPort = Number(process.env.NET30_MODELING_HUB_PORT ?? 8788);
const deployedServiceUrl = "https://net30-production.up.railway.app";
const threeServiceTarget = process.env.NET30_3D_PROXY_URL ?? deployedServiceUrl;
const modelingHubTarget = process.env.NET30_MODELING_PROXY_URL ?? deployedServiceUrl;

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
        target: threeServiceTarget,
        changeOrigin: true,
      },
      "/models": {
        target: threeServiceTarget,
        changeOrigin: true,
        rewrite: (pathname) => `/3d${pathname}`,
      },
      "/qa": {
        target: threeServiceTarget,
        changeOrigin: true,
        rewrite: (pathname) => `/3d${pathname}`,
      },
      "/api/modeling": {
        target: modelingHubTarget,
        changeOrigin: true,
      },
    },
  },
});
