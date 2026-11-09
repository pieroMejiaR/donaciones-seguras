import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // La URL de callback debe coincidir exactamente con la registrada en Cognito,
    // así que el servidor falla en lugar de cambiar de puerto en silencio.
    host: "localhost",
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost:5173/" } },
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
