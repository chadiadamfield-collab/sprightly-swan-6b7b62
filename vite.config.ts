import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

// Deployment target is chosen at BUILD time with the NITRO_PRESET env var:
//   (unset)            -> node-server  (Docker, VPS, Railway, Render, Fly.io...)
//   vercel | netlify | cloudflare_module | static ... (see https://nitro.build/deploy)
// Example: NITRO_PRESET=vercel bun run build
export default defineConfig({
  server: { port: 3000 },
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // Our SSR error wrapper lives in src/server.ts
      server: { entry: "server" },
    }),
    nitro({ preset: process.env.NITRO_PRESET || "node-server" }),
    viteReact(),
    tailwindcss(),
  ],
});
