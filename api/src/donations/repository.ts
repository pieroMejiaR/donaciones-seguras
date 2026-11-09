import {
  GetCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import { auditPut, type AuditEvent } from "../audit/audit.js";
import { projectPk } from "../projects/repository.js";
import type { DonationStatus } from "./schemas.js";

/**
 * Acceso a las tablas Donations e Idempotency (diseño en docs/data-model.md):
 *   Donations:   pk = DONATION#<donationId>, gsi1pk = DONOR#<donorSub>, gsi1sk = <createdAt>#<donationId>
 *   Idempotency: pk = IDEMP#<donorSub>#<idempotencyKey>, TTL en expiresAt
 */

export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

export const donationPk = (donationId: string) => `DONATION#${donationId}`;
export const idempotencyPk = (donorSub: string, key: string) => `IDEMP#${donorSub}#${key}`;

/** Donación tal como la ve su dueño. No incluye donorSub, idempotencyKey ni payloadHash. */
export interface Donation {
  donationId: string;
  projectId: string;
  projectTitle: string;
  amountCents: number;
  currency: "PEN";
  status: DonationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DonationRecord extends Donation {
  donorSub: string;
  idempotencyKey: string;
  payloadHash: string;
}

export interface IdempotencyRecord {
  donationId: string;
  payloadHash: string;
  expiresAt: number;
  /** Respuesta original: una repetición devuelve exactamente lo mismo (CA-05.4). */
  response: Donation;
}

export interface DonationTables {
  donations: string;
  idempotency: string;
  projects: string;
  audit: string;
}

/** Copia solo los atributos que puede ver el donante. */
export function toDonation(item: Record<string, unknown>): Donation {
  return {
    donationId: item.donationId as string,
    projectId: item.projectId as string,
    projectTitle: item.projectTitle as string,
    amountCents: item.amountCents as number,
    currency: "PEN",
    status: item.status as DonationStatus,
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
  };
}

/**
 * Registro de idempotencia vigente. El TTL de DynamoDB borra con retraso, así que un registro
 * vencido que siga en la tabla se trata como inexistente.
 */
export async function getIdempotencyRecord(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  donorSub: string,
  key: string,
  nowEpoch: number,
): Promise<IdempotencyRecord | undefined> {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { pk: idempotencyPk(donorSub, key) },
      ConsistentRead: true,
    }),
  );

  const item = result.Item;
  if (!item || typeof item.expiresAt !== "number" || item.expiresAt <= nowEpoch) {
    return undefined;
  }

  return {
    donationId: item.donationId as string,
    payloadHash: item.payloadHash as string,
    expiresAt: item.expiresAt,
    response: toDonation(item.response as Record<string, unknown>),
  };
}

export type CreateDonationOutcome = "created" | "key-taken" | "project-not-eligible";

/**
 * Crea la donación en una sola transacción (HU-05, CA-05.4, RNF-HU-04):
 *   0. Put de la donación.
 *   1. Put del registro de idempotencia, solo si la clave no existe o ya venció.
 *   2. ConditionCheck: el proyecto sigue PUBLICADO. No se modifica: el acumulado no cambia
 *      hasta la confirmación simulada (CA-05.2).
 *   3. Put del evento de auditoría.
 * Si dos solicitudes con la misma clave llegan a la vez, solo una se escribe.
 */
export async function createDonation(
  ddb: DynamoDBDocumentClient,
  tables: DonationTables,
  record: DonationRecord,
  idempotency: { expiresAt: number; nowEpoch: number },
  audit: AuditEvent,
): Promise<CreateDonationOutcome> {
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tables.donations,
              Item: {
                pk: donationPk(record.donationId),
                gsi1pk: `DONOR#${record.donorSub}`,
                gsi1sk: `${record.createdAt}#${record.donationId}`,
                ...record,
              },
              ConditionExpression: "attribute_not_exists(pk)",
            },
          },
          {
            Put: {
              TableName: tables.idempotency,
              Item: {
                pk: idempotencyPk(record.donorSub, record.idempotencyKey),
                donationId: record.donationId,
                payloadHash: record.payloadHash,
                expiresAt: idempotency.expiresAt,
                response: toDonation({ ...record }),
              },
              ConditionExpression: "attribute_not_exists(pk) OR expiresAt <= :now",
              ExpressionAttributeValues: { ":now": idempotency.nowEpoch },
            },
          },
          {
            ConditionCheck: {
              TableName: tables.projects,
              Key: { pk: projectPk(record.projectId) },
              ConditionExpression: "#status = :published",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: { ":published": "PUBLICADO" },
            },
          },
          { Put: auditPut(tables.audit, audit) },
        ],
      }),
    );
    return "created";
  } catch (error) {
    const reasons = cancellationReasons(error);
    if (!reasons) {
      throw error;
    }
    // La clave ya escrita, o en escritura por otra transacción concurrente.
    const keyReason = reasons[1]?.Code;
    if (keyReason === "ConditionalCheckFailed" || keyReason === "TransactionConflict") {
      return "key-taken";
    }
    if (reasons[2]?.Code === "ConditionalCheckFailed") {
      return "project-not-eligible";
    }
    throw error;
  }
}

function cancellationReasons(error: unknown): { Code?: string }[] | undefined {
  if (error instanceof Error && error.name === "TransactionCanceledException") {
    return (error as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? [];
  }
  return undefined;
}
