/**
 * PKCE (RFC 7636) para el Authorization Code de Cognito (US-01, Contratos §8).
 * El `code_verifier` es un secreto de un solo uso que nunca sale del navegador salvo en el
 * intercambio final; al Hosted UI solo viaja su huella SHA-256 (`code_challenge`).
 */

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Cadena aleatoria URL-safe; 32 bytes → 43 caracteres (RFC 7636 pide 43–128). */
export function randomUrlSafe(byteLength = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** `code_challenge` = BASE64URL(SHA-256(verifier)), método S256. */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}
