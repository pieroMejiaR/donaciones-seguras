import { setTimeout as sleep } from "node:timers/promises";
import { buildAuditEvent, pseudonymize, recordFailedAttempt } from "../audit/audit.js";
import { extractAuthContext, requireRole, requireScope } from "../auth/index.js";
import { applySimulation, getDonationRecord, toDonation } from "../donations/repository.js";
import { DonationId, SimulateDonationInput } from "../donations/schemas.js";
import { ddb, tableName } from "../shared/dynamo.js";
import {
  ConflictError,
  jsonResponse,
  NotFoundError,
  parseJsonBody,
  parseWith,
  requestIdOf,
  withHttp,
} from "../shared/http.js";

/** Intentos ante contención de transacciones (otra confirmación sobre el mismo proyecto). */
const MAX_ATTEMPTS = 3;

/**
 * POST /v1/donations/{id}/simulate (HU-06): el DONANTE dueño pasa su donación de
 * PENDIENTE_SIMULACION a CONFIRMADA_SIMULADA o RECHAZADA_SIMULADA.
 *
 * - Solo existe en el stage academic (CA-06.1). La plantilla ya omite la ruta en dev; el handler
 *   lo vuelve a comprobar por si se desplegara fuera de ese stage.
 * - Una donación ajena responde el mismo 404 que una inexistente (CA-07.2).
 * - Solo la primera transición suma al acumulado; las siguientes responden 409 (CA-06.2, T08).
 * - La SPA muestra «Simulación académica: no se ha realizado ningún cobro» (CA-06.4).
 */
export const handler = withHttp("donations.simulate", async (event) => {
  if (process.env.STAGE !== "academic") {
    throw new NotFoundError("NOT_FOUND", "Ruta no disponible en este entorno");
  }

  const requestId = requestIdOf(event);
  const ctx = extractAuthContext(event);
  const actorRef = pseudonymize(ctx.sub);
  const tables = {
    donations: tableName("DONATIONS_TABLE"),
    projects: tableName("PROJECTS_TABLE"),
    audit: tableName("AUDIT_TABLE"),
  };

  const rawId = event.pathParameters?.id ?? "";
  const isValidId = DonationId.safeParse(rawId).success;
  const resourceRef = `donation/${isValidId ? rawId : "invalid"}`;

  try {
    requireScope(ctx, "api/donations.create");
    requireRole(ctx, "DONANTE");
    if (!isValidId) {
      throw notFound();
    }
    const { outcome } = parseWith(SimulateDonationInput, parseJsonBody(event));

    for (let attempt = 1; ; attempt++) {
      const donation = await getDonationRecord(ddb, tables.donations, rawId);
      if (!donation || donation.donorSub !== ctx.sub) {
        throw notFound();
      }
      if (donation.status !== "PENDIENTE_SIMULACION") {
        throw alreadyFinalized();
      }

      const now = new Date().toISOString();
      const result = await applySimulation(ddb, tables, {
        donation,
        outcome,
        now,
        audit: buildAuditEvent({
          timestamp: now,
          requestId,
          actorRef,
          action: "DONATION_SIMULATE",
          resourceRef,
          outcome: "SUCCESS",
        }),
      });

      if (result === "applied") {
        return jsonResponse(200, { ...toDonation({ ...donation }), status: outcome, updatedAt: now });
      }
      if (result === "not-pending") {
        throw alreadyFinalized();
      }
      if (attempt >= MAX_ATTEMPTS) {
        throw new ConflictError(
          "DONATION_SIMULATION_IN_PROGRESS",
          "Hay otra operación en curso sobre esta donación o su proyecto; reintente en unos segundos",
        );
      }
      // Espera corta con variación aleatoria antes de volver a leer y reintentar.
      await sleep(25 * attempt + Math.floor(Math.random() * 25));
    }
  } catch (error) {
    await recordFailedAttempt(
      ddb,
      tables.audit,
      { requestId, actorRef, action: "DONATION_SIMULATE", resourceRef },
      error,
    );
    throw error;
  }
});

function notFound(): NotFoundError {
  return new NotFoundError("DONATION_NOT_FOUND", "Donación no encontrada");
}

function alreadyFinalized(): ConflictError {
  return new ConflictError(
    "DONATION_ALREADY_FINALIZED",
    "La donación ya tiene un resultado de simulación; no se puede volver a simular",
  );
}
