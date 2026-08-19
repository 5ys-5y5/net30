import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

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
    fs: { allow: [".."] },
  },
});
