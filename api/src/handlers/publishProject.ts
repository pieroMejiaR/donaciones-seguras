import { buildAuditEvent, pseudonymize, recordFailedAttempt } from "../audit/audit.js";
import { extractAuthContext, requireRole, requireScope } from "../auth/index.js";
import { getProject, publishProject } from "../projects/repository.js";
import { ProjectId, type Project } from "../projects/schemas.js";
import { ddb, tableName } from "../shared/dynamo.js";
import {
  ConflictError,
  jsonResponse,
  NotFoundError,
  requestIdOf,
  withHttp,
} from "../shared/http.js";

/**
 * POST /v1/projects/{id}/publish (HU-08, CA-08.2): un GESTOR publica un BORRADOR.
 * 404 si no existe, 409 si ya estaba publicado o si otro gestor lo publicó al mismo tiempo.
 */
export const handler = withHttp("projects.publish", async (event) => {
  const requestId = requestIdOf(event);
  const ctx = extractAuthContext(event);
  const actorRef = pseudonymize(ctx.sub);
  const tables = { projects: tableName("PROJECTS_TABLE"), audit: tableName("AUDIT_TABLE") };

  const rawId = event.pathParameters?.id ?? "";
  const isValidId = ProjectId.safeParse(rawId).success;
  // En auditoría no se guarda texto arbitrario del cliente: un id mal formado queda como "invalid".
  const resourceRef = `project/${isValidId ? rawId : "invalid"}`;

  try {
    requireScope(ctx, "api/projects.write");
    requireRole(ctx, "GESTOR");

    if (!isValidId) {
      throw new NotFoundError("PROJECT_NOT_FOUND", "Proyecto no encontrado");
    }

    const current = await getProject(ddb, tables.projects, rawId, { consistent: true });
    if (!current) {
      throw new NotFoundError("PROJECT_NOT_FOUND", "Proyecto no encontrado");
    }
    if (current.status === "PUBLICADO") {
      throw new ConflictError("PROJECT_ALREADY_PUBLISHED", "El proyecto ya está publicado");
    }

    const now = new Date().toISOString();
    await publishProject(
      ddb,
      tables,
      rawId,
      now,
      buildAuditEvent({
        timestamp: now,
        requestId,
        actorRef,
        action: "PROJECT_PUBLISH",
        resourceRef,
        outcome: "SUCCESS",
      }),
    );

    const published: Project = { ...current, status: "PUBLICADO", publishedAt: now, updatedAt: now };
    return jsonResponse(200, published);
  } catch (error) {
    await recordFailedAttempt(
      ddb,
      tables.audit,
      { requestId, actorRef, action: "PROJECT_PUBLISH", resourceRef },
      error,
    );
    throw error;
  }
});
