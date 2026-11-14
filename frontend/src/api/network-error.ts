/** Sin red o la petición no llegó (NFR-12: "Sin conexión. Intenta de nuevo."). */
export class NetworkError extends Error {
  constructor() {
    super("Sin conexión");
    this.name = "NetworkError";
  }
}

/** fetch que convierte la falla de red en NetworkError (los AbortError pasan tal cual). */
export async function fetchOrNetworkError(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new NetworkError();
  }
}
