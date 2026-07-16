import { defineConfig } from "vite";

// Standalone build for the GitHub Pages converter, separate from the wxt
// extension build. Emits into docs/convert/ so the existing /docs Pages source
// serves it alongside docs/privacy.html. Relative base so asset URLs work under
// the /header-handler/ project-site path. See docs/adr/0004.
export default defineConfig({
  root: "pages/convert",
  base: "./",
  build: {
    outDir: "../../docs/convert",
    emptyOutDir: true,
  },
});
