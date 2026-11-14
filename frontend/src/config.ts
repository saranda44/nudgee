/** Configuración del despliegue (variables VITE_* de .env; ver .env.example). */

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Falta ${name} en el .env del frontend (ver .env.example)`);
  return value.replace(/\/+$/, "");
}

export const config = {
  cognitoDomain: required("VITE_COGNITO_DOMAIN", import.meta.env.VITE_COGNITO_DOMAIN),
  cognitoClientId: required("VITE_COGNITO_CLIENT_ID", import.meta.env.VITE_COGNITO_CLIENT_ID),
  /** NFR-08: solo lo necesario para identificar al usuario. */
  scopes: "openid email profile",
  redirectPath: "/auth/callback",
  logoutPath: "/login",
};
