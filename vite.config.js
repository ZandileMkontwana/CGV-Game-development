import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base — required so the game works from any subdirectory on the LAMP server.
  // An absolute '/' would 404 once published under /<group-folder>/.
  base: './',

  build: {
    // Keep output readable for debugging on the server.
    sourcemap: false,
  },

  server: {
    open: true,
  },
});
