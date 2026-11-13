/**
 * E-08 PATCH /v1/items/{videoId} (editar) y E-09 POST /v1/items/{videoId}/submit-form
 * (llenar formulario) (Ítems edición).
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { validateAnalysis, formatValidationErrors, type ValidationIssue } from "../schemas/validators.ts";
import { readJsonBody, requireUserId, type Route, type HandlerContext } from "./router.ts";
import { ProblemError, buildProblemResponse, buildValidationErrorResponse } from "./problem.ts";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const TABLE_NAME = process.env.TABLE_NAME!;

type Item = Record<string, unknown>;
type Details = Record<string, unknown>;

/**
 * Extrae el máximo número de ID actual en los elementos marcables o entradas.
 * Ej: si hay i1, i2, i4 → devuelve 4. Si no hay → devuelve 0.
 */
function getMaxIdNumber(details: Details | null | undefined, prefix: string): number {
  if (!details) return 0;

  const keys = new Set<string>();
  // Buscar en todos los arrays que puedan tener IDs
  for (const [field, value] of Object.entries(details)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && "id" in item) {
          const id = String(item.id);
          if (id.startsWith(prefix)) {
            keys.add(id);
          }
        }
      }
    }
  }

  if (keys.size === 0) return 0;
  return Math.max(...Array.from(keys).map((id) => Number(id.slice(prefix.length))));
}

/**
 * Asigna IDs a elementos nuevos (sin id) en el details.
 * Los elementos con id existente se conservan.
 * Valida que los IDs enviados existan en la estructura actual.
 * Retorna lista de errores si hay IDs inválidos.
 */
function assignIds(newDetails: Details, oldDetails: Details | null | undefined): ValidationIssue[] {
  const errors: ValidationIssue[] = [];

  // Mapas de IDs existentes en oldDetails
  const existingIds = new Map<string, boolean>();
  for (const [field, value] of Object.entries(oldDetails ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && "id" in item) {
          existingIds.set(String(item.id), true);
        }
      }
    }
  }

  // Recorrer newDetails y asignar IDs
  for (const [field, value] of Object.entries(newDetails)) {
    if (!Array.isArray(value)) continue;

    // Determinar prefijo según el campo
    let prefix = "e"; // default para entries
    if (["ingredients", "exercises", "materials"].includes(field)) {
      prefix = "i";
    }

    const maxN = getMaxIdNumber(oldDetails, prefix);
    let nextN = maxN + 1;

    for (const item of value) {
      if (!item || typeof item !== "object") continue;

      if ("id" in item) {
        // ID enviado: validar que exista
        const id = String(item.id);
        if (!existingIds.has(id)) {
          errors.push({
            pointer: `/details/${field}`,
            code: "UNKNOWN_ITEM_ID",
            message: `item ${id} does not exist`,
          });
        }
      } else {
        // Sin ID: asignar el siguiente
        item.id = `${prefix}${nextN++}`;
      }
    }
  }

  return errors;
}

/**
 * Filtra el checklist para conservar solo las marcas de IDs que siguen existiendo
 * en el nuevo details.
 */
function filterChecklist(oldChecklist: Record<string, unknown> | null | undefined, newDetails: Details): Record<string, unknown> {
  if (!oldChecklist || typeof oldChecklist !== "object") {
    return {};
  }

  const existingIds = new Set<string>();
  for (const value of Object.values(newDetails)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && "id" in item) {
          existingIds.add(String(item.id));
        }
      }
    }
  }

  const filtered: Record<string, unknown> = {};
  for (const [id, marked] of Object.entries(oldChecklist)) {
    if (existingIds.has(id)) {
      filtered[id] = marked;
    }
  }
  return filtered;
}

async function getItem(userId: string, videoId: string): Promise<Item | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${userId}`, SK: `ITEM#${videoId}` },
    }),
  );
  return (result.Item as Item) || null;
}

