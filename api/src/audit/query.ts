import { QueryCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { AuditAction, AuditEvent, AuditOutcome } from "./audit.js";

/** Todas las acciones auditadas. Sin filtro de tipo, se consulta una partición por acción. */
export const AUDIT_ACTIONS = [
  "PROJECT_CREATE",
  "PROJECT_PUBLISH",
  "DONATION_CREATE",
  "DONATION_SIMULATE",
] as const satisfies readonly AuditAction[];

export interface AuditQuery {
  actions: readonly AuditAction[];
  /** Límites del rango, en ISO 8601. */
  from: string;
  to: string;
  limit: number;
}

/**
 * Eventos de auditoría más recientes primero (HU-10, CA-10.1). Consulta el índice gsi1, que agrupa
 * por acción (ACTION#<acción>) y ordena por fecha: nunca hace Scan (RNF-HU-05). El rango de fechas
 * se aplica en la condición de clave, así que DynamoDB solo lee los eventos del periodo pedido.
 */
export async function listAuditEvents(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  query: AuditQuery,
): Promise<AuditEvent[]> {
  const pages = await Promise.all(
    query.actions.map((action) =>
      ddb.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "gsi1",
          KeyConditionExpression: "gsi1pk = :action AND gsi1sk BETWEEN :from AND :to",
          ExpressionAttributeValues: {
            ":action": `ACTION#${action}`,
            ":from": query.from,
            // gsi1sk es <timestamp>#<eventId>: el sufijo incluye todos los eventos del instante final.
            ":to": `${query.to}#￿`,
          },
          ScanIndexForward: false,
          Limit: query.limit,
        }),
      ),
    ),
  );

  return pages
    .flatMap((page) => page.Items ?? [])
    .map(toAuditEvent)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, query.limit);
}

/** Solo los campos del evento (CA-10.2): se descartan las claves internas de la tabla. */
function toAuditEvent(item: Record<string, unknown>): AuditEvent {
  return {
    eventId: item.eventId as string,
    timestamp: item.timestamp as string,
    requestId: item.requestId as string,
    actorRef: item.actorRef as string,
    action: item.action as AuditAction,
    resourceRef: item.resourceRef as string,
    outcome: item.outcome as AuditOutcome,
    ...(typeof item.reason === "string" ? { reason: item.reason } : {}),
  };
}
