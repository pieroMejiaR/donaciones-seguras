import { randomUUID } from "node:crypto";
import { buildAuditEvent, pseudonymize, recordFailedAttempt } from "../audit/audit.js";
import { extractAuthContext, requireRole, requireScope } from "../auth/index.js";
import { createProject } from "../projects/repository.js";
import { CreateProjectInput, type Project } from "../projects/schemas.js";
import { ddb, tableName } from "../shared/dynamo.js";
import { jsonResponse, parseJsonBody, parseWith, requestIdOf, withHttp } from "../shared/http.js";

/**
 * POST /v1/projects (HU-08, CA-08.1): un GESTOR crea un proyecto en BORRADOR.
 * El scope ya lo exige API Gateway; Lambda vuelve a comprobar scope y rol (HU-04, T03) y registra
 * el resultado en auditoría, también cuando se deniega o rechaza (CA-08.3).
 */
export const handler = withHttp("projects.create", async (event) => {
  const requestId = requestIdOf(event);
  const ctx = extractAuthContext(event);
  const actorRef = pseudonymize(ctx.sub);
  const tables = { projects: tableName("PROJECTS_TABLE"), audit: tableName("AUDIT_TABLE") };

  try {
    requireScope(ctx, "api/projects.write");
    requireRole(ctx, "GESTOR");
    const input = parseWith(CreateProjectInput, parseJsonBody(event));

    const now = new Date().toISOString();
    const project: Project = {
      projectId: randomUUID(),
      title: input.title,
      description: input.description,
      goalAmountCents: input.goalAmountCents,
      confirmedAmountCents: 0,
      currency: "PEN",
      status: "BORRADOR",
      createdAt: now,
      updatedAt: now,
    };

    await createProject(
      ddb,
      tables,
      project,
      buildAuditEvent({
        timestamp: now,
        requestId,
        actorRef,
        action: "PROJECT_CREATE",
        resourceRef: `project/${project.projectId}`,
        outcome: "SUCCESS",
      }),
    );

    return jsonResponse(201, project);
  } catch (error) {
    await recordFailedAttempt(
      ddb,
      tables.audit,
      { requestId, actorRef, action: "PROJECT_CREATE", resourceRef: "project/new" },
      error,
    );
    throw error;
  }
});
