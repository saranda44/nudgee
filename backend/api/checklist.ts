/**
 * E-18 PATCH /v1/items/{videoId}/checklist - Marcar elementos o entradas
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { readJsonBody, requireUserId, type Route, type HandlerContext } from "./router.ts";
import { ProblemError, buildProblemResponse, buildValidationErrorResponse } from "./problem.ts";
import { CHECKLISTABLE_CATEGORIES, calculateSuggestDone, getChecklistIds } from "./item-dto.ts";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const TABLE_NAME = process.env.TABLE_NAME!;

type Item = Record<string, unknown>;

export const checklistRoutes: Route[] = [
  // E-18: Marcar elementos o entradas
  {
    method: "PATCH",
    path: "/v1/items/:videoId/checklist",
    auth: true,
    handler: async (ctx: HandlerContext) => {
      const userId = requireUserId(ctx);
      const { videoId } = ctx.params;

      const body = readJsonBody(ctx);

      // Validar que el body sea un objeto con valores booleanos
      const updates: Record<string, unknown> = {};
      const errors: Array<{ pointer: string; code: string; message: string }> = [];

      for (const [key, value] of Object.entries(body)) {
        if (typeof value !== "boolean") {
          errors.push({
            pointer: `/${key}`,
            code: "INVALID_TYPE",
            message: `must be a boolean, not ${typeof value}`,
          });
        } else {
          updates[key] = value;
        }
      }

      if (errors.length > 0) {
        return buildValidationErrorResponse(errors, ctx.correlationId);
      }

      // Obtener el ítem actual
      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: `USER#${userId}`, SK: `ITEM#${videoId}` },
        }),
      );

      const item = result.Item as Item | undefined;
      if (!item) {
        return buildProblemResponse(
          new ProblemError({
            status: 404,
            code: "ITEM_NOT_FOUND",
            title: "Item not found",
          }),
          ctx.correlationId,
        );
      }

      const status = item.status as string;
      const category = item.category as string | null;
      const currentChecklist = (item.checklist ?? {}) as Record<string, unknown>;

      // Validar estado
      if (!["PENDING", "DORMANT"].includes(status)) {
        return buildProblemResponse(
          new ProblemError({
            status: 409,
            code: "INVALID_STATE_TRANSITION",
            title: "Action not allowed in the current status",
            extensions: {
              action: "checklist",
              currentStatus: status,
              allowedStatuses: ["PENDING", "DORMANT"],
            },
          }),
          ctx.correlationId,
        );
      }

      // Validar categoría
      if (!category || !CHECKLISTABLE_CATEGORIES.includes(category)) {
        return buildProblemResponse(
          new ProblemError({
            status: 409,
            code: "INVALID_STATE_TRANSITION",
            title: "Action not allowed in the current status",
            extensions: {
              action: "checklist",
              currentStatus: status,
              allowedStatuses: ["PENDING", "DORMANT"],
              allowedCategories: CHECKLISTABLE_CATEGORIES,
            },
          }),
          ctx.correlationId,
        );
      }

      // Validar que todos los IDs a actualizar existan
      const existingIds = getChecklistIds(item);
      const invalidIds: string[] = [];

      for (const id of Object.keys(updates)) {
        if (!existingIds.has(id)) {
          invalidIds.push(id);
        }
      }

      if (invalidIds.length > 0) {
        const idErrors = invalidIds.map((id) => ({
          pointer: `/${id}`,
          code: "UNKNOWN_CHECKLIST_ITEM",
          message: `item ${id} does not exist`,
        }));
        return buildValidationErrorResponse(idErrors, ctx.correlationId);
      }

      // Merge: mantener valores existentes + agregar/actualizar los nuevos
      const newChecklist = { ...currentChecklist, ...updates };

      // Calcular suggestDone
      const suggestDone = calculateSuggestDone(newChecklist, existingIds);

      // El worker no siempre crea el mapa `checklist`: DynamoDB rechaza `checklist.#id` si el
      // mapa no existe ("document path ... invalid"). Primera marca: se crea el mapa completo
      // con attribute_not_exists; después, solo las llaves enviadas (merge, D-03).
      const STATE_CONDITION =
        "#s IN (:pending, :dormant) AND #cat IN (:recipe, :routine, :tutorial, :movie, :place, :book, :music, :podcast)";
      const STATE_VALUES = {
        ":pending": "PENDING",
        ":dormant": "DORMANT",
        ":recipe": "RECIPE",
        ":routine": "ROUTINE",
        ":tutorial": "TUTORIAL",
        ":movie": "MOVIE_SERIES",
        ":place": "PLACE",
        ":book": "BOOK",
        ":music": "MUSIC",
        ":podcast": "PODCAST",
      };

      const buildUpdate = (createMap: boolean) => {
        if (createMap) {
          return {
            UpdateExpression: "SET #checklist = :checklist",
            ConditionExpression: `${STATE_CONDITION} AND attribute_not_exists(#checklist)`,
            ExpressionAttributeNames: { "#checklist": "checklist", "#s": "status", "#cat": "category" },
            ExpressionAttributeValues: { ":checklist": updates, ...STATE_VALUES },
          };
        }
        const sets: string[] = [];
        const names: Record<string, string> = { "#checklist": "checklist", "#s": "status", "#cat": "category" };
        const values: Record<string, unknown> = { ...STATE_VALUES };
        Object.entries(updates).forEach(([id, value], idx) => {
          sets.push(`#checklist.#id${idx} = :val${idx}`);
          names[`#id${idx}`] = id;
          values[`:val${idx}`] = value;
        });
        return {
          UpdateExpression: `SET ${sets.join(", ")}`,
          ConditionExpression: `${STATE_CONDITION} AND attribute_exists(#checklist)`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        };
      };

      const conflict = () =>
        buildProblemResponse(
          new ProblemError({
            status: 409,
            code: "INVALID_STATE_TRANSITION",
            title: "Action not allowed in the current status",
            extensions: {
              action: "checklist",
              currentStatus: status,
              allowedStatuses: ["PENDING", "DORMANT"],
              allowedCategories: CHECKLISTABLE_CATEGORIES,
            },
          }),
          ctx.correlationId,
        );

      // Intento 1 según lo leído; si la condición falla puede ser porque otro dispositivo creó
      // (o el mapa ya no) existe: un reintento con la otra forma. Si vuelve a fallar, es estado.
      let createMap = item.checklist === undefined;
      for (let attempt = 0; ; attempt++) {
        try {
          await docClient.send(
            new UpdateCommand({ TableName: TABLE_NAME, Key: { PK: `USER#${userId}`, SK: `ITEM#${videoId}` }, ...buildUpdate(createMap) }),
          );
          break;
        } catch (error: unknown) {
          if ((error as { name?: string })?.name !== "ConditionalCheckFailedException") throw error;
          if (attempt > 0) return conflict();
          createMap = !createMap;
        }
      }

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId,
          checklist: newChecklist,
          suggestDone,
        }),
      };
    },
  },
];
