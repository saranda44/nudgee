/** Configuración del despliegue (variables VITE_* de .env; ver .env.example). */

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Falta ${name} en el .env del frontend (ver .env.example)`);
  return value.replace(/\/+$/, "");
}

export const config = {
  cognitoDomain: required("VITE_COGNITO_DOMAIN", import.meta.env.VITE_COGNITO_DOMAIN),
  cognitoClientId: required("VITE_COGNITO_CLIENT_ID", import.meta.env.VITE_COGNITO_CLIENT_ID),
  /** Vacío = mismo origen (dev local vía proxy de Vite). En producción, la URL del API Gateway:
   *  Learner Lab no permite CloudFront, así que la API se llama cross-origin, con CORS (ARQ §4.1
   *  no aplica tal cual; ver infra/main.tf). */
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, ""),
  /** NFR-08: solo lo necesario para identificar al usuario. */
  scopes: "openid email profile",
  redirectPath: "/auth/callback",
  logoutPath: "/login",
};
