import { listPublishedProjects } from "../projects/repository.js";
import type { ProjectStats } from "../projects/schemas.js";
import { ddb, tableName } from "../shared/dynamo.js";
import { jsonResponse, withHttp } from "../shared/http.js";

/**
 * GET /v1/stats (HU-09). Suma los acumulados confirmados de los proyectos PUBLICADO. Ese acumulado
 * solo crece con donaciones CONFIRMADA_SIMULADA, así que excluye pendientes y rechazadas (CA-09.1).
 * No expone donantes ni registros individuales (CA-09.2).
 */
export const handler = withHttp("projects.stats", async () => {
  const projects = await listPublishedProjects(ddb, tableName("PROJECTS_TABLE"));

  const stats: ProjectStats = {
    currency: "PEN",
    publishedProjects: projects.length,
    goalAmountCents: projects.reduce((sum, project) => sum + project.goalAmountCents, 0),
    confirmedAmountCents: projects.reduce((sum, project) => sum + project.confirmedAmountCents, 0),
  };

  return jsonResponse(200, stats);
});