export const editItemRoutes: Route[] = [
  // E-08: Editar ítem
  {
    method: "PATCH",
    path: "/v1/items/:videoId",
    auth: true,
    handler: async (ctx: HandlerContext) => {
      const userId = requireUserId(ctx);
      const { videoId } = ctx.params;
      const ifMatch = ctx.event.headers?.["if-match"];

      // Validar If-Match header
      if (!ifMatch) {
        return buildProblemResponse(
          new ProblemError({
            status: 428,
            code: "PRECONDITION_REQUIRED",
            title: "If-Match header is required",
          }),
          ctx.correlationId,
        );
      }

      const version = Number(ifMatch.replace(/"/g, ""));
      if (!Number.isInteger(version) || version < 1) {
        return buildValidationErrorResponse(
          [{ pointer: "/If-Match", code: "INVALID_FORMAT", message: "If-Match must be a valid version number" }],
          ctx.correlationId,
        );
      }

      const body = readJsonBody(ctx);
      const { title, summary, category, details } = body as Record<string, unknown>;

      // Obtener el ítem actual
      const currentItem = await getItem(userId, videoId);
      if (!currentItem) {
        return buildProblemResponse(
          new ProblemError({
            status: 404,
            code: "ITEM_NOT_FOUND",
            title: "Item not found",
          }),
          ctx.correlationId,
        );
      }

      const currentStatus = currentItem.status as string;
      const currentDetails = currentItem.details as Details;
      const currentChecklist = currentItem.checklist as Record<string, unknown> | null;

      // Validar estado
      if (!["PENDING", "DORMANT"].includes(currentStatus)) {
        return buildProblemResponse(
          new ProblemError({
            status: 409,
            code: "INVALID_STATE_TRANSITION",
            title: "Action not allowed in the current status",
            extensions: {
              action: "edit",
              currentStatus,
              allowedStatuses: ["PENDING", "DORMANT"],
            },
          }),
          ctx.correlationId,
        );
      }

      // Construir el objeto para validar
      const toValidate: Record<string, unknown> = {
        category: category ?? currentItem.category,
        title: title ?? currentItem.title,
        summary: summary ?? currentItem.summary,
        details: details ?? currentDetails,
      };

      // Validar contra schema
      const { valid, errors: validationErrors } = validateAnalysis("input", toValidate);
      if (!validationErrors) {
        // Si hay errores de validación
        const formatted = formatValidationErrors(validationErrors, toValidate);
        if (formatted.length > 0) {
          return buildValidationErrorResponse(formatted, ctx.correlationId);
        }
      }

      // Si cambia category, details es obligatorio
      if (category && category !== currentItem.category && !details) {
        return buildValidationErrorResponse(
          [{ pointer: "/details", code: "REQUIRED", message: "details is required when category changes" }],
          ctx.correlationId,
        );
      }

      // Asignar IDs a nuevos elementos
      const newDetails = (details ?? currentDetails) as Details;
      const idErrors = assignIds(newDetails, currentDetails);
      if (idErrors.length > 0) {
        return buildValidationErrorResponse(idErrors, ctx.correlationId);
      }

      // Actualizar checklist
      const newChecklist = filterChecklist(currentChecklist, newDetails);

      // Preparar UpdateExpression
      const updates: string[] = [];
      const values: Record<string, unknown> = {
        ":v": version,
        ":newVersion": version + 1,
        ":expectedStatus": currentStatus,
      };

      if (title !== undefined) {
        updates.push("title = :title");
        values[":title"] = title;
      }
      if (summary !== undefined) {
        updates.push("summary = :summary");
        values[":summary"] = summary;
      }
      if (category !== undefined) {
        updates.push("category = :category");
        values[":category"] = category;
      }
      if (details !== undefined) {
        updates.push("details = :details");
        values[":details"] = newDetails;
      }

      updates.push("version = :newVersion");

      // Si es EVENT, también escribir eventDate de primer nivel
      if (category === "EVENT" || (category === undefined && currentItem.category === "EVENT")) {
        const eventDate = (newDetails as any)?.eventDate;
        if (eventDate) {
          updates.push("eventDate = :eventDate");
          values[":eventDate"] = eventDate;
        }
      }

      // Si el checklist cambió, actualizar (siempre, aunque esté vacío)
      if (Object.keys(newChecklist).length !== Object.keys(currentChecklist ?? {}).length ||
          !Object.entries(newChecklist).every(([k, v]) => currentChecklist?.[k] === v)) {
        updates.push("checklist = :checklist");
        values[":checklist"] = newChecklist;
      }

      // Ejecutar UpdateItem
      try {
        const result = await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `USER#${userId}`, SK: `ITEM#${videoId}` },
            UpdateExpression: `SET ${updates.join(", ")}`,
            ConditionExpression: "#s = :expectedStatus AND #v = :v",
            ExpressionAttributeNames: { "#s": "status", "#v": "version" },
            ExpressionAttributeValues: values,
            ReturnValues: "ALL_NEW",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
          }),
        );

        const updatedItem = result.Attributes as Item;
        const newVersion = updatedItem.version as number;

        return {
          statusCode: 200,
          headers: {
            "Content-Type": "application/json",
            ETag: `"${newVersion}"`,
          },
          body: JSON.stringify(updatedItem),
        };
      } catch (error: unknown) {
        if ((error as any)?.name === "ConditionalCheckFailedException") {
          // El DocumentClient no convierte el Item de la excepción (llega como AttributeValue)
          const rawItem = (error as any).Item;
          const oldItem = rawItem ? (unmarshall(rawItem) as Item) : undefined;
          if (oldItem?.version !== version) {
            return buildProblemResponse(
              new ProblemError({
                status: 412,
                code: "VERSION_MISMATCH",
                title: "Item was modified",
                extensions: { currentVersion: oldItem?.version },
              }),
              ctx.correlationId,
            );
          } else {
            return buildProblemResponse(
              new ProblemError({
                status: 409,
                code: "INVALID_STATE_TRANSITION",
                title: "Action not allowed in the current status",
                extensions: { action: "edit", currentStatus: oldItem?.status, allowedStatuses: ["PENDING", "DORMANT"] },
              }),
              ctx.correlationId,
            );
          }
        }
        throw error;
      }
    },
  },

  // E-09: Llenar formulario (NEEDS_INPUT → PENDING)
  {
    method: "POST",
    path: "/v1/items/:videoId/submit-form",
    auth: true,
    handler: async (ctx: HandlerContext) => {
      const userId = requireUserId(ctx);
      const { videoId } = ctx.params;
      const ifMatch = ctx.event.headers?.["if-match"];

      // Validar If-Match header
      if (!ifMatch) {
        return buildProblemResponse(
          new ProblemError({
            status: 428,
            code: "PRECONDITION_REQUIRED",
            title: "If-Match header is required",
          }),
          ctx.correlationId,
        );
      }

      const version = Number(ifMatch.replace(/"/g, ""));
      if (!Number.isInteger(version) || version < 1) {
        return buildValidationErrorResponse(
          [{ pointer: "/If-Match", code: "INVALID_FORMAT", message: "If-Match must be a valid version number" }],
          ctx.correlationId,
        );
      }

      const body = readJsonBody(ctx);
      const { category, title, summary, details } = body as Record<string, unknown>;

      // Validar que category y title sean obligatorios
      if (!category || !title) {
        const missing: ValidationIssue[] = [];
        if (!category) missing.push({ pointer: "/category", code: "REQUIRED", message: "must not be empty" });
        if (!title) missing.push({ pointer: "/title", code: "REQUIRED", message: "must not be empty" });
        return buildValidationErrorResponse(missing, ctx.correlationId);
      }

      // Obtener el ítem actual
      const currentItem = await getItem(userId, videoId);
      if (!currentItem) {
        return buildProblemResponse(
          new ProblemError({
            status: 404,
            code: "ITEM_NOT_FOUND",
            title: "Item not found",
          }),
          ctx.correlationId,
        );
      }

      // Validar estado
      if (currentItem.status !== "NEEDS_INPUT") {
        return buildProblemResponse(
          new ProblemError({
            status: 409,
            code: "INVALID_STATE_TRANSITION",
            title: "Action not allowed in the current status",
            extensions: {
              action: "submit-form",
              currentStatus: currentItem.status,
              allowedStatuses: ["NEEDS_INPUT"],
            },
          }),
          ctx.correlationId,
        );
      }

      // Validar contra schema
      const toValidate = { category, title, summary: summary ?? undefined, details: details ?? undefined };
      const { valid, errors: validationErrors } = validateAnalysis("input", toValidate);
      if (!validationErrors) {
        const formatted = formatValidationErrors(validationErrors, toValidate);
        if (formatted.length > 0) {
          return buildValidationErrorResponse(formatted, ctx.correlationId);
        }
      }

      // details es obligatorio
      if (!details) {
        return buildValidationErrorResponse(
          [{ pointer: "/details", code: "REQUIRED", message: "details is required" }],
          ctx.correlationId,
        );
      }

      // Asignar IDs
      const newDetails = details as Details;
      const idErrors = assignIds(newDetails, null);
      if (idErrors.length > 0) {
        return buildValidationErrorResponse(idErrors, ctx.correlationId);
      }

      // Ejecutar UpdateItem
      try {
        const now = new Date().toISOString();
        const updates: string[] = [
          "status = :status",
          "category = :category",
          "title = :title",
          "details = :details",
          "dataSource = :dataSource",
          "readyAt = :readyAt",
          "statusUpdatedAt = :statusUpdatedAt",
          "checklist = :checklist",
          "version = :newVersion",
        ];

        const values: Record<string, unknown> = {
          ":v": version,
          ":newVersion": version + 1,
          ":status": "PENDING",
          ":category": category,
          ":title": title,
          ":details": newDetails,
          ":summary": summary ?? null,
          ":dataSource": "USER_FORM",
          ":readyAt": now,
          ":statusUpdatedAt": now,
          ":checklist": {},
        };

        if (summary !== undefined) {
          updates.push("summary = :summary");
        }

        // Si es EVENT, escribir eventDate de primer nivel
        if (category === "EVENT") {
          const eventDate = (newDetails as any)?.eventDate;
          if (eventDate) {
            updates.push("eventDate = :eventDate");
            values[":eventDate"] = eventDate;
          }
        }

        const result = await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `USER#${userId}`, SK: `ITEM#${videoId}` },
            UpdateExpression: `SET ${updates.join(", ")} REMOVE analysisError`,
            ConditionExpression: "#s = :needsInput AND #v = :v",
            ExpressionAttributeNames: { "#s": "status", "#v": "version" },
            ExpressionAttributeValues: { ...values, ":needsInput": "NEEDS_INPUT" },
            ReturnValues: "ALL_NEW",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
          }),
        );

        const updatedItem = result.Attributes as Item;
        const newVersion = updatedItem.version as number;

        return {
          statusCode: 200,
          headers: {
            "Content-Type": "application/json",
            ETag: `"${newVersion}"`,
          },
          body: JSON.stringify(updatedItem),
        };
      } catch (error: unknown) {
        if ((error as any)?.name === "ConditionalCheckFailedException") {
          // El DocumentClient no convierte el Item de la excepción (llega como AttributeValue)
          const rawItem = (error as any).Item;
          const oldItem = rawItem ? (unmarshall(rawItem) as Item) : undefined;
          if (oldItem?.version !== version) {
            return buildProblemResponse(
              new ProblemError({
                status: 412,
                code: "VERSION_MISMATCH",
                title: "Item was modified",
                extensions: { currentVersion: oldItem?.version },
              }),
              ctx.correlationId,
            );
          } else {
            return buildProblemResponse(
              new ProblemError({
                status: 409,
                code: "INVALID_STATE_TRANSITION",
                title: "Action not allowed in the current status",
                extensions: { action: "submit-form", currentStatus: oldItem?.status, allowedStatuses: ["NEEDS_INPUT"] },
              }),
              ctx.correlationId,
            );
          }
        }
        throw error;
      }
    },
  },
];
