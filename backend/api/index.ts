import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  console.log("Request recibido:", event.rawPath, event.requestContext.http.method);

  // TODO:
  // 1. Enrutar por método + rawPath a la acción correspondiente (perfil, biblioteca,
  //    acciones de ítem con ETag/If-Match, checklist, suscripciones push,
  //    apertura desde notificación, /config) — todo /v1 salvo POST /items
  // 2. Validar el body con los schemas de backend/schemas (Ajv) donde aplique
  // 3. Transiciones de estado como escrituras condicionales (status + version, RF §4)
  // 4. Errores en RFC 9457 con code estable

  return {
    statusCode: 404,
    body: JSON.stringify({ message: "Ruta no implementada" }),
  };
};
