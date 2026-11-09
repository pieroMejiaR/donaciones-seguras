import { createHash, randomUUID } from "node:crypto";
import { buildAuditEvent, pseudonymize, recordFailedAttempt } from "../audit/audit.js";
import { extractAuthContext, extractDonorSub, requireRole, requireScope } from "../auth/index.js";
import {
  createDonation,
  getIdempotencyRecord,
  IDEMPOTENCY_TTL_SECONDS,
  toDonation,
  type DonationRecord,
  type DonationTables,
} from "../donations/repository.js";
import { CreateDonationInput, IdempotencyKey } from "../donations/schemas.js";
import { getProject } from "../projects/repository.js";
import { ddb, tableName } from "../shared/dynamo.js";
import {
  BadRequestError,
  ConflictError,
  jsonResponse,
  parseJsonBody,
  parseWith,
  requestIdOf,
  withHttp,
} from "../shared/http.js";

/**
 * POST /v1/donations (HU-05): un DONANTE registra una intención de donación simulada.
 *
 * - Valida monto y proyecto antes de tocar la base (CA-05.1, CA-05.2, T04).
 * - donorSub sale del token, nunca del cuerpo (CA-05.3).
 * - Idempotency-Key: misma clave y mismo cuerpo devuelven la respuesta original; misma clave con
 *   otro cuerpo responde 409 (CA-05.4, T06, T07).
 * - No mueve el acumulado del proyecto: eso ocurre solo al confirmar la simulación (día 5).
 */
export const handler = withHttp("donations.create", async (event) => {
  const requestId = requestIdOf(event);
  const ctx = extractAuthContext(event);
  const actorRef = pseudonymize(ctx.sub);
  const tables: DonationTables = {
    donations: tableName("DONATIONS_TABLE"),
    idempotency: tableName("IDEMPOTENCY_TABLE"),
    projects: tableName("PROJECTS_TABLE"),
    audit: tableName("AUDIT_TABLE"),
  };

  try {
    requireScope(ctx, "api/donations.create");
    requireRole(ctx, "DONANTE");

    const keyResult = IdempotencyKey.safeParse(event.headers?.["idempotency-key"]);
    if (!keyResult.success) {
      throw new BadRequestError(
        "INVALID_IDEMPOTENCY_KEY",
        "La cabecera Idempotency-Key es obligatoria: un UUID generado por el cliente para cada intento",
      );
    }
    const idempotencyKey = keyResult.data;
    const input = parseWith(CreateDonationInput, parseJsonBody(event));

    const donorSub = extractDonorSub(ctx);
    const payloadHash = hashPayload(input);
    const now = new Date();
    const nowIso = now.toISOString();
    const nowEpoch = Math.floor(now.getTime() / 1000);

    const replay = async () => {
      const existing = await getIdempotencyRecord(
        ddb,
        tables.idempotency,
        donorSub,
        idempotencyKey,
        nowEpoch,
      );
      if (!existing) {
        return undefined;
      }
      if (existing.payloadHash !== payloadHash) {
        throw new ConflictError(
          "IDEMPOTENCY_KEY_REUSED",
          "La clave de idempotencia ya se usó con una solicitud distinta",
        );
      }
      return jsonResponse(201, existing.response, { "idempotent-replayed": "true" });
    };

    const previous = await replay();
    if (previous) {
      return previous;
    }

    const project = await getProject(ddb, tables.projects, input.projectId, { consistent: true });
    if (!project || project.status !== "PUBLICADO") {
      throw notEligible();
    }

    const record: DonationRecord = {
      donationId: randomUUID(),
      projectId: project.projectId,
      projectTitle: project.title,
      amountCents: input.amountCents,
      currency: "PEN",
      status: "PENDIENTE_SIMULACION",
      createdAt: nowIso,
      updatedAt: nowIso,
      donorSub,
      idempotencyKey,
      payloadHash,
    };

    const outcome = await createDonation(
      ddb,
      tables,
      record,
      { expiresAt: nowEpoch + IDEMPOTENCY_TTL_SECONDS, nowEpoch },
      buildAuditEvent({
        timestamp: nowIso,
        requestId,
        actorRef,
        action: "DONATION_CREATE",
        resourceRef: `donation/${record.donationId}`,
        outcome: "SUCCESS",
      }),
    );

    if (outcome === "project-not-eligible") {
      throw notEligible();
    }
    if (outcome === "key-taken") {
      // Otra solicitud con la misma clave ganó la carrera: se responde como repetición.
      const concurrent = await replay();
      if (concurrent) {
        return concurrent;
      }
      throw new ConflictError(
        "IDEMPOTENCY_KEY_IN_PROGRESS",
        "Hay una solicitud con la misma clave de idempotencia en curso; reintente en unos segundos",
      );
    }

    return jsonResponse(201, toDonation({ ...record }));
  } catch (error) {
    await recordFailedAttempt(
      ddb,
      tables.audit,
      { requestId, actorRef, action: "DONATION_CREATE", resourceRef: "donation/new" },
      error,
    );
    throw error;
  }
});

/**
 * Hash del cuerpo ya validado, con los campos en orden fijo: el mismo contenido da el mismo hash
 * aunque el cliente cambie el orden de las claves o los espacios.
 */
function hashPayload(input: CreateDonationInput): string {
  const canonical = JSON.stringify({ projectId: input.projectId, amountCents: input.amountCents });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function notEligible(): ConflictError {
  return new ConflictError(
    "PROJECT_NOT_ELIGIBLE",
    "El proyecto no existe o no está publicado; no acepta donaciones",
  );
}
