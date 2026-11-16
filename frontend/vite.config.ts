/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// En local, el proxy de Vite reproduce el mismo origen (`/v1`), así no hace falta CORS para
// desarrollar. En producción la PWA llama a la API cross-origin (VITE_API_BASE_URL en
// config.ts): Learner Lab no permite CloudFront, así que ya no comparten origen (ver
// infra/main.tf); el CORS de la API ya está configurado para esto.
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
