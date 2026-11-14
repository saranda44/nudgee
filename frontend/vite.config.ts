/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// En producción la PWA y la API comparten origen vía CloudFront (`/v1/*`). En local, el
// proxy de Vite reproduce ese mismo origen, así no hace falta CORS en la API.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true, // el callback de Cognito está registrado en :5173
      proxy: env.API_PROXY_TARGET ? { "/v1": { target: env.API_PROXY_TARGET, changeOrigin: true } } : undefined,
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
      env: { VITE_COGNITO_DOMAIN: "https://auth.test", VITE_COGNITO_CLIENT_ID: "test-client" },
    },
  };
});
