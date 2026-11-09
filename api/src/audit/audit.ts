import { createHash, randomUUID } from "node:crypto";
import { PutCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { HttpError } from "../auth/errors.js";

/**
 * Módulo audit (CA-08.3, CA-10.2, RNF-HU-10). Cada evento guarda quién (seudónimo), qué, sobre
 * qué recurso, cuándo y con qué resultado. Nunca tokens, cuerpos de solicitud ni montos de terceros.
 */

export type AuditAction =
  | "PROJECT_CREATE"
  | "PROJECT_PUBLISH"
  | "DONATION_CREATE"
  | "DONATION_SIMULATE";

/** SUCCESS: hecho. DENIED: 401/403. REJECTED: otro 4xx. ERROR: fallo interno. */
export type AuditOutcome = "SUCCESS" | "DENIED" | "REJECTED" | "ERROR";

export interface AuditEvent {
  eventId: string;
  timestamp: string;
  requestId: string;
  actorRef: string;
  action: AuditAction;
  resourceRef: string;
  outcome: AuditOutcome;
  /** Código de error del API cuando outcome no es SUCCESS (por ejemplo, FORBIDDEN_ROLE). */
  reason?: string;
}

/**
 * Seudónimo estable del actor: SHA-256 del sub de Cognito, recortado a 64 bits.
 * Permite correlacionar las acciones de una misma persona sin guardar su identificador.
 */
export function pseudonymize(sub: string): string {
  return `usr_${createHash("sha256").update(sub, "utf8").digest("hex").slice(0, 16)}`;
}

export function buildAuditEvent(
  fields: Omit<AuditEvent, "eventId" | "timestamp"> & { timestamp?: string },
): AuditEvent {
  return {
    eventId: randomUUID(),
    timestamp: fields.timestamp ?? new Date().toISOString(),
    requestId: fields.requestId,
    actorRef: fields.actorRef,
    action: fields.action,
    resourceRef: fields.resourceRef,
    outcome: fields.outcome,
    ...(fields.reason ? { reason: fields.reason } : {}),
  };
}

/**
 * Ítem de la tabla AuditEvents. gsi1 agrupa por acción y ordena por fecha, para filtrar
 * por tipo y rango de fechas en GET /v1/audit (HU-10, CA-10.1).
 */
export function auditItem(event: AuditEvent): Record<string, unknown> {
  return {
    pk: `EVENT#${event.eventId}`,
    gsi1pk: `ACTION#${event.action}`,
    gsi1sk: `${event.timestamp}#${event.eventId}`,
    ...event,
  };
}

/** Put condicionado: un evento de auditoría nunca se sobrescribe. */
export function auditPut(tableName: string, event: AuditEvent) {
  return {
    TableName: tableName,
    Item: auditItem(event),
    ConditionExpression: "attribute_not_exists(pk)",
  };
}

export function outcomeFromError(error: unknown): { outcome: AuditOutcome; reason: string } {
  if (error instanceof HttpError) {
    const outcome = error.statusCode === 401 || error.statusCode === 403 ? "DENIED" : "REJECTED";
    return { outcome: error.statusCode >= 500 ? "ERROR" : outcome, reason: error.code };
  }
  return { outcome: "ERROR", reason: "INTERNAL_SERVER_ERROR" };
}

/**
 * Registra el intento fallido de una operación auditada. Es best effort: si la escritura falla,
 * se deja constancia en el log y la respuesta al cliente sigue siendo el error original.
 * Las operaciones exitosas no usan esta función: escriben su evento en la misma transacción.
 */
export async function recordFailedAttempt(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  fields: Pick<AuditEvent, "requestId" | "actorRef" | "action" | "resourceRef">,
  error: unknown,
): Promise<void> {
  const event = buildAuditEvent({ ...fields, ...outcomeFromError(error) });
  try {
    await ddb.send(new PutCommand(auditPut(tableName, event)));
  } catch (writeError) {
    console.error(
      JSON.stringify({
        level: "ERROR",
        requestId: fields.requestId,
        action: "audit.write",
        auditAction: fields.action,
        errorName: writeError instanceof Error ? writeError.name : typeof writeError,
      }),
    );
  }
}
