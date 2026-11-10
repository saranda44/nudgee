import { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomUUID } from "crypto";
import { buildInternalErrorResponse } from "./problem.ts";
import { createRouter } from "./router.ts";
import { systemRoutes } from "./system.ts";
import { profileRoutes } from "./profile.ts";
import { itemRoutes } from "./items.ts";
import { editItemRoutes } from "./edit-items.ts";
import { transitionRoutes } from "./transitions.ts";
import { checklistRoutes } from "./checklist.ts";
import { pushSubscriptionRoutes } from "./push-subscriptions.ts";
import { notificationRoutes } from "./notifications.ts";

const dispatch = createRouter([
  ...systemRoutes,
  ...profileRoutes,
  ...itemRoutes,
  ...editItemRoutes,
  ...transitionRoutes,
  ...checklistRoutes,
  ...pushSubscriptionRoutes,
  ...notificationRoutes,
]);

function getCorrelationId(event: APIGatewayProxyEventV2): string {
  const header = event.headers?.["x-correlation-id"];
  return header && header.length > 0 ? header : randomUUID();
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const correlationId = getCorrelationId(event);

  try {
    return await dispatch(event, correlationId);
  } catch (error) {
    console.error(
      JSON.stringify({ level: "error", correlationId, message: "Unhandled error in api", error: String(error) }),
    );
    return buildInternalErrorResponse(correlationId);
  }
};
