import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: true,
  },
  worker: {
    format: "es",
  },
});
