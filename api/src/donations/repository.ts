import {
  GetCommand,
  QueryCommand,
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

/** Lectura consistente de una donación, con su dueño, para verificar ownership (CA-07.2). */
export async function getDonationRecord(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  donationId: string,
): Promise<DonationRecord | undefined> {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { pk: donationPk(donationId) },
      ConsistentRead: true,
    }),
  );

  const item = result.Item;
  if (!item) {
    return undefined;
  }

  return {
    ...toDonation(item),
    donorSub: item.donorSub as string,
    idempotencyKey: item.idempotencyKey as string,
    payloadHash: item.payloadHash as string,
  };
}

/**
 * Historial de un donante, más recientes primero (HU-07, CA-07.1). La consulta usa la partición
 * DONOR#<sub> de gsi1: no hay forma de pedir el historial de otra persona.
 */
export async function listDonationsByDonor(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  donorSub: string,
): Promise<Donation[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;

  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "gsi1",
        KeyConditionExpression: "gsi1pk = :donor",
        ExpressionAttributeValues: { ":donor": `DONOR#${donorSub}` },
        ScanIndexForward: false,
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;
  } while (startKey);

  // Defensa en profundidad: aunque la partición ya es del donante, se descarta cualquier ítem ajeno.
  return items.filter((item) => item.donorSub === donorSub).map(toDonation);
}

export type SimulationOutcome = "applied" | "not-pending" | "contention";

/**
 * Pasa una donación de PENDIENTE_SIMULACION a un estado terminal (HU-06, RNF-HU-04), en una
 * transacción:
 *   0. Update de la donación, condicionado a que siga PENDIENTE_SIMULACION y sea del donante.
 *   1. Solo si se confirma: ADD del monto al acumulado del proyecto. Una rechazada no suma (CA-06.3).
 *   2. Put del evento de auditoría.
 * La condición del paso 0 hace que solo la primera transición válida sume al acumulado, aunque
 * lleguen muchas solicitudes a la vez (CA-06.2, CA-NF04.1, T08).
 */
export async function applySimulation(
  ddb: DynamoDBDocumentClient,
  tables: Pick<DonationTables, "donations" | "projects" | "audit">,
  params: {
    donation: DonationRecord;
    outcome: "CONFIRMADA_SIMULADA" | "RECHAZADA_SIMULADA";
    now: string;
    audit: AuditEvent;
  },
): Promise<SimulationOutcome> {
  const { donation, outcome, now } = params;

  const transactItems: NonNullable<
    ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"]
  > = [
    {
      Update: {
        TableName: tables.donations,
        Key: { pk: donationPk(donation.donationId) },
        UpdateExpression: "SET #status = :outcome, updatedAt = :now",
        ConditionExpression: "#status = :pending AND donorSub = :donorSub",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":outcome": outcome,
          ":pending": "PENDIENTE_SIMULACION",
          ":donorSub": donation.donorSub,
          ":now": now,
        },
      },
    },
  ];

  if (outcome === "CONFIRMADA_SIMULADA") {
    transactItems.push({
      Update: {
        TableName: tables.projects,
        Key: { pk: projectPk(donation.projectId) },
        UpdateExpression: "SET updatedAt = :now ADD confirmedAmountCents :amount",
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeValues: { ":amount": donation.amountCents, ":now": now },
      },
    });
  }

  transactItems.push({ Put: auditPut(tables.audit, params.audit) });

  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));
    return "applied";
  } catch (error) {
    const reasons = cancellationReasons(error);
    if (!reasons) {
      throw error;
    }
    if (reasons[0]?.Code === "ConditionalCheckFailed") {
      return "not-pending";
    }
    // Otra transacción tocaba la misma donación o el mismo proyecto: no se aplicó nada.
    if (reasons.some((reason) => reason.Code === "TransactionConflict")) {
      return "contention";
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
