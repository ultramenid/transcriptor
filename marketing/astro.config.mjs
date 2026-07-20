// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// Static output, near-zero runtime JS. Tailwind v4 via the vite plugin
// (NOT the v3 @astrojs/tailwind integration).
export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
  },
});
